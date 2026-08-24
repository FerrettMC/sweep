// src/test-promo.ts — promo codes.
//   npm run test:promo     (needs the dev server running)
//
// Two things here are worth more than the rest put together.
//
// A grant must never damage a subscription. Promo time and paid time live in
// separate columns precisely so a paying subscriber who redeems a code can't be
// silently downgraded when the grant lapses, and that's the case this pins.
//
// And the limits have to hold under a race. maxRedemptions enforced by reading
// a count and trusting it is a code that gets over-redeemed the one time it
// matters, so the concurrent case is tested rather than reasoned about.
import { assertNotProduction, targetSummary } from "./testEnv.js";

assertNotProduction();
console.log(`target: ${targetSummary()}`);

import { prisma } from "./lib/prisma.js";
import { createTestUser, purgeTestUser } from "./testCleanup.js";
import { createPromoCode, deletePromoCode } from "./lib/promoAdmin.js";
import { normalizeCode, redeemPromoCode } from "./lib/promo.js";
import { effectiveTier } from "./lib/tiers.js";

const API = process.env.API_URL ?? "http://127.0.0.1:3001";
const DAY = 24 * 60 * 60 * 1000;

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); if (detail !== undefined) console.log(`      ${JSON.stringify(detail)}`); }
}

const userIds: string[] = [];
const codes: string[] = [];

async function newUser(tag: string) {
  const u = await createTestUser(tag, API);
  userIds.push(u.id);
  return u;
}

async function newCode(opts: { tier?: string; days?: number; max?: number | null; expiresInDays?: number | null } = {}) {
  const created = await createPromoCode({
    tier: opts.tier ?? "pro",
    days: opts.days ?? 14,
    maxRedemptions: opts.max === undefined ? null : opts.max,
    expiresInDays: opts.expiresInDays ?? null,
  });
  codes.push(created.code);
  return created;
}

async function wallet(userId: string) {
  return prisma.wallet.findUnique({ where: { userId } });
}

