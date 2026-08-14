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
export const TIERS = ["free", "pro", "ultimate"];
export const TIER_LIMITS = {
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
        sweepsPerDay: 0,
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
        searchesPerDay: 30,
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
        sweepsPerDay: 1,
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
        searchesPerDay: 200,
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
        sweepsPerDay: 3,
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
/** Guests have no account. One search a day, and nothing else. */
export const GUEST_LIMITS = {
    searchesPerDay: 1,
    maxTrackedProducts: 0,
};
/** Extra searches a free user can unlock per day by watching rewarded ads. */
export const MAX_REWARDED_SEARCHES_PER_DAY = 3;
/**
 * Resolve the tier actually in force. A wallet can carry a tier that has since
 * expired (promo code lapsed, subscription ended) — expiry is checked here, at
 * read time, so nothing depends on a background job having run.
 */
export function effectiveTier(wallet) {
    const claimed = wallet.tier;
    if (!TIERS.includes(claimed))
        return "free";
    if (claimed === "free")
        return "free";
    if (wallet.tierExpiresAt && wallet.tierExpiresAt.getTime() < Date.now()) {
        return "free";
    }
    return claimed;
}
export function limitsFor(wallet) {
    return TIER_LIMITS[effectiveTier(wallet)];
}
/**
 * The largest minute offset a tier may pick — you can't offset further than
 * the interval itself, and never past 59 since it's expressed as a minute.
 */
export function maxCheckMinute(tier) {
    const limits = TIER_LIMITS[tier];
    if (!limits.canSetCheckMinute)
        return 0;
    return Math.min(limits.checkIntervalMinutes, 60) - 1;
}
/**
 * The oldest price point a tier may read. Null means no cutoff.
 * History keeps accruing for everyone — the tier gates the window you can see,
 * so upgrading reveals data that was already collected.
 */
export function historyCutoff(tier) {
    const days = TIER_LIMITS[tier].historyDays;
    if (days === null)
        return null;
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}
