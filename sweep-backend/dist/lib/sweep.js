// lib/sweep.ts
//
// "Sweep this deal" — the verdict on whether something is actually worth buying
// right now.
//
// Five checks, and they're deliberately ordered by how much we can be trusted
// on them:
//
//   1. Is this "sale" real?      — from OUR price history. Nobody else can do
//                                  this, and it can't be wrong: it's our data.
//   2. How big is the discount?  — list vs current, stated plainly.
//   3. Cheaper elsewhere?        — a real fan-out across every other retailer.
//   4. Similar alternatives      — same search, weaker matches, labelled as such.
//   5. Price context             — where this sits against its own history.
//
// Coupons and shipping are absent because we have no source for either. A row
// that says "coupons: coming soon" would be worse than no row.
//
// The whole thing leads with check 1 because it's the one that most often says
// something surprising: a "40% off" badge on a price the item has sat at for
// three weeks is the single most common lie in online retail, and it's the one
// we're uniquely positioned to call out.
import { compareProducts, searchKeyFor } from "./matching.js";
import { prisma } from "./prisma.js";
import { routeQuery, searchAllRetailers } from "./scrapers/index.js";
import { RETAILER_LABELS, isRetailer } from "./scrapers/types.js";
/** History points needed before we'll make a claim about "usual" pricing. */
const MIN_HISTORY_POINTS = 3;
/** Ignore rival prices below this fraction of the source — almost always junk. */
const ABSURDLY_CHEAP = 0.25;
export async function sweepProduct(productId) {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product || product.currentPrice === null || !isRetailer(product.retailer)) {
        return null;
    }
    const price = product.currentPrice;
    // ---- 1 & 2: what does our own history say? ----
    const history = await prisma.priceHistory.findMany({
        where: { productId },
        orderBy: { checkedAt: "asc" },
        select: { price: true, checkedAt: true },
    });
    const prices = history.map((h) => h.price);
    const low = prices.length ? Math.min(...prices) : null;
    const high = prices.length ? Math.max(...prices) : null;
    const average = prices.length
        ? Math.round(prices.reduce((sum, p) => sum + p, 0) / prices.length)
        : null;
    const claimedPercentOff = product.listPrice !== null && product.listPrice > price
        ? Math.round(((product.listPrice - price) / product.listPrice) * 100)
        : null;
    const sale = judgeSale({
        price,
        listPrice: product.listPrice,
        low,
        average,
        points: prices.length,
        claimedPercentOff,
    });
    // ---- 3 & 4: is it cheaper somewhere else? ----
    const keyword = searchKeyFor(product.title);
    const routing = routeQuery(keyword);
    const others = routing.retailers.filter((r) => r !== product.retailer);
    const cheaperElsewhere = [];
    const similar = [];
    const unreachable = [];
    if (others.length > 0) {
        const outcomes = await searchAllRetailers(keyword, 4, others);
        for (const outcome of outcomes) {
            if (outcome.status !== "success") {
                unreachable.push(RETAILER_LABELS[outcome.retailer]);
                continue;
            }
            for (const candidate of outcome.products) {
                if (candidate.price === null)
                    continue;
                // A price a quarter of the original is a parsing artefact or an
                // accessory listing far more often than it's a deal.
                if (candidate.price < price * ABSURDLY_CHEAP)
                    continue;
                const match = compareProducts(product, candidate);
                if (match.confidence === "unrelated")
                    continue;
                const alternative = {
                    retailer: outcome.retailer,
                    retailerLabel: RETAILER_LABELS[outcome.retailer],
                    title: candidate.title,
                    url: candidate.url,
                    imageUrl: candidate.imageUrl,
                    price: candidate.price,
                    confidence: match.confidence,
                    savings: price - candidate.price,
                    caveats: match.caveats,
                };
                // Only a confident, cheaper, like-for-like match earns the headline.
                if (match.confidence === "same" && candidate.price < price) {
                    cheaperElsewhere.push(alternative);
                }
                else if (candidate.price < price) {
                    similar.push(alternative);
                }
            }
        }
    }
    cheaperElsewhere.sort((a, b) => b.savings - a.savings);
    similar.sort((a, b) => b.savings - a.savings);
    const bestSaving = cheaperElsewhere[0]?.savings ?? 0;
    return {
        product: {
            id: product.id,
            title: product.title,
            retailer: product.retailer,
            retailerLabel: RETAILER_LABELS[product.retailer],
            url: product.url,
            imageUrl: product.imageUrl,
            price,
            listPrice: product.listPrice,
        },
        sale,
        history: {
            points: prices.length,
            low,
            high,
            average,
            firstSeen: history[0]?.checkedAt ?? null,
        },
        cheaperElsewhere: cheaperElsewhere.slice(0, 4),
        similar: similar.slice(0, 4),
        unreachable,
        bestSaving,
        headline: buildHeadline(bestSaving, cheaperElsewhere[0], sale),
    };
}
/**
 * The honest read on a "sale".
 *
 * A retailer's struck-through price is whatever they say it is. Our own
 * observed history is the only number here that can't be staged, so when the
 * two disagree we say so plainly.
 */
