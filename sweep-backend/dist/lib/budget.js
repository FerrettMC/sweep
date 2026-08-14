// lib/budget.ts
//
// Categories and month maths for the budget tracker.
//
// Scope is deliberately *shopping* spend, not household finance. Sweep is a
// shopping companion, and the moment this grows Rent and Utilities it stops
// complementing price tracking and starts competing with real budget apps —
// badly, because it has no bank connection and never will.
//
// The categories below are the things people buy online, which is also the
// spend Sweep already knows something about.
export const DEFAULT_CATEGORIES = [
    "Electronics",
    "Clothing",
    "Home",
    "Beauty & Health",
    "Gaming",
    "Gifts",
    "Groceries",
    "Other",
];
/** Categories a retailer's items usually land in, for prefilling "I bought this". */
const RETAILER_DEFAULT_CATEGORY = {
    bestbuy: "Electronics",
    newegg: "Electronics",
    asos: "Clothing",
};
/**
 * A best guess at the category for a purchase logged from a tracked product.
 *
 * Only ever a prefill — the user can change it in the sheet before saving.
 * Guessing from the retailer is crude but right often enough to save a tap,
 * and "Other" is a harmless miss.
 */
export function guessCategory(retailer, title) {
    const byRetailer = RETAILER_DEFAULT_CATEGORY[retailer];
    if (byRetailer)
        return byRetailer;
    const text = title.toLowerCase();
    if (/\b(laptop|monitor|headphone|earbud|tv|ssd|gpu|keyboard|mouse|phone|tablet|camera|charger)\b/.test(text))
        return "Electronics";
    if (/\b(shirt|jeans|dress|shoes|sneaker|jacket|hoodie|socks|coat)\b/.test(text))
        return "Clothing";
    if (/\b(ps5|xbox|nintendo|switch|controller|console|game)\b/.test(text))
        return "Gaming";
    if (/\b(shampoo|serum|vitamin|toothbrush|razor|lotion|makeup)\b/.test(text))
        return "Beauty & Health";
    if (/\b(sofa|mattress|lamp|vacuum|blender|cookware|pillow|towel)\b/.test(text))
        return "Home";
    return "Other";
}
/** Start of the month containing `date`, in UTC. */
export function monthStart(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}
/** Start of the month after the one containing `date`, in UTC. */
export function monthEnd(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}
/** "2026-08" -> that month's start, or null if it isn't a valid month. */
export function parseMonth(value) {
    if (typeof value !== "string")
        return null;
    const match = value.match(/^(\d{4})-(\d{2})$/);
    if (!match)
        return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12 || year < 2000 || year > 2100)
        return null;
    return new Date(Date.UTC(year, month - 1, 1));
}
export function formatMonth(date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
/**
 * The earliest month this tier may read, or null for unlimited.
 *
 * History is one of the real paid differences, so it's enforced server-side
 * rather than hidden in the UI — asking for an out-of-range month returns a
 * clear refusal instead of a silently empty page, which would just look broken.
 */
export function earliestReadableMonth(limits, now) {
    if (limits.budgetHistoryMonths === null)
        return null;
    const start = monthStart(now);
    // `budgetHistoryMonths: 3` means this month plus the two before it.
    return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - (limits.budgetHistoryMonths - 1), 1));
}
/**
 * Categories offered in the picker: the defaults, plus anything this user has
 * actually used or set a limit on.
 *
 * Derived rather than stored in its own table. A custom category only exists
 * because it's attached to something, so there's nothing to keep in sync and
 * nothing to garbage-collect when the last entry using it is deleted.
 */
export function availableCategories(used) {
    const seen = new Set(DEFAULT_CATEGORIES);
    const extra = used.filter((category) => !seen.has(category)).sort();
    return [...DEFAULT_CATEGORIES, ...new Set(extra)];
}
export const MAX_CATEGORY_LENGTH = 24;
export const MAX_DESCRIPTION_LENGTH = 120;
/** $100k. High enough never to bite a real purchase, low enough to catch a typo. */
export const MAX_AMOUNT_CENTS = 10_000_000;
