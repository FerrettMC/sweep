// lib/scrapers/types.ts
//
// One shape every retailer normalizes into, so the rest of the app never has
// to know whether a price came from a JSON API, a Next.js data blob, or an
// Apollo SSR payload.
export const RETAILERS = [
    "amazon",
    "walmart",
    "bestbuy",
    "ebay",
    "newegg",
    "asos",
];
export function isRetailer(value) {
    return RETAILERS.includes(value);
}
export const RETAILER_LABELS = {
    amazon: "Amazon",
    walmart: "Walmart",
    bestbuy: "Best Buy",
    ebay: "eBay",
    newegg: "Newegg",
    asos: "ASOS",
};
export function ok(data, durationMs) {
    return { status: "success", data, durationMs };
}
export function fail(status, detail, durationMs) {
    // Bound what we store — a blocked response can be a full HTML error page and
    // we only need enough to tell the failure modes apart in an alert email.
    return { status, data: null, detail: detail.slice(0, 2000), durationMs };
}
/** Dollars (or a "$1,234.56" string) to integer cents. */
export function toCents(value) {
    if (value === null || value === undefined)
        return null;
    const n = typeof value === "number"
        ? value
        : Number(String(value).replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(n) || n <= 0)
        return null;
    return Math.round(n * 100);
}
