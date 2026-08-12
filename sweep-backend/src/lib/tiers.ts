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
  /**
   * Whether this tier can choose WHERE in the interval its checks land.
   * Pro picks a minute of the hour (:00–:59), Ultimate picks within the half
   * hour (:00–:29, mirrored 30 minutes later).
   */
  canSetCheckMinute: boolean;
  /**
   * Manual "Check price now" budget, expressed two ways because the tiers
   * limit it differently:
   *   free     — 10 a day, no cooldown
   *   pro      — no daily cap, but one every 30 minutes
   *   ultimate — neither
   * Null means "no limit of this kind".
   */
  manualChecksPerDay: number | null;
  manualCheckCooldownMinutes: number | null;
  /** Pro and above: "notify me only below $X". */
  customThresholds: boolean;
  showAds: boolean;
  /** Ultimate is checked before everyone else when the queue is long. */
  priorityQueue: boolean;

  // ---- budget tracker ----
  //
  // Budget entries are plain rows and cost effectively nothing, so the free
  // tier gets unlimited logging. Capping volume here would feel punitive
  // without saving anything. The paid split is on FEATURES instead — how far
  // back you can look, and what the app does with the data.
  /** How many months of spending history are readable. Null = everything. */
  budgetHistoryMonths: number | null;
  /** Set spending limits per category and get warned when close. */
  budgetLimits: boolean;
  /** Define your own categories beyond the defaults. */
  customCategories: boolean;
  /** Export to CSV. */
  budgetExport: boolean;

  // ---- lists / wishlists ----
  //
  // Unlike budget rows, every list item is a product that has to be price
  // checked — so these caps are real cost control, not upsell theatre.
  maxLists: number;
  maxItemsPerList: number;
  /** Share a list by public link. */
  shareableLists: boolean;
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
    canSetCheckMinute: false,
    manualChecksPerDay: 5,
    manualCheckCooldownMinutes: null,
    customThresholds: false,
    showAds: true,
    priorityQueue: false,

    // Deliberately generous: unlimited entries, 3 months of history.
    budgetHistoryMonths: 3,
    budgetLimits: false,
    customCategories: false,
    budgetExport: false,

    maxLists: 1,
    maxItemsPerList: 10,
    shareableLists: true,
  },
  pro: {
    maxTrackedProducts: 20,
    searchesPerDay: 10,
    historyDays: 90,
    // Every 2 hours, not hourly: 12 checks a day is plenty to catch a real
    // drop, and it leaves Ultimate's 30 minutes as a genuine difference
    // rather than a marginal one.
    checkIntervalMinutes: 120,
    fixedCheckTimes: false,
    checkTimesPerDay: 0,
    canSetCheckMinute: true,
    manualChecksPerDay: null,
    manualCheckCooldownMinutes: 30,
    customThresholds: true,
    showAds: false,
    priorityQueue: false,

    budgetHistoryMonths: 12,
    budgetLimits: true,
    customCategories: true,
    budgetExport: true,

    maxLists: 5,
    maxItemsPerList: 30,
    shareableLists: true,
  },
  ultimate: {
    maxTrackedProducts: 100,
    searchesPerDay: 100,
    historyDays: null,
    checkIntervalMinutes: 30,
    fixedCheckTimes: false,
    checkTimesPerDay: 0,
    canSetCheckMinute: true,
    // Unlimited, deliberately: this is bounded by a human tapping a button,
    // not by signups, so it can't run away the way an unlimited tracking
    // allowance would.
    manualChecksPerDay: null,
    manualCheckCooldownMinutes: null,
    customThresholds: true,
    showAds: false,
    priorityQueue: true,

    budgetHistoryMonths: null,
    budgetLimits: true,
    customCategories: true,
    budgetExport: true,

    maxLists: 20,
    maxItemsPerList: 100,
    shareableLists: true,
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
 * The largest minute offset a tier may pick — you can't offset further than
 * the interval itself, and never past 59 since it's expressed as a minute.
 */
export function maxCheckMinute(tier: Tier): number {
  const limits = TIER_LIMITS[tier];
  if (!limits.canSetCheckMinute) return 0;
  return Math.min(limits.checkIntervalMinutes, 60) - 1;
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
