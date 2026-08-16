// src/test-concurrency.ts — metered actions under simultaneous requests.
//   npm run test:concurrency
//
// This suite exists because five of seven quota consumers could be raced: they
// read the count, checked it against the limit, then incremented — and two
// requests arriving in the same millisecond both passed the check. Sweeps are
// 1/day on Pro, so "one extra" was a doubling of the most expensive operation
// in the app.
//
// Nothing else could have caught it. Manual testing can't produce sub-
// millisecond concurrency, and the security suite asks whether limits are
// per-account, not whether they survive a tie.
//
// Every test here fires N simultaneous requests at a limit of M and asserts
// exactly M succeed. Any new metered feature belongs in this file.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { purgeTestUser } from "./testCleanup.js";
import { prisma } from "./lib/prisma.js";
import {
  consumeManualCheck,
  consumeRadarChange,
  consumeRadarRefresh,
  consumeSweep,
  consumeUserSearch,
} from "./lib/quota.js";
import { TIER_LIMITS } from "./lib/tiers.js";

let pass = 0,
  fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok && detail !== undefined) console.log("     ", JSON.stringify(detail));
};

// Created directly rather than through the API: these tests call the quota
// functions against the database, so no server needs to be running.
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
const email = `concurrency-${Date.now()}@sweepshopping.com`;
const { data: made, error: mkErr } = await admin.auth.admin.createUser({
  email,
  password: "Test-Passw0rd!x",
  email_confirm: true,
});
if (mkErr) throw mkErr;
const user = { id: made.user!.id, email };
await prisma.user.create({ data: { id: user.id, email } });
await prisma.wallet.create({ data: { userId: user.id } });
console.log(`test user ${user.email}\n`);

/** Put the wallet on a known tier with a fresh daily window. */
async function reset(tier: "free" | "pro" | "ultimate") {
  await prisma.wallet.update({
    where: { userId: user.id },
    data: {
      tier,
      tierExpiresAt: null,
      searchesUsedToday: 0,
      sweepsUsedToday: 0,
      manualChecksToday: 0,
      radarRefreshesToday: 0,
      radarChangesToday: 0,
      lastManualCheckAt: null,
    },
  });
}

/**
 * Fire `attempts` calls at once and count how many were allowed.
 *
 * Promise.all rather than a loop: sequential calls can never collide, which is
 * exactly why this bug survived every previous test.
 */
async function race(attempts: number, action: () => Promise<unknown>) {
  const results = await Promise.all(
    Array.from({ length: attempts }, () => action().catch(() => null)),
  );
  return results.filter((r) => r !== null && (r as { ok?: boolean }).ok !== false).length;
}

try {
  console.log("— searches (already guarded; the reference) —");
  await reset("free");
  const searchLimit = TIER_LIMITS.free.searchesPerDay;
  const searches = await race(8, () => consumeUserSearch(user.id));
  check(`${searches} of 8 allowed, limit ${searchLimit}`, searches === searchLimit, {
    searches,
    searchLimit,
  });

  console.log("\n— sweeps —");
  await reset("pro");
  const sweepLimit = TIER_LIMITS.pro.sweepsPerDay;
  const sweeps = await race(8, () => consumeSweep(user.id));
  check(`${sweeps} of 8 allowed, limit ${sweepLimit}`, sweeps === sweepLimit, {
    sweeps,
    sweepLimit,
  });

  console.log("\n— radar refreshes —");
  await reset("free");
  const refreshLimit = TIER_LIMITS.free.radarRefreshesPerDay;
  const refreshes = await race(10, () => consumeRadarRefresh(user.id));
  check(`${refreshes} of 10 allowed, limit ${refreshLimit}`, refreshes === refreshLimit, {
    refreshes,
    refreshLimit,
  });

  console.log("\n— radar changes —");
  await reset("free");
  const changeLimit = TIER_LIMITS.free.radarChangesPerDay;
  const changes = await race(10, () => consumeRadarChange(user.id));
  check(`${changes} of 10 allowed, limit ${changeLimit}`, changes === changeLimit, {
    changes,
    changeLimit,
  });

  console.log("\n— manual price checks —");
  await reset("free");
  const manualLimit = TIER_LIMITS.free.manualChecksPerDay;
  const manual = await race(8, () => consumeManualCheck(user.id));
  // Deliberately stricter than the daily count: the guard includes
  // lastManualCheckAt, so simultaneous taps collapse to one. A double-tap
  // spending two of five checks would be worse than refusing the second.
  check(`${manual} of 8 simultaneous taps allowed (want 1)`, manual === 1, {
    manual,
    manualLimit,
  });

  console.log("\n— the counter matches what was handed out —");
  const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
  // A counter above the limit means someone got something we didn't record as
  // spent, which is the same bug seen from the other side.
  check(
    "no counter exceeds its limit",
    (wallet?.sweepsUsedToday ?? 0) <= TIER_LIMITS.pro.sweepsPerDay &&
      (wallet?.radarRefreshesToday ?? 0) <= TIER_LIMITS.free.radarRefreshesPerDay &&
      (wallet?.radarChangesToday ?? 0) <= TIER_LIMITS.free.radarChangesPerDay,
    {
      sweeps: wallet?.sweepsUsedToday,
      refreshes: wallet?.radarRefreshesToday,
      changes: wallet?.radarChangesToday,
    },
  );
} finally {
  await purgeTestUser(user.id);
  await prisma.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
