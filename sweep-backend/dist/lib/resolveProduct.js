// lib/resolveProduct.ts
//
// Turning "the thing the client pointed at" into a real Product row.
//
// Callers can identify a product two ways: a pasted url, or a retailer +
// retailerId pair taken from a search result. The second one has a trap in it.
//
// Synthesizing a url from an id throws away the url we already had, and not
// every retailer can rebuild one that works. Best Buy is the clear case: its
// product pages don't load from datacenter IPs, so the scraper recovers the
// product NAME from the url slug and searches for it instead. A synthesized
// `/site/-/6447384.p` has no slug, so there's nothing to search for and the
// lookup fails with "couldn't recover a search term".
//
// So: always check the database by (retailer, retailerId) first — that's the
// natural key, and a stored row carries the real url. Only fall back to
// synthesizing when we've genuinely never seen the product.
import { prisma } from "./prisma.js";
import { recordCheck } from "./health.js";
import { upsertScrapedProduct } from "./priceChecker.js";
import { adapters } from "./scrapers/index.js";
import { isRetailer, storeListPhrase } from "./scrapers/types.js";
import { normalizeProductUrl } from "./scrapers/url.js";
/** How recently a cached product counts as fresh enough to reuse as-is. */
const FRESH_MS = 30 * 60 * 1000;
export async function resolveProduct(input) {
    let url;
    let retailer;
    let known = null;
    if (typeof input.url === "string" && input.url.trim()) {
        const normalized = await normalizeProductUrl(input.url);
        if (!normalized.ok) {
            return normalized.reason === "unsupported"
                ? {
                    ok: false,
                    status: 400,
                    error: `Sweep doesn't support ${normalized.detail} yet. Try ${storeListPhrase()}.`,
                    code: "UNSUPPORTED_RETAILER",
                    detail: normalized.detail,
                }
                : {
                    ok: false,
                    status: 400,
                    error: "That doesn't look like a product link.",
                    code: "INVALID_URL",
                };
        }
        url = normalized.value.url;
        retailer = normalized.value.retailer;
        known = await prisma.product.findFirst({ where: { retailer, url } });
    }
    else if (typeof input.retailer === "string" &&
        isRetailer(input.retailer) &&
        input.retailerId) {
        retailer = input.retailer;
        const retailerId = String(input.retailerId);
        // The important line: prefer the url we already stored for this product.
        known = await prisma.product.findUnique({
            where: { retailer_retailerId: { retailer, retailerId } },
        });
        url = known?.url ?? adapters[retailer].productUrl(retailerId);
    }
    else {
        return {
            ok: false,
            status: 400,
            error: "Provide either a url, or a retailer and retailerId",
            code: "INVALID_TARGET",
        };
    }
    // A recently-checked product needs no scrape at all — that's the shared
    // cache doing its job.
    if (known?.lastCheckedAt && Date.now() - known.lastCheckedAt.getTime() < FRESH_MS) {
        return { ok: true, product: known };
    }
    const result = await adapters[retailer].scrapeProduct(url);
    await recordCheck({
        retailer,
        status: result.status,
        productId: known?.id ?? null,
        detail: result.status === "success" ? null : result.detail,
        durationMs: result.durationMs,
    });
    if (result.status !== "success") {
        // A stale copy beats an error: if we've seen this product before, hand back
        // what we have rather than refusing the whole action over one bad scrape.
        if (known)
            return { ok: true, product: known };
        return {
            ok: false,
            status: 502,
            error: result.status === "blocked"
                ? `That store is blocking price checks right now. Try again later.`
                : `Couldn't read that product page right now. Try again in a moment.`,
            code: result.status === "blocked" ? "RETAILER_BLOCKED" : "SCRAPE_FAILED",
            retailer,
        };
    }
    return { ok: true, product: await upsertScrapedProduct(result.data) };
}
