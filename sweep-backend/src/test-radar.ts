// src/test-radar.ts — Deal Radar end to end.
//   npm run dev && npm run test:radar
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "./lib/prisma.js";

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
check("you can delete your own", (await call(token, "DELETE", `/radar/${radarId}`)).status === 200);
check("deleting twice 404s", (await call(token, "DELETE", `/radar/${radarId}`)).status === 404);

for (const id of [userId, other.data.session!.user.id]) {
  await prisma.savedSearch.deleteMany({ where: { userId: id } });
  await prisma.wallet.deleteMany({ where: { userId: id } });
  await prisma.user.deleteMany({ where: { id } });
}
console.log(`\n${pass} passed, ${fail} failed  (cleaned up)`);
process.exit(fail ? 1 : 0);
