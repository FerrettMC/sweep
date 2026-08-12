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
        manualChecksPerDay: 5,
        manualCheckCooldownMinutes: null,
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
        manualChecksPerDay: null,
        manualCheckCooldownMinutes: 30,
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
        // Unlimited, deliberately: this is bounded by a human tapping a button,
        // not by signups, so it can't run away the way an unlimited tracking
        // allowance would.
        manualChecksPerDay: null,
        manualCheckCooldownMinutes: null,
        customThresholds: true,
        showAds: false,
        priorityQueue: true,
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
