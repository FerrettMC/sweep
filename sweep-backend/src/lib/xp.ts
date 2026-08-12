// lib/xp.ts
//
// XP is awarded for FINDING good deals, never for buying anything.
//
// That's a deliberate choice, and it's what makes the leaderboard trustworthy.
// We cannot verify a purchase — everything after "user tapped through to the
// store" happens somewhere we can't see — so any purchase-based score would
// rest on a client claim, which is exactly the thing that must never be
// trusted on a public leaderboard.
//
// Every award here is computed server-side from data we collected ourselves:
// the product's own price history. Nothing the client sends affects XP.
//
// It's also a better game. Rewarding purchases ranks whoever spends the most;
// rewarding finds ranks whoever shops smartest, and doesn't push anyone to buy
// things they don't need.

import { prisma } from "./prisma.js";

/** A drop must be at least this far below the average to be worth anything. */
export const MIN_DEAL_PERCENT = 10;
/** Ceiling on a single award, so one absurd listing can't mint a leaderboard. */
export const MAX_DEAL_XP = 100;
/**
 * How long before the same product can earn a user XP again.
 *
 * Without this, a price oscillating either side of its average would pay out
 * on every bounce, and untrack/re-track would reset nothing — the ledger
 * remembers.
 */
export const DEAL_COOLDOWN_HOURS = 24 * 7;

export const XP_FIRST_TRACK = 10;

export interface XpAward {
  xp: number;
  reason: string;
  detail: string;
}

/**
 * Award XP for a tracked product dropping meaningfully below its own average.
 *
 * Returns the awards actually made — empty when the drop was too small, or
 * when the trackers already earned from this product recently.
 */
export async function awardDealFound(params: {
  productId: string;
  newPrice: number;
}): Promise<{ userId: string; award: XpAward }[]> {
  const { productId, newPrice } = params;

  // The average is computed from OUR recorded history, not from anything the
  // retailer claims, so a fake "was" price can't inflate it.
  const history = await prisma.priceHistory.findMany({
    where: { productId },
    select: { price: true },
  });

  // Too little history to say what "normal" is. Two points is a line, not a
  // baseline — paying out on it would reward luck, not judgement.
  if (history.length < 3) return [];

  const average = Math.round(
    history.reduce((sum, point) => sum + point.price, 0) / history.length,
  );
  if (average <= 0) return [];

  const percentBelow = Math.round(((average - newPrice) / average) * 100);
  if (percentBelow < MIN_DEAL_PERCENT) return [];

  const xp = Math.min(percentBelow, MAX_DEAL_XP);
  const cutoff = new Date(Date.now() - DEAL_COOLDOWN_HOURS * 60 * 60 * 1000);

  const trackers = await prisma.trackedProduct.findMany({
    where: { productId },
    select: { userId: true },
  });

  const results: { userId: string; award: XpAward }[] = [];

  for (const { userId } of trackers) {
    const recent = await prisma.transaction.findFirst({
      where: {
        userId,
        productId,
        reason: "deal_found",
        createdAt: { gte: cutoff },
      },
      select: { id: true },
    });
    if (recent) continue;

    const award: XpAward = {
      xp,
      reason: "deal_found",
      detail: `${percentBelow}% below its average price`,
    };

    await grant(userId, award, productId);
    results.push({ userId, award });
  }

  return results;
}

/** One-off award the first time someone tracks anything. */
export async function awardFirstTrack(userId: string): Promise<XpAward | null> {
  const existing = await prisma.transaction.findFirst({
    where: { userId, reason: "first_track" },
    select: { id: true },
  });
  if (existing) return null;

  const award: XpAward = {
    xp: XP_FIRST_TRACK,
    reason: "first_track",
    detail: "Tracked your first product",
  };
  await grant(userId, award, null);
  return award;
}

/**
 * Write the ledger row and bump the wallet in one transaction, so a crash can
 * never leave a total that disagrees with its own history.
 */
async function grant(userId: string, award: XpAward, productId: string | null) {
  await prisma.$transaction([
    prisma.transaction.create({
      data: {
        userId,
        productId,
        xpChange: award.xp,
        reason: award.reason,
        detail: award.detail,
      },
    }),
    prisma.wallet.update({
      where: { userId },
      data: { xp: { increment: award.xp } },
    }),
  ]);
}

// ---- levels ----------------------------------------------------------------

/**
 * Levels use a widening curve so early progress feels quick and later levels
 * mean something: level N needs 50 * N * (N-1) / 2 XP.
 */
export function levelFromXp(xp: number): {
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progress: number;
} {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;

  const currentLevelXp = xpForLevel(level);
  const nextLevelXp = xpForLevel(level + 1);
  const span = nextLevelXp - currentLevelXp;

  return {
    level,
    currentLevelXp,
    nextLevelXp,
    progress: span > 0 ? (xp - currentLevelXp) / span : 0,
  };
}

function xpForLevel(level: number): number {
  return (50 * level * (level - 1)) / 2;
}

/** Shown next to the level, so a number alone doesn't have to carry meaning. */
export function levelTitle(level: number): string {
  if (level >= 20) return "Sweep Master";
  if (level >= 15) return "Deal Hunter";
  if (level >= 10) return "Bargain Pro";
  if (level >= 6) return "Savvy Shopper";
  if (level >= 3) return "Deal Spotter";
  return "Newcomer";
}

/** Leaderboards must never show an email address. */
export function displayName(user: {
  id: string;
  username: string | null;
}): string {
  return user.username ?? `Sweeper #${user.id.slice(0, 4).toUpperCase()}`;
}
