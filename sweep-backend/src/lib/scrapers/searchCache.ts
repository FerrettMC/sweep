// lib/scrapers/searchCache.ts
//
// Not paying twice for the same question.
//
// Amazon bills per record, and popular queries repeat constantly — everyone
// searching "airpods" this week triggers a fresh crawl each time, for a set of
// matches that barely changes. This is the single biggest lever on the one
// variable cost the app has, and it costs nothing to pull.
//
// WHAT IS CACHED IS THE MATCH SET, NOT THE PRICES.
//
// A row records which products a keyword returned, in order. Prices are read
// back from Product, which scheduled checks and product lookups keep current.
// Discovering the matches is the expensive half and the half that ages slowly;
// prices are the cheap half that ages fast, so they are deliberately not
// frozen into the cache.
//
// The honest cost: a cache hit can show a price that is up to one TTL old for
// a product nobody is tracking, since nothing else refreshes those. That is
// why the window is hours rather than days, and why the metered retailer —
// the only one where this saves real money — is the only one held long.

import { prisma } from "../prisma.js";
import type { Retailer, ScrapedProduct } from "./types.js";

/**
 * How long a match set stays usable.
 *
 * Split by cost, not by taste. Amazon is the only retailer that charges us, so
 * it is the only one worth holding long enough to accept slightly older
 * prices. The free APIs are cached briefly — enough to absorb a burst or a
 * user retrying, not long enough to matter.
 */
const TTL_MS = {
  metered: 3 * 60 * 60 * 1000,
  free: 45 * 60 * 1000,
} as const;

/**
 * Below this share of the cached ids still resolving to a priced product, the
 * entry is treated as a miss.
 *
 * Rows can be deleted, and a product can lose its price. Serving two results
 * where the retailer found four looks like a worse retailer rather than an
 * older cache.
 */
const MIN_USABLE_SHARE = 0.75;

/**
 * "AirPods  Pro " and "airpods pro" are the same question.
 *
 * Normalizing here rather than at the call sites means the cache key can't
 * drift between the route, the job runner and the radar.
 */
export function normalizeKeyword(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

function ttlFor(metered: boolean): number {
  return metered ? TTL_MS.metered : TTL_MS.free;
}

/**
 * A previous answer to this exact question, or null.
 *
 * Null covers "never asked", "asked too long ago" and "asked, but for fewer
 * results than you want" — all of which mean the same thing to the caller.
 */
export async function readSearchCache(
  retailer: Retailer,
  keyword: string,
  limit: number,
  metered: boolean,
): Promise<ScrapedProduct[] | null> {
  const entry = await prisma.searchCache.findUnique({
    where: { keyword_retailer: { keyword: normalizeKeyword(keyword), retailer } },
  });
  if (!entry) return null;

  if (Date.now() - entry.fetchedAt.getTime() > ttlFor(metered)) return null;

  // An entry filled by a request for four results cannot answer a request for
  // eight. Serving four would silently give a paying user the free tier's
  // result count.
  if (entry.limit < limit) return null;

  const wanted = entry.productIds.slice(0, limit);
  if (wanted.length === 0) return null;

  const products = await productsFromIds(wanted);

  if (products.length < Math.ceil(wanted.length * MIN_USABLE_SHARE)) return null;

  return products;
}

/**
 * Record what a keyword returned.
 *
 * Called only after a real, successful retailer call. A failure is never
 * cached — an empty result from a store that was blocking us would otherwise
 * be served back for hours as though the store had nothing.
 */
export async function writeSearchCache(
  retailer: Retailer,
  keyword: string,
  limit: number,
  products: ScrapedProduct[],
): Promise<void> {
  // Nothing found is a legitimate answer, but it's also what a subtly broken
  // parser returns, and caching it hides the breakage for hours.
  if (products.length === 0) return;

  const productIds = await idsForProducts(products);
  if (productIds.length === 0) return;

  const key = { keyword: normalizeKeyword(keyword), retailer };
  await prisma.searchCache.upsert({
    where: { keyword_retailer: key },
    create: { ...key, productIds, limit, fetchedAt: new Date() },
    update: { productIds, limit, fetchedAt: new Date() },
  });
}

/** Drop entries nothing can use any more. Called by the scheduler. */
export async function pruneSearchCache(): Promise<number> {
  const cutoff = new Date(Date.now() - TTL_MS.metered);
  const { count } = await prisma.searchCache.deleteMany({
    where: { fetchedAt: { lt: cutoff } },
  });
  return count;
}

/**
 * Product rows for a list of ids, in the order given, as search results.
 *
 * Order matters: relevance ranking is part of what a search returned, and
 * findMany does not preserve it. Rows that have vanished or lost their price
 * are dropped rather than rendered as blanks — the caller decides whether what
 * survives is still enough to show.
 *
 * Shared with search history, which rebuilds an old result set the same way and
 * for the same reason: prices come from the Product rows at read time, so a
 * reopened search shows today's prices rather than a stale snapshot.
 */
export async function productsFromIds(ids: string[]): Promise<ScrapedProduct[]> {
  if (ids.length === 0) return [];

  const rows = await prisma.product.findMany({
    where: { id: { in: ids }, currentPrice: { not: null } },
  });

  const byId = new Map(rows.map((row) => [row.id, row]));
  const products: ScrapedProduct[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) continue;
    products.push({
      retailer: row.retailer as Retailer,
      retailerId: row.retailerId,
      title: row.title,
      price: row.currentPrice,
      listPrice: row.listPrice,
      currency: row.currency,
      imageUrl: row.imageUrl,
      url: row.url,
      availability: row.availability,
      rating: row.rating,
      ratingCount: row.ratingCount,
      sellerRating: row.sellerRating,
      sellerRatingCount: row.sellerRatingCount,
    });
  }
  return products;
}

/**
 * Our Product ids for a list of scraped results, in the same order.
 *
 * The products must already be in Product for the ids to mean anything — the
 * callers cache results there first and this reads back what that produced.
 * Anything not found is dropped rather than turning into a null in the middle
 * of an ordered list.
 *
 * Shared with search history, which needs exactly the same lookup to record
 * what a search returned.
 */
export async function idsForProducts(products: ScrapedProduct[]): Promise<string[]> {
  if (products.length === 0) return [];

  const rows = await prisma.product.findMany({
    where: {
      OR: products.map((p) => ({ retailer: p.retailer, retailerId: p.retailerId })),
    },
    select: { id: true, retailer: true, retailerId: true },
  });

  const idFor = new Map(rows.map((r) => [`${r.retailer}:${r.retailerId}`, r.id]));
  return products
    .map((p) => idFor.get(`${p.retailer}:${p.retailerId}`))
    .filter((id): id is string => id !== undefined);
}
