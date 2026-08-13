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
  );

  const found: ScrapedProduct[] = [];
  const unreachable: string[] = [];

  for (const outcome of outcomes) {
    if (outcome.status !== "success") {
      unreachable.push(RETAILER_LABELS[outcome.retailer]);
      continue;
    }
    found.push(...outcome.products);
  }

  // We paid for these reads; keep them.
  await cacheSearchResults(found);

  const matches: RadarMatch[] = found
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

  return { matches, best, unreachable, isNewBest };
}