try {
  console.log("\n— redeeming —");
  {
    const user = await newUser("promo");
    const code = await newCode({ days: 14 });
    const result = await redeemPromoCode(user.id, code.code);
    check("succeeds", result.ok, result);
    if (result.ok) {
      check("grants the right tier", result.grantedTier === "pro");
      check("for the right number of days", result.days === 14);
      const w = await wallet(user.id);
      check("effective tier is pro", effectiveTier(w!) === "pro", effectiveTier(w!));
      check("paid tier is untouched", w!.tier === "free", w!.tier);
      const days = Math.round((w!.promoExpiresAt!.getTime() - Date.now()) / DAY);
      check("expiry is 14 days out", days === 14, days);
    }
  }

  console.log("\n— codes are typed by humans —");
  {
    const user = await newUser("promo");
    const code = await newCode();
    const messy = ` ${code.code.toLowerCase().slice(0, 4)}-${code.code.toLowerCase().slice(4)} `;
    check("normalizes to the stored form", normalizeCode(messy) === code.code, normalizeCode(messy));
    const result = await redeemPromoCode(user.id, messy);
    check("redeems despite case, spaces and dashes", result.ok, result);
  }

  console.log("\n— a grant never damages a subscription —");
  {
    // The whole reason promo time has its own columns. This user pays for Pro
    // for a year and redeems a 7-day Ultimate code.
    const user = await newUser("promo");
    const paidUntil = new Date(Date.now() + 365 * DAY);
    await prisma.wallet.update({
      where: { userId: user.id },
      data: { tier: "pro", tierExpiresAt: paidUntil },
    });

    const code = await newCode({ tier: "ultimate", days: 7 });
    const result = await redeemPromoCode(user.id, code.code);
    check("the code applies", result.ok, result);

    const w = await wallet(user.id);
    check("they're on ultimate now", effectiveTier(w!) === "ultimate", effectiveTier(w!));
    check("the paid tier survives", w!.tier === "pro", w!.tier);
    check("the paid expiry survives", w!.tierExpiresAt?.getTime() === paidUntil.getTime());

    // Now expire the grant, exactly as time would.
    await prisma.wallet.update({
      where: { userId: user.id },
      data: { promoExpiresAt: new Date(Date.now() - 1000) },
    });
    const after = await wallet(user.id);
    check("when the grant lapses they fall back to PRO, not free",
      effectiveTier(after!) === "pro", effectiveTier(after!));
  }

  console.log("\n— an overshadowed grant is still stored —");
  {
    const user = await newUser("promo");
    await prisma.wallet.update({
      where: { userId: user.id },
      data: { tier: "ultimate", tierExpiresAt: new Date(Date.now() + 365 * DAY) },
    });
    const code = await newCode({ tier: "pro", days: 30 });
    const result = await redeemPromoCode(user.id, code.code);
    check("redeems", result.ok, result);
    if (result.ok) {
      check("and says it changes nothing today", result.overshadowed === true);
      check("effective tier stays ultimate", result.effectiveTier === "ultimate");
    }
    const w = await wallet(user.id);
    check("the grant is on the wallet regardless", w!.promoTier === "pro", w!.promoTier);
  }

  console.log("\n— stacking —");
  {
    const user = await newUser("promo");
    const a = await newCode({ days: 14 });
    const b = await newCode({ days: 14 });
    await redeemPromoCode(user.id, a.code);
    const second = await redeemPromoCode(user.id, b.code);
    check("a second code of the same tier extends", second.ok);
    const w = await wallet(user.id);
    const days = Math.round((w!.promoExpiresAt!.getTime() - Date.now()) / DAY);
    check("two 14-day codes are 28 days", days === 28, days);
  }

  console.log("\n— a lesser code can't downgrade a running grant —");
  {
    const user = await newUser("promo");
    const big = await newCode({ tier: "ultimate", days: 30 });
    await redeemPromoCode(user.id, big.code);
    const small = await newCode({ tier: "pro", days: 14 });
    const result = await redeemPromoCode(user.id, small.code);
    check("refused", !result.ok && result.reason === "already-better", result);

    const w = await wallet(user.id);
    check("the better grant is intact", w!.promoTier === "ultimate", w!.promoTier);

    const spent = await prisma.promoCodeRedemption.count({
      where: { userId: user.id, promoCode: { code: small.code } },
    });
    check("and the refused code was NOT spent", spent === 0, spent);
  }

  console.log("\n— one code, one person, once —");
  {
    const user = await newUser("promo");
    const code = await newCode();
    await redeemPromoCode(user.id, code.code);
    const again = await redeemPromoCode(user.id, code.code);
    check("a second attempt is refused", !again.ok && again.reason === "already-redeemed", again);
  }

  console.log("\n— maxRedemptions holds under a race —");
  {
    // Three people, one remaining use, all at once. A check-then-write would
    // let all three through; this is the case that pattern fails on.
    const code = await newCode({ max: 1 });
    // Created one at a time — the test emails are keyed on Date.now(), so
    // three at once collide with each other rather than testing anything.
    // Only the redemptions need to be concurrent, and they are.
    const racers = [await newUser("race1"), await newUser("race2"), await newUser("race3")];
    const results = await Promise.all(racers.map((u) => redeemPromoCode(u.id, code.code)));

    const winners = results.filter((r) => r.ok).length;
    check("exactly one wins", winners === 1, results.map((r) => (r.ok ? "ok" : r.reason)));
    check("the losers are told why",
      results.filter((r) => !r.ok).every((r) => !r.ok && r.reason === "used-up"));

    const row = await prisma.promoCode.findUnique({ where: { code: code.code } });
    check("the counter matches reality", row!.timesRedeemed === 1, row!.timesRedeemed);

    const rows = await prisma.promoCodeRedemption.count({ where: { promoCodeId: row!.id } });
    check("and no redemption row is left behind by a loser", rows === 1, rows);
  }

  console.log("\n— deleting a redeemed code —");
  {
    // The foreign key from redemptions means a naive delete fails outright.
    // More importantly: deleting a code must NOT reach back and revoke time
    // people already have, and this is where that gets proven rather than
    // assumed.
    const user = await newUser("promo");
    const code = await newCode({ days: 21 });
    const redeemed = await redeemPromoCode(user.id, code.code);
    check("redeemed first", redeemed.ok, redeemed);

    const before = await wallet(user.id);
    const result = await deletePromoCode(code.code);
    check("the code deletes despite having been used", result.redemptionsRemoved === 1, result);

    const gone = await prisma.promoCode.findUnique({ where: { code: code.code } });
    check("and is really gone", gone === null);

    const after = await wallet(user.id);
    check("the grant survives the code being deleted",
      after!.promoTier === before!.promoTier &&
      after!.promoExpiresAt?.getTime() === before!.promoExpiresAt?.getTime(),
      { before: before!.promoExpiresAt, after: after!.promoExpiresAt });
    check("they're still on the granted tier", effectiveTier(after!) === "pro", effectiveTier(after!));

    const orphans = await prisma.promoCodeRedemption.count({ where: { userId: user.id } });
    check("no redemption row is orphaned", orphans === 0, orphans);
  }

  console.log("\n— bad codes —");
  {
    const user = await newUser("promo");
    const missing = await redeemPromoCode(user.id, "NOSUCHCODE");
    check("unknown code is refused", !missing.ok && missing.reason === "not-found");

    const empty = await redeemPromoCode(user.id, "   ");
    check("empty code is refused", !empty.ok && empty.reason === "not-found");

    const expired = await createPromoCode({ tier: "pro", days: 7, expiresInDays: 1 });
    codes.push(expired.code);
    await prisma.promoCode.update({
      where: { code: expired.code },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const stale = await redeemPromoCode(user.id, expired.code);
    check("an expired code is refused", !stale.ok && stale.reason === "expired", stale);
  }

  console.log("\n— creation is validated —");
  {
    await check2("rejects a free-tier code", () => createPromoCode({ tier: "free", days: 7 }));
    await check2("rejects zero days", () => createPromoCode({ tier: "pro", days: 0 }));
    await check2("rejects absurd durations", () => createPromoCode({ tier: "pro", days: 9999 }));
    const made = await newCode({ days: 1 });
    await check2("rejects a duplicate code", () => createPromoCode({ code: made.code, tier: "pro", days: 7 }));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
} finally {
  await prisma.promoCodeRedemption.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.promoCode.deleteMany({ where: { code: { in: codes } } });
  for (const id of userIds) await purgeTestUser(id);
  await prisma.$disconnect();
}

async function check2(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(name, false, "did not throw");
  } catch {
    check(name, true);
  }
}

process.exit(failed === 0 ? 0 : 1);
