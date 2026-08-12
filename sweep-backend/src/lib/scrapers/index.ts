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
import { type Category, classifyQuery } from "../categories.js";
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
  /**
   * What this retailer actually sells. `null` means a general store that
   * carries everything and is therefore always worth asking.
   *
   * Specialists are skipped when the query clearly isn't about their
   * categories — no point asking a clothing site about earbuds.
   */
  categories: Category[] | null;
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
    categories: null,
  },
  walmart: {
    search: searchWalmart,
    scrapeProduct: scrapeWalmartProduct,
    productUrl: walmartProductUrl,
    matchesUrl: (url) => /(^|\.)walmart\.com$/i.test(hostOf(url)),
    metered: false,
    concurrency: 3,
    categories: null,
  },
  newegg: {
    search: searchNewegg,
    scrapeProduct: scrapeNeweggProduct,
    productUrl: neweggProductUrl,
    matchesUrl: (url) => /(^|\.)newegg\.com$/i.test(hostOf(url)),
    metered: false,
    concurrency: 2,
    categories: ["electronics"],
  },
  asos: {
    search: searchAsos,
    scrapeProduct: scrapeAsosProduct,
    productUrl: asosProductUrl,
    matchesUrl: (url) => /(^|\.)asos\.com$/i.test(hostOf(url)),
    metered: false,
    concurrency: 2,
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

export interface RetailerRouting {
  retailers: Retailer[];
  /** Specialists deliberately left out, so the UI can explain the absence. */
  skipped: Retailer[];
  categories: Category[];
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
export function routeQuery(query: string, only?: Retailer[]): RetailerRouting {
  const candidates = only?.length ? only : [...RETAILERS];
  const { categories, confident } = classifyQuery(query);

  if (!confident) {
    return { retailers: candidates, skipped: [], categories: [] };
  }

  const retailers: Retailer[] = [];
  const skipped: Retailer[] = [];

  for (const retailer of candidates) {
    const serves = adapters[retailer].categories;
    // A general store has no category restriction.
    if (serves === null || serves.some((c) => categories.includes(c))) {
      retailers.push(retailer);
    } else {
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
