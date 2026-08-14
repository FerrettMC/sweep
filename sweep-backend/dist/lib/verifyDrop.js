// lib/verifyDrop.ts
//
// A second opinion on price drops that look too good to be true.
//
// Every notification rule until now was a FLOOR — don't wake someone for 40
// cents. This is the ceiling, and it exists because of how scrapers actually
// fail. They rarely return nonsense; they return a real number from the wrong
// place on the page:
//
//   - Walmart serves two payload shapes, and in one of them the field named
//     `itemPrice` is the WAS price. We shipped that bug once already.
//   - eBay listings quote "from $X" and auction opening bids.
//   - Best Buy's product pages don't load from datacenter IPs, so its scraper
//     searches by url slug — a near-miss match is a different SKU's price.
//   - Plenty of pages quote an accessory's price near the product's.
//
// Each of those produces a plausible-looking number that is simply not this
// product's price, and the resulting "down 91%!" alert sends someone to a
// store to find nothing. For a price tracker that's the worst failure there
// is: missing a deal is forgivable, crying wolf is not.
//
// So: anything past the threshold gets re-scraped once before we act on it. A
// transient parse error won't reproduce. A genuine clearance will. The cost is
// one extra request on a path that should almost never fire.
import { recordCheck } from "./health.js";
import { prisma } from "./prisma.js";
import { adapters } from "./scrapers/index.js";
import { isRetailer } from "./scrapers/types.js";
/**
 * Drops steeper than this are treated as suspect until confirmed.
 *
 * 70% is deliberately generous — real clearances, open-box units and doorbuster
 * sales do reach 60-70%, and this must not second-guess those. It's aimed at
 * the 85%+ readings that essentially only come from parsing the wrong element.
 */
export const SUSPECT_DROP_PERCENT = 70;
/** How far the confirming scrape may differ and still count as agreement. */
const AGREEMENT_TOLERANCE = 0.02;
export async function verifyDrop(input) {
    const dropPercent = ((input.previousPrice - input.newPrice) / input.previousPrice) * 100;
    // The overwhelmingly common case: nothing unusual, no extra request.
    if (dropPercent < SUSPECT_DROP_PERCENT) {
        return { believable: true, reason: "within-normal-range" };
    }
    const product = await prisma.product.findUnique({ where: { id: input.productId } });
    if (!product || !isRetailer(product.retailer)) {
        return {
            believable: false,
            reason: "recheck-failed",
            detail: "product or retailer missing",
        };
    }
    const result = await adapters[product.retailer].scrapeProduct(product.url);
    await recordCheck({
        retailer: product.retailer,
        status: result.status,
        productId: product.id,
        detail: result.status === "success" ? "drop re-verification" : result.detail,
        durationMs: result.durationMs,
    });
    if (result.status !== "success" || result.data.price === null) {
        // Can't confirm, so don't act. The price we already stored stands; the next
        // scheduled check settles it either way.
        return {
            believable: false,
            reason: "recheck-failed",
            detail: `re-scrape ${result.status}`,
        };
    }
    const confirmed = result.data.price;
    const difference = Math.abs(confirmed - input.newPrice) / Math.max(input.newPrice, 1);
    if (difference <= AGREEMENT_TOLERANCE) {
        return { believable: true, reason: "confirmed-by-recheck" };
    }
    return {
        believable: false,
        reason: "recheck-disagreed",
        detail: `first read ${input.newPrice}, re-read ${confirmed}`,
    };
}
