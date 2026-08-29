// lib/scrapers/index.ts
//
// One registry, so routes and the scheduler never branch on retailer.
// Each retailer supplies the same three things: search, re-check one product
// by url, and recognize its own urls.

import { enrichAmazonProduct, scrapeAmazonProduct, searchAmazonProducts } from "./amazon.js";
import { bestBuyProductUrl, scrapeBestBuyProduct, searchBestBuy } from "./bestbuy.js";
import {
  bestBuyApiKey,
  scrapeBestBuyApiProduct,
  searchBestBuyApi,
} from "./bestbuyApi.js";
import { ebayProductUrl, enrichEbayProduct, scrapeEbayProduct, searchEbay } from "./ebay.js";
import { asosProductUrl, scrapeAsosProduct, searchAsos } from "./asos.js";
import { enrichEtsyProduct, etsyProductUrl, scrapeEtsyProduct, searchEtsy } from "./etsy.js";
import { neweggProductUrl, scrapeNeweggProduct, searchNewegg } from "./newegg.js";
import { scrapeWalmartProduct, searchWalmart, walmartProductUrl } from "./walmart.js";
import { type Category, classifyQuery } from "../categories.js";
import {
  RETAILERS,
  fail,
  isRetailer,
  ok,
  type Retailer,
  type ScrapeResult,
  type ScrapedProduct,
} from "./types.js";
import type { ProductDetail } from "../productDetail.js";
import { readSearchCache, writeSearchCache } from "./searchCache.js";
import { throttled } from "./rateGate.js";
import { cooldownRemaining, noteBlocked, noteSuccess } from "./cooldown.js";

export interface SearchOptions {
  /**
   * Skip the keyword cache and ask the retailer.
   *
   * For callers whose entire job is noticing that a price moved. Deal radar
   * reading a cached match set would compare today's prices against today's
   * prices and conclude nothing had changed — the cache would silently defeat
   * the feature rather than merely age it.
   *
   * A fresh call still WRITES to the cache, so a radar sweep leaves the
   * catalogue warmer for whoever searches next.
   */
  fresh?: boolean;
}

