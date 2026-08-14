// lib/scrapers/index.ts
//
// One registry, so routes and the scheduler never branch on retailer.
// Each retailer supplies the same three things: search, re-check one product
// by url, and recognize its own urls.
import { scrapeAmazonProduct, searchAmazonProducts } from "./amazon.js";
import { bestBuyProductUrl, scrapeBestBuyProduct, searchBestBuy } from "./bestbuy.js";
import { ebayProductUrl, scrapeEbayProduct, searchEbay } from "./ebay.js";
import { asosProductUrl, scrapeAsosProduct, searchAsos } from "./asos.js";
import { neweggProductUrl, scrapeNeweggProduct, searchNewegg } from "./newegg.js";
import { scrapeWalmartProduct, searchWalmart, walmartProductUrl } from "./walmart.js";
import { classifyQuery } from "../categories.js";
import { RETAILERS, } from "./types.js";
export const adapters = {
    amazon: {
        search: searchAmazonProducts,
        scrapeProduct: scrapeAmazonProduct,
        productUrl: (id) => `https://www.amazon.com/dp/${id}`,
        matchesUrl: (url) => /(^|\.)amazon\.[a-z.]+$/i.test(hostOf(url)),
        metered: true,
        // Bright Data absorbs Amazon's blocking, but each call costs quota.
        concurrency: 1,
        categories: null,
    },
    walmart: {
        search: searchWalmart,
        scrapeProduct: scrapeWalmartProduct,
        productUrl: walmartProductUrl,
        matchesUrl: (url) => /(^|\.)walmart\.com$/i.test(hostOf(url)),
        metered: false,
        // Measured: bursts of back-to-back requests get "Robot or human?" (a 200
        // with an interstitial, not a 429), and it clears on its own within
        // minutes. Three in flight is fine; three in flight with no gap is not.
        // 500ms caps us at ~2 req/s, which is far above anything the scheduler
        // needs even at scale — see the throughput note in docs.
        concurrency: 3,
        minIntervalMs: 500,
        categories: null,
    },
    newegg: {
        search: searchNewegg,
        scrapeProduct: scrapeNeweggProduct,
        productUrl: neweggProductUrl,
        matchesUrl: (url) => /(^|\.)newegg\.com$/i.test(hostOf(url)),
        metered: false,
        concurrency: 2,
        minIntervalMs: 400,
        categories: ["electronics"],
    },
    asos: {
        search: searchAsos,
        scrapeProduct: scrapeAsosProduct,
        productUrl: asosProductUrl,
        matchesUrl: (url) => /(^|\.)asos\.com$/i.test(hostOf(url)),
        metered: false,
        concurrency: 2,
        minIntervalMs: 400,
        categories: ["clothing"],
    },
    bestbuy: {
        search: searchBestBuy,
        scrapeProduct: scrapeBestBuyProduct,
        productUrl: bestBuyProductUrl,
        matchesUrl: (url) => /(^|\.)bestbuy\.com$/i.test(hostOf(url)),
        metered: false,
        // Each refresh is a full search-page fetch — pace them.
        concurrency: 1,
        minIntervalMs: 3000,
        categories: ["electronics"],
    },
    ebay: {
        search: searchEbay,
        scrapeProduct: scrapeEbayProduct,
        productUrl: ebayProductUrl,
        matchesUrl: (url) => /(^|\.)ebay\.[a-z.]+$/i.test(hostOf(url)),
        metered: false,
        // Official API with a generous quota.
        concurrency: 3,
        categories: null,
    },
};
/**
 * Compiled multi-site search: hit every retailer in parallel and return a
 * per-retailer outcome. Deliberately never rejects — one retailer being down
 * must not blank the other four, since partial results are the whole point of
 * the compiled view.
 */
export async function searchAllRetailers(keyword, limitPerRetailer = 4, only) {
    const targets = only?.length ? only : [...RETAILERS];
    return Promise.all(targets.map(async (retailer) => {
        try {
            const result = await adapters[retailer].search(keyword, limitPerRetailer);
            return result.status === "success"
                ? {
                    retailer,
                    status: "success",
                    products: result.data,
                    detail: null,
                    durationMs: result.durationMs,
                }
                : {
                    retailer,
                    status: result.status,
                    products: [],
                    detail: result.detail,
                    durationMs: result.durationMs,
                };
        }
        catch (err) {
            // An adapter throwing is a bug, not a scrape failure — but it still
            // must not take the other retailers down with it.
            return {
                retailer,
                status: "failed",
                products: [],
                detail: `adapter threw: ${err instanceof Error ? err.message : String(err)}`,
                durationMs: 0,
            };
        }
    }));
}
/**
 * Decide which retailers are worth asking about a query.
 *
 * General stores (Amazon, Walmart, eBay) are always included — they sell
 * everything, so skipping them can only lose results. Specialists are included
 * when the query matches what they sell.
 *
 * When the classifier has no idea, EVERY retailer is included. That's the
 * deliberate choice: a wasted call on a specialist costs a few seconds, while
 * wrongly skipping one shows the user an absence they can't explain.
 */
export function routeQuery(query, only) {
    const candidates = only?.length ? only : [...RETAILERS];
    const { categories, confident } = classifyQuery(query);
    if (!confident) {
        return { retailers: candidates, skipped: [], categories: [] };
    }
    const retailers = [];
    const skipped = [];
    for (const retailer of candidates) {
        const serves = adapters[retailer].categories;
        // A general store has no category restriction.
        if (serves === null || serves.some((c) => categories.includes(c))) {
            retailers.push(retailer);
        }
        else {
            skipped.push(retailer);
        }
    }
    // Never return nothing. If a filter somehow excluded everything, fall back to
    // asking everyone rather than showing an empty search.
    if (retailers.length === 0) {
        return { retailers: candidates, skipped: [], categories };
    }
    return { retailers, skipped, categories };
}
/** Which retailer does this pasted url belong to? Null if we don't support it. */
export function detectRetailer(url) {
    for (const retailer of RETAILERS) {
        if (adapters[retailer].matchesUrl(url))
            return retailer;
    }
    return null;
}
function hostOf(url) {
    try {
        return new URL(url).hostname;
    }
    catch {
        return "";
    }
}
export * from "./types.js";
