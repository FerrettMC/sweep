// lib/scrapers/index.ts
//
// One registry, so routes and the scheduler never branch on retailer.
// Each retailer supplies the same three things: search, re-check one product
// by url, and recognize its own urls.

import { scrapeAmazonProduct, searchAmazonProducts } from "./amazon.js";
import { bestBuyProductUrl, scrapeBestBuyProduct, searchBestBuy } from "./bestbuy.js";
import { ebayProductUrl, scrapeEbayProduct, searchEbay } from "./ebay.js";
import { scrapeTargetProduct, searchTarget, targetProductUrl } from "./target.js";
import { scrapeWalmartProduct, searchWalmart, walmartProductUrl } from "./walmart.js";
import {
  RETAILERS,
  type Retailer,
  type ScrapeResult,
  type ScrapedProduct,
} from "./types.js";

interface RetailerAdapter {
  search(keyword: string, limit: number): Promise<ScrapeResult<ScrapedProduct[]>>;
  scrapeProduct(url: string): Promise<ScrapeResult<ScrapedProduct>>;
  productUrl(retailerId: string): string;
  /** Does this url belong to this retailer? Used to resolve pasted links. */
  matchesUrl(url: string): boolean;
  /**
   * Whether this retailer costs money per call. Amazon goes through Bright
   * Data, so the scheduler batches it differently from the free scrapers.
   */
  metered: boolean;
  /**
   * How many requests to this retailer may be in flight at once.
   *
   * Best Buy is 1 with a gap on purpose: every one of its product refreshes
   * costs a search-page fetch (see bestbuy.ts for why), and those are heavy
   * ~1.7MB responses. Pacing them keeps us well clear of its limits.
   */
  concurrency: number;
  /** Minimum gap between consecutive requests, for retailers that need pacing. */
  minIntervalMs?: number;
}

export const adapters: Record<Retailer, RetailerAdapter> = {
  amazon: {
    search: searchAmazonProducts,
    scrapeProduct: scrapeAmazonProduct,
    productUrl: (id) => `https://www.amazon.com/dp/${id}`,
    matchesUrl: (url) => /(^|\.)amazon\.[a-z.]+$/i.test(hostOf(url)),
    metered: true,
    // Bright Data absorbs Amazon's blocking, but each call costs quota.
    concurrency: 1,
  },
  walmart: {
    search: searchWalmart,
    scrapeProduct: scrapeWalmartProduct,
    productUrl: walmartProductUrl,
    matchesUrl: (url) => /(^|\.)walmart\.com$/i.test(hostOf(url)),
    metered: false,
    concurrency: 3,
  },
  target: {
    search: searchTarget,
    scrapeProduct: scrapeTargetProduct,
    productUrl: targetProductUrl,
    matchesUrl: (url) => /(^|\.)target\.com$/i.test(hostOf(url)),
    metered: false,
    concurrency: 2,
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
  },
  ebay: {
    search: searchEbay,
    scrapeProduct: scrapeEbayProduct,
    productUrl: ebayProductUrl,
    matchesUrl: (url) => /(^|\.)ebay\.[a-z.]+$/i.test(hostOf(url)),
    metered: false,
    // Official API with a generous quota.
    concurrency: 3,
  },
};

export interface RetailerSearchOutcome {
  retailer: Retailer;
  status: "success" | "failed" | "blocked";
  products: ScrapedProduct[];
  detail: string | null;
  durationMs: number;
}

/**
 * Compiled multi-site search: hit every retailer in parallel and return a
 * per-retailer outcome. Deliberately never rejects — one retailer being down
 * must not blank the other four, since partial results are the whole point of
 * the compiled view.
 */
export async function searchAllRetailers(
  keyword: string,
  limitPerRetailer = 4,
  only?: Retailer[],
): Promise<RetailerSearchOutcome[]> {
  const targets = only?.length ? only : [...RETAILERS];

  return Promise.all(
    targets.map(async (retailer): Promise<RetailerSearchOutcome> => {
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
      } catch (err) {
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
    }),
  );
}

/** Which retailer does this pasted url belong to? Null if we don't support it. */
export function detectRetailer(url: string): Retailer | null {
  for (const retailer of RETAILERS) {
    if (adapters[retailer].matchesUrl(url)) return retailer;
  }
  return null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export * from "./types.js";
