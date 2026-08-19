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
  /**
   * Set spending limits PER CATEGORY and get warned when close.
   *
   * The single overall monthly budget is not gated — every tier gets one. A
   * budget tracker that can't hold a budget isn't a tracker, and gutting the
   * free tier that far would make the whole feature read as bait. The paid
   * step is slicing that budget up by category.
   */
  budgetLimits: boolean;
  /** Define your own categories beyond the defaults. */
  customCategories: boolean;
  /** Export to CSV. */
  budgetExport: boolean;

  /**
   * Product lookups a day — one enriched page about one product.
   *
   * Replaces "Sweep this deal", and the numbers moved a long way because the
   * work did. A sweep fanned out to every retailer and re-read history across
   * all of them, which is why it was rationed at 1/day. A lookup is a single
   * call to a single store, so it can be the thing people open the app for
   * rather than a rationed novelty.
   *
   * Metered on its own counter rather than sharing the search allowance: the
   * two are different actions with different costs, and a person who spends
   * their day reading product pages shouldn't lose the ability to search.
   */
  lookupsPerDay: number;

  // ---- deal radar ----
  //
  // A standing search that watches every store for something you haven't found
  // yet. The paid step here is deliberately about LABOUR, not capability: a
  // free radar searches the same stores with the same target price, the
  // user just has to press refresh. Crippling what free users can look for
  // would leave them holding a feature that exists and does nothing.
  /**
   * Results returned per store in a compiled search.
   *
   * `min === max` means the tier has no choice. Fewer results is a legitimate
   * preference, not just a downgrade: a compiled search fans out to every
   * store, and a smaller number comes back faster.
   *
   * Costs money on Amazon specifically — Bright Data bills per RESULT on the
   * search endpoint, so eight results is twice the credits of four. That's why
   * the ceiling rises with the tier rather than being generous to everyone.
   */
  resultsPerRetailer: { min: number; max: number; default: number };

  /** How many standing searches this tier may keep. */
  maxSavedSearches: number;
  /**
   * How often Sweep re-runs them on its own. Zero means manual refresh only,
   * which is what bounds the free tier's cost — it can't scale with signups
   * because nothing happens unless someone opens the app.
   */
  savedSearchIntervalMinutes: number;
  /**
   * Manual "refresh my radars" runs a day.
   *
   * Never unlimited, even on Ultimate. A refresh is a full retailer fan-out —
   * exactly a compiled search — so an unlimited allowance here would be an
   * unlimited search allowance wearing a different hat, straight past
   * searchesPerDay.
   */
  radarRefreshesPerDay: number;

  /**
   * New radars plus keyword edits per day.
   *
   * Without this, the concurrent radar cap means nothing: create, refresh,
   * delete, repeat — or just rename the one you have — and a radar becomes a
   * general-purpose search box. Renames count precisely because renaming is
   * the cheaper version of the same trick.
   */
  radarChangesPerDay: number;

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
    // Raised from 1, then from 5. One search a day is not a product anyone can
    // form an opinion about, and free users are ~98% of traffic — they are the
    // top of the funnel, not a cost centre to be minimised.
    //
    // Ten rather than five for two reasons. It reads as a real allowance
    // rather than a sample, and it opens a wide gap over the 2 a guest gets,
    // which is the only thing making an account worth creating.
    //
    // Affordable because of keyword caching: a repeat search for a popular
    // term costs nothing, so this is nowhere near ten times the Amazon bill.
    searchesPerDay: 10,
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
    // Deliberately generous, and deliberately more than the search allowance:
    // a lookup is one call to one store, so it costs less than a fan-out.
    lookupsPerDay: 12,
    resultsPerRetailer: { min: 4, max: 4, default: 4 },
    maxSavedSearches: 1,
    savedSearchIntervalMinutes: 0,
    radarRefreshesPerDay: 2,
    radarChangesPerDay: 3,

    maxLists: 1,
    maxItemsPerList: 10,
    shareableLists: true,
  },
  pro: {
    maxTrackedProducts: 20,
    // Raised from 10. Under Bright Data a compiled search cost 4 credits (one
    // per Amazon result); amazonscraperapi bills per request, so it's 1. The
    // old cap was priced for the old billing.
    searchesPerDay: 75,
    historyDays: 90,
    // Every 4 hours. Six checks a day catches any real drop — price cuts last
    // hours or days, not minutes — and it leaves a genuine 4× step up to
    // Ultimate rather than a marginal one.
    checkIntervalMinutes: 240,
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
    lookupsPerDay: 30,
    resultsPerRetailer: { min: 3, max: 6, default: 4 },
    maxSavedSearches: 5,
    savedSearchIntervalMinutes: 12 * 60,
    radarRefreshesPerDay: 20,
    radarChangesPerDay: 10,

    maxLists: 5,
    maxItemsPerList: 30,
    shareableLists: true,
  },
  ultimate: {
    maxTrackedProducts: 100,
    // Effectively unlimited for a human — nobody runs 200 searches a day — but
    // still a number. "Unlimited" is the one knob that scales with signups
    // rather than with bounded usage, which is the trap worth avoiding.
    searchesPerDay: 400,
    historyDays: null,
    // Hourly rather than every 30 minutes. Halves the Amazon bill for the
    // tier that was consuming half the entire budget, for a difference nobody
    // can act on — you can't buy something twice as fast.
    checkIntervalMinutes: 60,
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
    lookupsPerDay: 100,
    resultsPerRetailer: { min: 3, max: 8, default: 4 },
    maxSavedSearches: 15,
    savedSearchIntervalMinutes: 6 * 60,
    // Deliberately a number, not unlimited: see radarRefreshesPerDay.
    radarRefreshesPerDay: 40,
    radarChangesPerDay: 25,

    maxLists: 20,
    maxItemsPerList: 100,
    shareableLists: true,
  },
};

/**
 * Guests have no account: enough to see the app work, not enough to live on.
 *
 * Kept small because a guest is identified only by a device id, which is the
 * one identity in the app that costs nothing to discard and reissue.
 */
export const GUEST_LIMITS = {
  searchesPerDay: 2,
  lookupsPerDay: 3,
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
