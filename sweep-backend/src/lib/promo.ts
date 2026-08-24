// lib/promo.ts
//
// Redeeming a promo code for free time on a paid tier.
//
// A grant is deliberately NOT written to Wallet.tier — it has its own two
// columns, and effectiveTier() takes whichever of the two is better right now.
// The reason is in the schema: sharing one field means a paying subscriber who
// redeems a code has their paid tier overwritten and silently drops to free
// when the grant lapses. Separate columns make that impossible rather than
// merely unlikely.
//
// Everything here has to survive two people redeeming the last use of a code at
// the same millisecond, so the limit is enforced by a conditional update rather
// than by reading a count and trusting it.

import { prisma } from "./prisma.js";
import { TIERS, type Tier, effectiveTier } from "./tiers.js";

export type RedeemFailure =
  | "not-found"
  | "expired"
  | "used-up"
  | "already-redeemed"
  | "already-better";

export interface RedeemSuccess {
  ok: true;
  /** The tier this code granted. */
  grantedTier: Tier;
  /** When the grant runs out. */
  grantExpiresAt: Date;
  /** How many days were added, after any extension of an existing grant. */
  days: number;
  /** What the user is actually on now, which may be higher if they pay. */
  effectiveTier: Tier;
  /**
   * True when a subscription they already pay for is better than this grant,
   * so nothing visibly changes today. The grant is still stored and still
   * matters — it's what they fall back to if the subscription ends.
   */
  overshadowed: boolean;
}

export interface RedeemFailed {
  ok: false;
  reason: RedeemFailure;
  /** Safe to show the user directly. */
  message: string;
}

/**
 * Codes are matched case-insensitively and ignoring spaces and dashes.
 *
 * People type them off a screenshot, a sticker, or a video, and "sweep-14" vs
 * "SWEEP14" is not a distinction worth failing a redemption over.
 */
export function normalizeCode(input: string): string {
  return input.trim().toUpperCase().replace(/[\s-]/g, "");
}

export async function redeemPromoCode(
  userId: string,
  rawCode: string,
): Promise<RedeemSuccess | RedeemFailed> {
  const code = normalizeCode(rawCode);
  if (!code) return fail("not-found", "Enter a code to redeem.");

  const promo = await prisma.promoCode.findUnique({ where: { code } });
  if (!promo) return fail("not-found", "That code isn't valid.");

  if (promo.expiresAt && promo.expiresAt.getTime() < Date.now()) {
    return fail("expired", "That code has expired.");
  }

  const grantsTier = promo.grantsTier as Tier;
  if (!TIERS.includes(grantsTier) || grantsTier === "free") {
    // A malformed code is our mistake, not the user's. Don't consume it.
    return fail("not-found", "That code isn't valid.");
  }

  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) return fail("not-found", "That code isn't valid.");

  const now = new Date();
  const runningPromo =
    wallet.promoTier && wallet.promoExpiresAt && wallet.promoExpiresAt > now
      ? { tier: wallet.promoTier as Tier, expiresAt: wallet.promoExpiresAt }
      : null;

  // A lower-tier code on top of a running higher-tier grant has nowhere sensible
  // to go: applying it would downgrade them, and silently upgrading the code to
  // the better tier would let cheap codes extend an expensive grant forever.
  // Refusing leaves the code unspent, which is the outcome they'd want.
  if (runningPromo && rank(grantsTier) < rank(runningPromo.tier)) {
    return fail(
      "already-better",
      `You already have ${label(runningPromo.tier)} until ${formatDate(runningPromo.expiresAt)}.`,
    );
  }

  // Same tier stacks — two weekly codes are two weeks. A better tier starts
  // fresh rather than inheriting the lesser grant's remaining time.
  const base =
    runningPromo && rank(grantsTier) === rank(runningPromo.tier)
      ? runningPromo.expiresAt
      : now;
  const grantExpiresAt = new Date(
    base.getTime() + promo.grantsDurationDays * 24 * 60 * 60 * 1000,
  );

  // Claim a redemption slot BEFORE granting anything.
  //
  // The unique on (userId, promoCodeId) is what stops one person redeeming
  // twice, and it's enforced by the database rather than by a check-then-write
  // that two concurrent requests would both pass.
  try {
    await prisma.promoCodeRedemption.create({
      data: { userId, promoCodeId: promo.id },
    });
  } catch {
    return fail("already-redeemed", "You've already used that code.");
  }

  // Now the global limit. Conditional update: only increments while the count
  // is still below the cap, so the loser of a race gets count === 0 rather than
  // a cap quietly exceeded. Unlimited codes (maxRedemptions null) skip the
  // ceiling but still increment, because the number is worth having.
  const claimed = await prisma.promoCode.updateMany({
    where: {
      id: promo.id,
      ...(promo.maxRedemptions === null
        ? {}
        : { timesRedeemed: { lt: promo.maxRedemptions } }),
    },
    data: { timesRedeemed: { increment: 1 } },
  });

  if (claimed.count === 0) {
    // Someone took the last one first. Release the slot we claimed so this
    // user can redeem a different code, and isn't left with a redemption row
    // for something they never received.
    await prisma.promoCodeRedemption
      .delete({ where: { userId_promoCodeId: { userId, promoCodeId: promo.id } } })
      .catch(() => {});
    return fail("used-up", "That code has been fully claimed.");
  }

  const updated = await prisma.wallet.update({
    where: { userId },
    data: { promoTier: grantsTier, promoExpiresAt: grantExpiresAt },
  });

  const nowEffective = effectiveTier(updated);

  return {
    ok: true,
    grantedTier: grantsTier,
    grantExpiresAt,
    days: promo.grantsDurationDays,
    effectiveTier: nowEffective,
    overshadowed: rank(nowEffective) > rank(grantsTier),
  };
}

function rank(tier: Tier): number {
  return TIERS.indexOf(tier);
}

function label(tier: Tier): string {
  return tier === "ultimate" ? "Ultimate" : tier === "pro" ? "Pro" : "Free";
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fail(reason: RedeemFailure, message: string): RedeemFailed {
  return { ok: false, reason, message };
}
