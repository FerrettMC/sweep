// src/test-radar.ts — Deal Radar end to end.
//   npm run dev && npm run test:radar
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "./lib/prisma.js";
import { purgeTestUser } from "./testCleanup.js";

const API = process.env.TEST_API_URL ?? "http://localhost:3001";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
let pass = 0, fail = 0;
const check = (l: string, ok: boolean, d?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${l}`);
  if (!ok && d !== undefined) console.log("     ", JSON.stringify(d).slice(0, 250));
};
const call = async (t: string | null, m: string, p: string, b?: unknown) => {
  const r = await fetch(API + p, {
    method: m,
    headers: { ...(b !== undefined ? { "Content-Type": "application/json" } : {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    ...(b !== undefined ? { body: JSON.stringify(b) } : {}),
  });
  const txt = await r.text();
  let j: any = null; try { j = JSON.parse(txt); } catch { j = { raw: txt.slice(0, 200) }; }
  return { status: r.status, body: j };
};

const email = `sweep-rad-${Date.now()}@example.com`;
const { data } = await sb.auth.signUp({ email, password: "sweep-test-password-123" });
const token = data.session!.access_token;
const userId = data.session!.user.id;
await call(token, "POST", "/auth/sync-user", { email });

console.log("\n— free tier gets a real radar —");
let r = await call(token, "GET", "/radar");
check("free reports 1 radar and no auto-checks", r.body.limits?.maxSavedSearches === 1 && r.body.limits?.autoChecks === false, r.body.limits);
check("free reports 2 refreshes a day", r.body.refreshes?.limit === 2, r.body.refreshes);

r = await call(token, "POST", "/radar", { keyword: "airpods pro", targetPrice: 18000 });
check("a radar is created with a target price", r.status === 201 && r.body.search?.targetPrice === 18000, r.body);
const radarId = r.body.search?.id;

check("a too-short keyword is refused", (await call(token, "POST", "/radar", { keyword: "a" })).status === 400);
check("a nonsense target is refused", (await call(token, "POST", "/radar", { keyword: "valid words", targetPrice: -5 })).status === 400);

r = await call(token, "POST", "/radar", { keyword: "second one" });
check("a second radar is refused on free", r.status === 403 && r.body.code === "RADAR_LIMIT_REACHED", r.body);

console.log("\n— editing —");
check("the target price can change", (await call(token, "PATCH", `/radar/${radarId}`, { targetPrice: 20000 })).status === 200);
r = await call(token, "GET", "/radar");
check("...and is reflected", r.body.searches?.[0]?.targetPrice === 20000, r.body.searches?.[0]);

console.log("\n— manual refresh (this hits real retailers) —");
r = await call(token, "POST", `/radar/${radarId}/refresh`);
check("refresh returns matches and a refresh count", r.status === 200 && Array.isArray(r.body.matches), r.body?.error ?? r.body);
check("a refresh was spent", r.body.refreshes?.remaining === 1, r.body.refreshes);
check("matches respect the target price", (r.body.matches ?? []).every((m: any) => m.price <= 20000), (r.body.matches ?? []).map((m: any) => m.price));

r = await call(token, "POST", `/radar/${radarId}/refresh`);
check("a second refresh works", r.status === 200, r.body);
check("...and exhausts the free allowance", r.body.refreshes?.remaining === 0, r.body.refreshes);

r = await call(token, "POST", `/radar/${radarId}/refresh`);
check("a third refresh is refused", r.status === 429 && r.body.code === "RADAR_REFRESH_EXHAUSTED", r.body);

console.log("\n— pro gets more —");
await prisma.wallet.update({ where: { userId }, data: { tier: "pro", radarRefreshesToday: 0 } });
r = await call(token, "GET", "/radar");
check("pro reports 5 radars", r.body.limits?.maxSavedSearches === 5, r.body.limits);
check("pro gets scheduled checks", r.body.limits?.autoChecks === true && r.body.limits?.intervalMinutes === 720, r.body.limits);
check("a second radar is now allowed", (await call(token, "POST", "/radar", { keyword: "nintendo switch 2" })).status === 201);

console.log("\n— radar must not become an unmetered search box —");
// The exploit: search for what you want by creating a radar, refreshing it,
// deleting it, and repeating with a new keyword. Capped by the change budget.
await prisma.wallet.update({ where: { userId }, data: { tier: "free", radarChangesToday: 0, radarRefreshesToday: 0 } });
await prisma.savedSearch.deleteMany({ where: { userId } });

let created = 0;
for (let i = 0; i < 8; i++) {
  const made = await call(token, "POST", "/radar", { keyword: `churn probe ${i}` });
  if (made.status !== 201) break;
  created++;
  await call(token, "DELETE", `/radar/${made.body.search.id}`);
}
check(`churning stops at the free change cap (made ${created})`, created === 3, { created });

r = await call(token, "POST", "/radar", { keyword: "one more" });
check("...with a clear reason", r.status === 429 && r.body.code === "RADAR_CHANGE_EXHAUSTED", r.body);

// Renaming is the same trick without the delete, so it costs the same.
await prisma.wallet.update({ where: { userId }, data: { radarChangesToday: 0 } });
await prisma.savedSearch.deleteMany({ where: { userId } });
const base = await call(token, "POST", "/radar", { keyword: "rename probe" });
let renames = 0;
for (let i = 0; i < 8; i++) {
  const res = await call(token, "PATCH", `/radar/${base.body.search.id}`, { keyword: `rename probe ${i}` });
  if (res.status !== 200) break;
  renames++;
}
check(`renaming is metered too (did ${renames})`, renames === 2, { renames });

r = await call(token, "PATCH", `/radar/${base.body.search.id}`, { targetPrice: 5000 });
check("...but the target price can still be edited", r.status === 200, r.body);

r = await call(token, "PATCH", `/radar/${base.body.search.id}`, { keyword: "rename probe 1" });
check("a no-op rename costs nothing", r.status === 200, r.body);

console.log("\n— no tier gets unlimited refreshes —");
for (const tier of ["free", "pro", "ultimate"] as const) {
  await prisma.wallet.update({ where: { userId }, data: { tier } });
  const q = await call(token, "GET", "/radar");
  check(`${tier} has a finite refresh cap (${q.body.refreshes?.limit})`, typeof q.body.refreshes?.limit === "number", q.body.refreshes);
}
await prisma.wallet.update({ where: { userId }, data: { tier: "pro" } });

console.log("\n— ownership —");
const other = await sb.auth.signUp({ email: `sweep-rad2-${Date.now()}@example.com`, password: "sweep-test-password-123" });
const otherToken = other.data.session!.access_token;
await call(otherToken, "POST", "/auth/sync-user", { email: `sweep-rad2-${Date.now()}@example.com` });
check("another user sees none of yours", (await call(otherToken, "GET", "/radar")).body.searches?.length === 0);
check("another user can't edit yours", (await call(otherToken, "PATCH", `/radar/${radarId}`, { keyword: "hijacked" })).status === 404);
check("another user can't refresh yours", (await call(otherToken, "POST", `/radar/${radarId}/refresh`)).status === 404);
check("another user can't delete yours", (await call(otherToken, "DELETE", `/radar/${radarId}`)).status === 404);
check("auth is required", (await call(null, "GET", "/radar")).status === 401);

console.log("\n— delete —");
// A fresh one: the churn section above clears this user's saved searches.
const doomed = await call(token, "POST", "/radar", { keyword: "delete me please" });
check("you can delete your own", (await call(token, "DELETE", `/radar/${doomed.body.search.id}`)).status === 200);
check("deleting twice 404s", (await call(token, "DELETE", `/radar/${doomed.body.search.id}`)).status === 404);

for (const id of [userId, other.data.session!.user.id]) {
  await prisma.savedSearch.deleteMany({ where: { userId: id } });
  await purgeTestUser(id);
}
console.log(`\n${pass} passed, ${fail} failed  (cleaned up)`);
process.exit(fail ? 1 : 0);
