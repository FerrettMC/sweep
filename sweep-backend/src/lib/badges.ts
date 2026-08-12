// lib/badges.ts
//
// Cosmetic badges. Status only — they unlock nothing functional.
//
// That's the point, not a limitation. The moment XP buys extra searches or
// tracking slots, farming it becomes profitable and every anti-abuse rule in
// xp.ts has to hold against someone actually trying. Badges are free to award,
// cost nothing per user however many are earned, and status is what people
// actually chase on a leaderboard anyway.
//
// Every badge is DERIVED from existing data rather than stored. Nothing to
// migrate, nothing to keep in sync, and adding one retroactively awards it to
// everyone who already qualifies.

import { prisma } from "./prisma.js";
import { levelFromXp } from "./xp.js";

export interface Badge {
  id: string;
  label: string;
  description: string;
  /** Ionicons name, so the app doesn't have to map ids to icons itself. */
  icon: string;
  /** Rough rarity, used for colour. */
  tier: "bronze" | "silver" | "gold";
  earned: boolean;
  /** Progress toward earning it, 0–1. Lets the UI show "3 / 10". */
  progress: number;
  progressLabel: string;
}

export interface BadgeStats {
  xp: number;
  level: number;
  dealsFound: number;
  productsTracked: number;
  biggestDropPercent: number;
  dealsOnFeed: number;
}

/** Everything the badge rules need, gathered in one pass. */
export async function collectBadgeStats(userId: string): Promise<BadgeStats> {
  const [wallet, dealTransactions, tracked, feedDeals] = await Promise.all([
    prisma.wallet.findUnique({ where: { userId }, select: { xp: true } }),
    prisma.transaction.findMany({
      where: { userId, reason: "deal_found" },
      select: { xpChange: true },
    }),
    prisma.trackedProduct.count({ where: { userId } }),
    prisma.deal.count({ where: { finderUserId: userId } }),
  ]);

  const xp = wallet?.xp ?? 0;

  return {
    xp,
    level: levelFromXp(xp).level,
    dealsFound: dealTransactions.length,
    productsTracked: tracked,
    // XP for a deal equals its percent below average, so the biggest award is
    // also the biggest drop that user has caught.
    biggestDropPercent: dealTransactions.reduce(
      (best, t) => Math.max(best, t.xpChange),
      0,
    ),
    dealsOnFeed: feedDeals,
  };
}

export function badgesFor(stats: BadgeStats): Badge[] {
  const make = (
    id: string,
    label: string,
    description: string,
    icon: string,
    tier: Badge["tier"],
    current: number,
    target: number,
    unit: string,
  ): Badge => ({
    id,
    label,
    description,
    icon,
    tier,
    earned: current >= target,
    progress: Math.min(1, target > 0 ? current / target : 0),
    progressLabel:
      current >= target ? "Earned" : `${Math.min(current, target)} / ${target} ${unit}`,
  });

  return [
    make("first_find", "First Find", "Catch your first real price drop", "ribbon", "bronze",
      stats.dealsFound, 1, "deals"),
    make("deal_spotter", "Deal Spotter", "Catch 5 price drops", "eye", "bronze",
      stats.dealsFound, 5, "deals"),
    make("deal_hunter", "Deal Hunter", "Catch 25 price drops", "flame", "silver",
      stats.dealsFound, 25, "deals"),
    make("big_saver", "Big Saver", "Catch a drop 40% below average", "trending-down", "silver",
      stats.biggestDropPercent, 40, "%"),
    make("legendary_find", "Legendary Find", "Catch a drop 60% below average", "flash", "gold",
      stats.biggestDropPercent, 60, "%"),
    make("collector", "Collector", "Track 10 products at once", "albums", "bronze",
      stats.productsTracked, 10, "tracked"),
    make("trendsetter", "Trendsetter", "Have 3 of your finds hit the public feed", "megaphone", "silver",
      stats.dealsOnFeed, 3, "featured"),
    make("veteran", "Veteran", "Reach level 10", "trophy", "gold",
      stats.level, 10, "levels"),
  ];
}
