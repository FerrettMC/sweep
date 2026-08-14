// lib/highlights.ts
//
// Picks the handful of results worth showing above the per-store columns.
//
// A compiled search returns a few products from every store, which is a wall.
// Most people are asking one of three questions — what's the biggest discount,
// what's actually good, who's cheapest — so answer those first and keep the
// full per-store breakdown underneath for anyone who wants it.
//
// Biggest drop leads because it's the most time-sensitive: the cheapest item is
// still cheapest tomorrow, but a drop might not still be there.
/** Ratings below this many reviews are noise, not signal. */
const MIN_RATINGS_FOR_BEST_RATED = 25;
/** A "discount" smaller than this is marketing, not a deal. */
const MIN_DISCOUNT_PERCENT = 10;
export function pickHighlights(products) {
    const priced = products.filter((p) => p.price !== null && p.price > 0);
    if (priced.length === 0)
        return [];
    const highlights = [];
    const claimed = new Set();
    const key = (p) => `${p.retailer}:${p.retailerId}`;
    // Order matters twice over: it's the order the cards appear in, and it's the
    // order they claim products. Whoever picks first gets the product, so claim
    // priority has to match display priority — otherwise a card could be labelled
    // "Biggest drop" while showing the second-biggest, which is just false.
    // 1. Biggest genuine discount off the retailer's own list price.
    const discounted = priced
        .map((p) => ({
        product: p,
        percent: p.listPrice && p.listPrice > p.price
            ? Math.round(((p.listPrice - p.price) / p.listPrice) * 100)
            : 0,
    }))
        .filter((entry) => entry.percent >= MIN_DISCOUNT_PERCENT)
        .sort((a, b) => b.percent - a.percent);
    const biggest = discounted[0];
    if (biggest) {
        highlights.push({
            kind: "biggest_discount",
            label: "Biggest drop",
            reason: `${biggest.percent}% off its usual price`,
            product: biggest.product,
        });
        claimed.add(key(biggest.product));
    }
    // 2. Best reviewed, ignoring items with too few ratings to mean anything.
    const rated = priced
        .filter((p) => p.rating !== null && (p.ratingCount ?? 0) >= MIN_RATINGS_FOR_BEST_RATED)
        .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.ratingCount ?? 0) - (a.ratingCount ?? 0));
    const bestRated = rated.find((p) => !claimed.has(key(p)));
    if (bestRated) {
        highlights.push({
            kind: "best_rated",
            label: "Best reviewed",
            reason: `${bestRated.rating?.toFixed(1)}★ from ${formatCount(bestRated.ratingCount ?? 0)} ratings`,
            product: bestRated,
        });
        claimed.add(key(bestRated));
    }
    // 3. Cheapest overall, last. If the genuinely cheapest item already won one
    // of the labels above, no Cheapest card is shown rather than promoting the
    // second-cheapest under a name that wouldn't be true.
    const cheapest = [...priced].sort((a, b) => a.price - b.price)[0];
    if (cheapest && !claimed.has(key(cheapest))) {
        highlights.push({
            kind: "cheapest",
            label: "Cheapest",
            reason: `Lowest price of ${priced.length} results`,
            product: cheapest,
        });
    }
    return highlights;
}
function formatCount(count) {
    if (count >= 1000)
        return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k`;
    return String(count);
}
