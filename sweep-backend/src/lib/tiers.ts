// lib/tiers.ts
//
// Every limit in the app is defined here and enforced server-side. The client
// gets told what its limits are so it can render them, but it never gets to
// assert them — a client claiming "ultimate" changes nothing.
//
// Numbers come straight from the pricing model. Note that no tier is
// unlimited: "unlimited" is the one knob that scales with total signups rather
// than with bounded usage, which is the trap that nearly sank the first draft
// of this pricing model.

export const TIERS = ["free", "pro", "ultimate"] as const;
export type Tier = (typeof TIERS)[number];

export interface TierLimits {
  /** How many distinct products a user may track at once. */
  maxTrackedProducts: number;
  /** Compiled multi-site searches per day. */
  searchesPerDay: number;
  /** How far back price history is readable, in days. Null = everything. */
  historyDays: number | null;
  /** Minutes between scheduled price checks for this user's products. */
  checkIntervalMinutes: number;
  /** Free tier picks fixed times of day rather than a rolling interval. */
  fixedCheckTimes: boolean;
  /** How many fixed times of day the user may pick. 0 when not applicable. */
  checkTimesPerDay: number;
  /** Ultimate-only: "notify me only below $X". */
  customThresholds: boolean;
  showAds: boolean;
  /** Ultimate is checked before everyone else when the queue is long. */
  priorityQueue: boolean;
}

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  free: {
    maxTrackedProducts: 3,
    searchesPerDay: 1,
    historyDays: 30,
    // Free users choose 2 fixed times of day instead of a rolling interval,
    // which bounds scraping load predictably.
    checkIntervalMinutes: 12 * 60,
    fixedCheckTimes: true,
    checkTimesPerDay: 2,
    customThresholds: false,
    showAds: true,
    priorityQueue: false,
  },
  pro: {
    maxTrackedProducts: 20,
    searchesPerDay: 10,
    historyDays: 90,
    checkIntervalMinutes: 60,
    fixedCheckTimes: false,
    checkTimesPerDay: 0,
    customThresholds: false,
    showAds: false,
    priorityQueue: false,
  },
  ultimate: {
    maxTrackedProducts: 100,
    searchesPerDay: 100,
    historyDays: null,
    checkIntervalMinutes: 30,
    fixedCheckTimes: false,
    checkTimesPerDay: 0,
    customThresholds: true,
    showAds: false,
    priorityQueue: true,
  },
};

/** Guests have no account. One search a day, and nothing else. */
export const GUEST_LIMITS = {
  searchesPerDay: 1,
  maxTrackedProducts: 0,
} as const;

/** Extra searches a free user can unlock per day by watching rewarded ads. */
export const MAX_REWARDED_SEARCHES_PER_DAY = 3;

/**
 * Resolve the tier actually in force. A wallet can carry a tier that has since
 * expired (promo code lapsed, subscription ended) — expiry is checked here, at
 * read time, so nothing depends on a background job having run.
 */
export function effectiveTier(wallet: {
  tier: string;
  tierExpiresAt: Date | null;
}): Tier {
  const claimed = wallet.tier as Tier;
  if (!TIERS.includes(claimed)) return "free";
  if (claimed === "free") return "free";
  if (wallet.tierExpiresAt && wallet.tierExpiresAt.getTime() < Date.now()) {
    return "free";
  }
  return claimed;
}

export function limitsFor(wallet: {
  tier: string;
  tierExpiresAt: Date | null;
}): TierLimits {
  return TIER_LIMITS[effectiveTier(wallet)];
}

/**
 * The oldest price point a tier may read. Null means no cutoff.
 * History keeps accruing for everyone — the tier gates the window you can see,
 * so upgrading reveals data that was already collected.
 */
export function historyCutoff(tier: Tier): Date | null {
  const days = TIER_LIMITS[tier].historyDays;
  if (days === null) return null;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}
