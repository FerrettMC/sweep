// src/test-security.ts — account deletion and abuse limits.
//   npm run dev && npm run test:security
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "./lib/prisma.js";
import { purgeTestUser } from "./testCleanup.js";
import { consumeGuestIpSearch } from "./lib/quota.js";

const API = process.env.TEST_API_URL ?? "http://localhost:3001";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
let pass = 0, fail = 0;
const check = (l: string, ok: boolean, d?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${l}`);
  if (!ok && d !== undefined) console.log("     ", JSON.stringify(d).slice(0, 250));
};
const call = async (t: string | null, m: string, p: string, b?: unknown, headers: Record<string,string> = {}) => {
  const r = await fetch(API + p, {
    method: m,
    headers: { ...(b !== undefined ? { "Content-Type": "application/json" } : {}), ...(t ? { Authorization: `Bearer ${t}` } : {}), ...headers },
    ...(b !== undefined ? { body: JSON.stringify(b) } : {}),
  });
  const txt = await r.text();
  let j: any = null; try { j = JSON.parse(txt); } catch { j = { raw: txt.slice(0, 120) }; }
  return { status: r.status, body: j };
};

const email = `sweep-sec-${Date.now()}@example.com`;
const { data } = await sb.auth.signUp({ email, password: "sweep-test-password-123" });
const token = data.session!.access_token;
const userId = data.session!.user.id;
await call(token, "POST", "/auth/sync-user", { email });

console.log("\n— account deletion —");
check("auth is required", (await call(null, "DELETE", "/me", { confirm: true })).status === 401);
const noConfirm = await call(token, "DELETE", "/me", {});
check("a missing confirmation is refused", noConfirm.status === 400 && noConfirm.body.code === "CONFIRMATION_REQUIRED", noConfirm.body);

// A valid token proves the phone was signed in, not who is holding it now.
const noPassword = await call(token, "DELETE", "/me", { confirm: true });
check("a token alone can't delete the account", noPassword.status === 400 && noPassword.body.code === "PASSWORD_REQUIRED", noPassword.body);
const wrongPassword = await call(token, "DELETE", "/me", { confirm: true, password: "not-the-password" });
check("a wrong password is refused with 403, not 401", wrongPassword.status === 403 && wrongPassword.body.code === "PASSWORD_INCORRECT", wrongPassword.body);

// Give the account something to lose.
await prisma.list.create({ data: { userId, name: "doomed list" } });
await prisma.budgetEntry.create({ data: { userId, amount: 500, category: "Other" } });
await prisma.savedSearch.create({ data: { userId, keyword: "doomed radar" } });
const before = {
  lists: await prisma.list.count({ where: { userId } }),
  budget: await prisma.budgetEntry.count({ where: { userId } }),
  radars: await prisma.savedSearch.count({ where: { userId } }),
};
check("the account has data to erase", before.lists > 0 && before.budget > 0 && before.radars > 0, before);

const del = await call(token, "DELETE", "/me", { confirm: true, password: "sweep-test-password-123" });
check("deletion succeeds", del.status === 200 && del.body.ok === true, del.body);
check("it reports what it removed", typeof del.body.deleted === "object", del.body.deleted);

const after = {
  user: await prisma.user.count({ where: { id: userId } }),
  wallet: await prisma.wallet.count({ where: { userId } }),
  lists: await prisma.list.count({ where: { userId } }),
  budget: await prisma.budgetEntry.count({ where: { userId } }),
  radars: await prisma.savedSearch.count({ where: { userId } }),
  push: await prisma.pushToken.count({ where: { userId } }),
};
check("every trace is gone", Object.values(after).every((n) => n === 0), after);
check("the Supabase auth record went too", del.body.authRecordRemoved === true, del.body);
check("the token no longer works", (await call(token, "GET", "/auth/me")).status !== 200);

console.log("\n— rate limiting —");
const fresh = await sb.auth.signUp({ email: `sweep-sec2-${Date.now()}@example.com`, password: "sweep-test-password-123" });
const token2 = fresh.data.session!.access_token;
await call(token2, "POST", "/auth/sync-user", { email: `sweep-sec2-${Date.now()}@example.com` });

// Fired in parallel: sequentially, token verification is slow enough that the
// one-minute window rolls over before the ceiling is reached.
// Unauthenticated, so this shares one IP-keyed bucket. Must exceed
// GLOBAL_LIMIT.max (300) to prove the ceiling exists at all.
const burst = await Promise.all(
  Array.from({ length: 360 }, () => call(null, "GET", "/search/retailers")),
);
const limited = burst.filter((r) => r.status === 429).length;
check(`the shared ceiling kicks in (${limited}/360 refused)`, limited > 0, { limited });
const refusal = burst.find((r) => r.status === 429);
check("...and says why", refusal?.body?.code === "RATE_LIMITED", refusal?.body);

console.log("\n— limits are per account, not global —");
// The claim worth proving: one user hitting their ceiling must not throttle
// anyone else. At the default onRequest hook this fails, because the key is
// computed before auth runs and every signed-in user falls back to their IP.
const emailB = `sweep-sec3-${Date.now()}@example.com`;
const userB = await sb.auth.signUp({ email: emailB, password: "sweep-test-password-123" });
const tokenB = userB.data.session!.access_token;
await call(tokenB, "POST", "/auth/sync-user", { email: emailB });

// Exhaust user A's bucket.
const flood = await Promise.all(
  Array.from({ length: 320 }, () => call(token2, "GET", "/auth/me")),
);
const aRefused = flood.filter((r) => r.status === 429).length;
check(`user A is throttled after its own ceiling (${aRefused} refused)`, aRefused > 0, { aRefused });

// User B, same machine and therefore the same IP, must be unaffected.
const bResponse = await call(tokenB, "GET", "/auth/me");
check("user B on the same IP is NOT throttled", bResponse.status === 200, bResponse);

await purgeTestUser(userB.data.session!.user.id);

console.log("\n— guest identity —");
// A guest's device id is client-supplied. Rotating it must not be a way to
// mint unlimited search quota, so the IP ceiling has to catch it.
// Each rotation looks like a brand-new guest and gets its own device quota, so
// the network ceiling is the thing that actually stops it. Exercised directly:
// through the HTTP route, the 10/min scrape limit refuses first and it would
// take minutes of real searching to reach the daily cap.
await prisma.ipQuota.deleteMany({});
const results: boolean[] = [];
for (let i = 0; i < 27; i++) {
  results.push((await consumeGuestIpSearch("203.0.113.7")).allowed);
}
const allowed = results.filter(Boolean).length;
check(`the network ceiling stops rotation at ${allowed} searches`, allowed === 25, { allowed });
check("...and keeps refusing after that", results[25] === false && results[26] === false);

// A different network is unaffected — the cap is per-IP, not global.
check("a different network is unaffected", (await consumeGuestIpSearch("198.51.100.9")).allowed === true);

// Stored hashed: we count requests from a network, we don't keep a log of it.
const stored = await prisma.ipQuota.findMany();
check("IPs are stored hashed, never raw", stored.every((r) => !r.ipHash.includes(".") && r.ipHash.length === 32), stored.map((r) => r.ipHash));
await prisma.ipQuota.deleteMany({});

for (const id of [fresh.data.session!.user.id]) {
  await purgeTestUser(id);
}
console.log(`\n${pass} passed, ${fail} failed  (cleaned up)`);
process.exit(fail ? 1 : 0);