interface RetailerAdapter {
  search(
    keyword: string,
    limit: number,
    options?: SearchOptions,
  ): Promise<ScrapeResult<ScrapedProduct[]>>;
  scrapeProduct(url: string): Promise<ScrapeResult<ScrapedProduct>>;
  /**
   * Everything worth showing about one product, for the lookup page.
   *
   * Optional: a store with no richer endpoint than the price check simply
   * doesn't define it, and the lookup falls back to what we already know
   * rather than pretending. See COVERAGE in productDetail.ts for which
   * sections each store can actually fill.
   */
  enrich?(url: string): Promise<ScrapeResult<ProductDetail>>;
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

/**
 * The adapters WITHOUT the rate gate. Exported only so tests can prove the
 * wrapping actually happened — nothing in the app should import this, because
 * using it is precisely how a path ends up unthrottled.
 */
export const unthrottledAdapters: Record<Retailer, RetailerAdapter> = {
  amazon: {
    search: searchAmazonProducts,
    scrapeProduct: scrapeAmazonProduct,
    enrich: enrichAmazonProduct,
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
    // True since the Decodo swap: every Walmart fetch is now billed, which
    // makes it exactly the kind of retailer the longer cache TTL exists for.
    // Left at false it kept the 45-minute free-tier window and re-bought
    // answers we already had, roughly four times more often than needed.
    metered: true,
    // Two different defences, and they need different answers.
    //
    // Under load from a home connection Walmart serves "Robot or human?" (a
    // 200 with an interstitial, not a 429) and clears within minutes — that's
    // rate-based, and spacing requests fixes it.
    //
    // Requests go through Decodo now (see decodo.ts), so the old 3000ms gap
    // is pointless — it was pacing our own IP against a block that pacing
    // never solved anyway. What matters here is Decodo's rate limit and the
    // fact that every request is billed, so this stays modest rather than
    // opening the taps.
    concurrency: 2,
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
  etsy: {
    search: searchEtsy,
    scrapeProduct: scrapeEtsyProduct,
    enrich: enrichEtsyProduct,
    productUrl: etsyProductUrl,
    matchesUrl: (url) => /(^|\.)etsy\.com$/i.test(hostOf(url)),
    metered: false,
    // An official API, so the constraint is their rate limit rather than
    // anyone's patience for us.
    concurrency: 3,
    minIntervalMs: 200,
    // Etsy sells phone cases and laptop stickers. Left unrestricted it would
    // answer "airpods pro" with handmade accessories — a technical match and a
    // useless result.
    categories: ["home", "clothing", "toys", "beauty"],
  },
  bestbuy: {
    // The official API when a key is configured, the scraper otherwise. The
    // API is better on every axis that matters — it just needs a credential,
    // and local work shouldn't stop dead without one.
    search: (keyword, limit) =>
      bestBuyApiKey() ? searchBestBuyApi(keyword, limit) : searchBestBuy(keyword, limit),
    scrapeProduct: (url) =>
      bestBuyApiKey() ? scrapeBestBuyApiProduct(url) : scrapeBestBuyProduct(url),
    productUrl: bestBuyProductUrl,
    matchesUrl: (url) => /(^|\.)bestbuy\.com$/i.test(hostOf(url)),
    metered: false,
    // Each refresh is a full search-page fetch, so it still gets paced — but
    // 3000ms was set defensively and Best Buy has never actually blocked us.
    // Measured failures are timeouts, and adding three seconds of deliberate
    // delay to a retailer that is already slow only hurt the person waiting.
    concurrency: 2,
    minIntervalMs: 800,
    categories: ["electronics"],
  },
  ebay: {
    search: searchEbay,
    scrapeProduct: scrapeEbayProduct,
    enrich: enrichEbayProduct,
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
/**
 * The adapters everything else uses, with the per-retailer rate gate applied.
 *
 * Wrapped here rather than at each call site because there are six of them —
 * search, radar, sweep, tracking, paste-a-link and drop re-verification — and
 * the one that gets forgotten is the one that gets us blocked. Anything that
 * reaches a retailer now goes through the gate by construction.
 */
export const adapters: Record<Retailer, RetailerAdapter> = Object.fromEntries(
  (Object.entries(unthrottledAdapters) as [Retailer, RetailerAdapter][]).map(
    ([retailer, adapter]) => [
      retailer,
      {
        ...adapter,
        // Cache first, then the gate. Wrapped here for the same reason the
        // gate is: there are six call sites, and the one that forgets is the
        // one that spends money re-asking a question we already paid for.
        search: (keyword: string, limit: number, options?: SearchOptions) =>
          cached(retailer, keyword, limit, adapter.metered, options?.fresh === true, () =>
            guarded(retailer, () => adapter.search(keyword, limit)),
          ),
        scrapeProduct: (url: string) =>
          guarded(retailer, () => adapter.scrapeProduct(url)),
        // Gated for the same reason as the others: a lookup is a real request
        // to a real store, and the un-gated path is the one that gets us
        // blocked. Preserved as undefined where the store has no enricher, so
        // callers can still test for its presence.
        enrich: adapter.enrich
          ? (url: string) => guarded(retailer, () => adapter.enrich!(url))
          : undefined,
      },
    ],
  ),
) as Record<Retailer, RetailerAdapter>;

/**
 * Answer from the cache when we can, and record the answer when we can't.
 *
 * Sits outside the rate gate deliberately: a question we already have the
 * answer to should not wait for a slot, and should not consume one that a
 * genuine new search could use.
 *
 * Only successes are cached. A blocked or failed call is never recorded, so a
 * store having a bad minute can't be served back as "this store has nothing"
 * for the next few hours.
 */
async function cached(
  retailer: Retailer,
  keyword: string,
  limit: number,
  metered: boolean,
  fresh: boolean,
  work: () => Promise<ScrapeResult<ScrapedProduct[]>>,
): Promise<ScrapeResult<ScrapedProduct[]>> {
  try {
    const hit = fresh
      ? null
      : await readSearchCache(retailer, keyword, limit, metered);
    if (hit) return ok(hit, 0);
  } catch {
    // A cache that can't be read is a cache miss, never an error the user
    // sees. The whole point is to be invisible.
  }

  const result = await work();

  if (result.status === "success") {
    try {
      await writeSearchCache(retailer, keyword, limit, result.data);
    } catch {
      // Failing to record it costs us the next call, not this one.
    }
  }

  return result;
}

/**
 * Pacing plus the circuit breaker, in that order.
 *
 * The cooldown check comes first and deliberately skips the rate gate: a
 * request we aren't going to send shouldn't wait for a slot, and shouldn't
 * consume one that a healthy retailer could use.
 */
async function guarded<T>(
  retailer: Retailer,
  work: () => Promise<ScrapeResult<T>>,
): Promise<ScrapeResult<T>> {
  const cooling = cooldownRemaining(retailer);
  if (cooling > 0) {
    // Reported as "blocked" rather than "failed" because that is what it is —
    // the store refused us, and we're still respecting that refusal. The app
    // already knows how to show a blocked store.
    return fail<T>(
      "blocked",
      `cooling down for ${Math.ceil(cooling / 1000)}s after being blocked`,
      0,
    );
  }

  const result = await throttled(retailer, work);
  if (result.status === "blocked") noteBlocked(retailer);
  else if (result.status === "success") noteSuccess(retailer);
  return result;
}

/**
 * How long one retailer may hold up an interactive search.
 *
 * The HTTP layer retries twice on a 20s timeout, so a retailer that is simply
 * not answering costs 20 + 20 + 20 plus backoff — around 65 seconds, measured
 * in production. Every other store had answered in under two, and the person
 * searching sat looking at a spinner for a minute to be told one store failed.
 *
 * A search is worth more when it is fast and partial than when it is complete
 * and late: four stores in eight seconds beats five in sixty-five. Scheduled
 * checks keep the patient path, since nobody is waiting on those.
 */
const SEARCH_DEADLINE_MS = 12_000;

export async function searchAllRetailers(
  keyword: string,
  limitPerRetailer = 4,
  only?: Retailer[],
  options?: SearchOptions,
): Promise<RetailerSearchOutcome[]> {
  const targets = only?.length ? only : [...RETAILERS];

  return Promise.all(
    targets.map(async (retailer): Promise<RetailerSearchOutcome> => {
      const startedAt = Date.now();
      try {
        // Races the adapter rather than cancelling it: the underlying fetch
        // keeps running and still populates the product cache, so the work
        // isn't wasted — it just stops being something the user waits for.
        const result = await Promise.race([
          adapters[retailer].search(keyword, limitPerRetailer, options),
          new Promise<null>((resolve) =>
            setTimeout(() => resolve(null), SEARCH_DEADLINE_MS),
          ),
        ]);

        if (result === null) {
          return {
            retailer,
            status: "failed",
            products: [],
            detail: `no answer within ${SEARCH_DEADLINE_MS / 1000}s`,
            durationMs: Date.now() - startedAt,
          };
        }
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
/**
 * Retailers turned off by configuration, e.g. DISABLED_RETAILERS=walmart.
 *
 * Exists because "this store won't talk to our server" is an operational fact
 * that can change with a redeploy or a proxy, not a code change. A disabled
 * store is dropped from routing entirely rather than attempted and reported as
 * broken — users see a store that isn't there, not one that's failing.
 */
export function disabledRetailers(): Retailer[] {
  return (process.env.DISABLED_RETAILERS ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name): name is Retailer => isRetailer(name));
}

export function isRetailerEnabled(retailer: Retailer): boolean {
  return !disabledRetailers().includes(retailer);
}

export function routeQuery(query: string, only?: Retailer[]): RetailerRouting {
  const off = disabledRetailers();
  const candidates = (only?.length ? only : [...RETAILERS]).filter(
    (r) => !off.includes(r),
  );
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