function judgeSale(input) {
    const { price, low, average, points, claimedPercentOff } = input;
    if (points < MIN_HISTORY_POINTS || average === null || low === null) {
        return {
            verdict: "no-history",
            headline: "Not enough history yet",
            detail: claimedPercentOff !== null
                ? `The store claims ${claimedPercentOff}% off. Track it for a few days and Sweep can tell you whether that's real.`
                : "Track this for a few days and Sweep can tell you whether a sale is genuine.",
            claimedPercentOff,
            realPercentBelowTypical: null,
        };
    }
    const realPercentBelowTypical = Math.round(((average - price) / average) * 100);
    if (price <= low) {
        return {
            verdict: "genuine-low",
            headline: "Lowest price we've seen",
            detail: `Across ${points} checks this has never been cheaper.`,
            claimedPercentOff,
            realPercentBelowTypical,
        };
    }
    if (realPercentBelowTypical >= 5) {
        return {
            verdict: "good-price",
            headline: `${realPercentBelowTypical}% below its usual price`,
            detail: `Typically ${formatCents(average)} across ${points} checks. Lowest we've recorded is ${formatCents(low)}.`,
            claimedPercentOff,
            realPercentBelowTypical,
        };
    }
    if (realPercentBelowTypical <= -5) {
        return {
            verdict: "above-usual",
            headline: "Pricier than usual right now",
            detail: `This normally sits around ${formatCents(average)}. It's been as low as ${formatCents(low)}.`,
            claimedPercentOff,
            realPercentBelowTypical,
        };
    }
    return {
        verdict: "typical-price",
        headline: claimedPercentOff !== null
            ? `That "${claimedPercentOff}% off" is just the normal price`
            : "This is its normal price",
        detail: `It's sat around ${formatCents(average)} across ${points} checks. Lowest we've recorded is ${formatCents(low)}.`,
        claimedPercentOff,
        realPercentBelowTypical,
    };
}
function buildHeadline(bestSaving, best, sale) {
    if (best && bestSaving > 0) {
        return `Swept! You can get essentially the same product for ${formatCents(bestSaving)} less at ${best.retailerLabel}.`;
    }
    if (sale.verdict === "genuine-low") {
        return "Swept! Nowhere cheaper, and it's the lowest we've seen. Good time to buy.";
    }
    if (sale.verdict === "typical-price") {
        return "Swept. No cheaper option found — but this isn't really a sale.";
    }
    if (sale.verdict === "above-usual") {
        return "Swept. Nothing cheaper elsewhere, but this is pricier than usual. Worth waiting.";
    }
    return "Swept. This is the best price we found.";
}
function formatCents(cents) {
    return `$${(cents / 100).toFixed(2)}`;
}
