// lib/dealRadar.ts
//
// Running a standing search and deciding whether it found anything worth
// interrupting someone for.
//
// The hard part isn't searching — that already works. It's restraint. A radar
// that fires every time it sees a matching item will report the same $179
// listing twice a day forever, and the first thing anyone does with an alert
// that cries wolf is turn it off. So a run only counts as a hit when it beats
// what we last told this user about.
//
// Results are written into the shared Product cache on the way past, same as
// any other search, so a radar hit is immediately trackable and sweepable
// without paying for the page again.

import { cacheSearchResults } from "./priceChecker.js";
import { routeQuery, searchAllRetailers } from "./scrapers/index.js";
import {
  RETAILER_LABELS,
  type Retailer,
  type ScrapedProduct,
} from "./scrapers/types.js";

export interface RadarMatch {
  retailer: Retailer;
  retailerLabel: string;
  title: string;
  url: string;
  imageUrl: string | null;
  price: number;
  listPrice: number | null;
  rating: number | null;
  ratingCount: number | null;
}

export interface RadarRun {
  matches: RadarMatch[];
  /** Cheapest match this run, or null if nothing matched. */
  best: RadarMatch | null;
  /** Stores that failed, so "no results" isn't confused with "not sold there". */
  unreachable: string[];
  /**
   * How many stores actually replied. Zero means the refresh did no useful
   * work, which is the case where charging someone a refresh is indefensible.
   */
  storesAnswered: number;
  /** True when `best` beats anything we've reported before. */
  isNewBest: boolean;
}

/** Results per retailer. Enough to be useful, small enough to stay cheap. */
const RESULTS_PER_RETAILER = 4;

export async function runRadar(saved: {
  keyword: string;
  targetPrice: number | null;
  lastBestPrice: number | null;
}): Promise<RadarRun> {
  const routing = routeQuery(saved.keyword);
  const outcomes = await searchAllRetailers(
    saved.keyword,
    RESULTS_PER_RETAILER,
    routing.retailers,
    // Never from cache. A radar's whole job is noticing that a price moved;
    // reading a cached match set would compare today's prices with today's
    // prices and report that nothing had changed. The cache would defeat the
    // feature rather than merely age it.
    //
    // Still writes to the cache, so a radar sweep leaves things warmer for
    // whoever searches that keyword next.
    { fresh: true },
  );

  const found: ScrapedProduct[] = [];
  const unreachable: string[] = [];
  let storesAnswered = 0;

  for (const outcome of outcomes) {
    if (outcome.status !== "success") {
      unreachable.push(RETAILER_LABELS[outcome.retailer]);
      continue;
    }
    storesAnswered++;
    found.push(...outcome.products);
  }

  // We paid for these reads; keep them.
  await cacheSearchResults(found);

  const { matches, best, isNewBest } = deriveMatches(found, saved);
  return { matches, best, unreachable, isNewBest, storesAnswered };
}


/**
 * Turn a bag of scraped products into radar matches.
 *
 * Split out from runRadar so a refresh that is still in flight can derive the
 * same answer from whatever has landed so far — the user sees matches as each
 * store replies instead of waiting on the slowest one, and the numbers they
 * see mid-flight are computed exactly the same way as the final ones.
 */
export function deriveMatches(
  products: ScrapedProduct[],
  saved: { targetPrice: number | null; lastBestPrice: number | null },
): { matches: RadarMatch[]; best: RadarMatch | null; isNewBest: boolean } {
  const matches: RadarMatch[] = products
    .filter((product): product is ScrapedProduct & { price: number } => product.price !== null)
    .filter((product) =>
      saved.targetPrice === null ? true : product.price <= saved.targetPrice,
    )
    .map((product) => ({
      retailer: product.retailer,
      retailerLabel: RETAILER_LABELS[product.retailer],
      title: product.title,
      url: product.url,
      imageUrl: product.imageUrl,
      price: product.price,
      listPrice: product.listPrice,
      rating: product.rating,
      ratingCount: product.ratingCount,
    }))
    .sort((a, b) => a.price - b.price);

  const best = matches[0] ?? null;

  // Only a genuinely better price is news. Equal-or-worse is the same deal we
  // already mentioned, and repeating it is how alerts get muted.
  const isNewBest =
    best !== null &&
    (saved.lastBestPrice === null || best.price < saved.lastBestPrice);

  return { matches, best, isNewBest };
}
