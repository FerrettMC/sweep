// lib/searchHistory.ts
//
// Reopening a search you already paid for.
//
// A compiled search costs real money on the Amazon leg, so looking at the same
// results twice in a day should not cost twice. That was already half-true —
// SearchCache stops us re-buying an answer within a few hours — but there was
// no way to GET BACK to a search once you had navigated away. You retyped it,
// and if the cache had expired you paid again for the same question.
//
// So this stores what a search returned, per person, and rebuilds it from the
// Product rows on the way out. Reopening never scrapes and never spends quota,
// at any age.
//
// Only ids are kept, never prices. Reopening a week-old search shows this
// week's prices — a price tracker serving a stale snapshot would be undermining
// its own point, and the diff between then and now is the interesting part
// anyway.

import { prisma } from "./prisma.js";
import {
  idsForProducts,
  normalizeKeyword,
  productsFromIds,
} from "./scrapers/searchCache.js";
import { TIER_LIMITS, type Tier } from "./tiers.js";
import type { ScrapedProduct } from "./scrapers/types.js";

export interface HistoryEntry {
  id: string;
  keyword: string;
  /** How many results were shown at the time. */
  resultCount: number;
  storeCount: number;
  searchedAt: string;
}

export interface ReopenedSearch {
  id: string;
  keyword: string;
  searchedAt: string;
  products: ScrapedProduct[];
  /**
   * True when some of what was originally found can no longer be shown —
   * delisted, or the price went away.
   *
   * Worth saying rather than quietly returning a shorter list: "6 results"
   * becoming 4 with no explanation reads as a bug in the app.
   */
  partial: boolean;
  /** How many results the search returned when it ran. */
  originalCount: number;
}

/**
 * Record a search someone just ran.
 *
 * Never throws into the caller: this runs after a search has already succeeded,
 * and failing to write history must not turn a good search into an error the
 * user sees.
 */
export async function rememberSearch(
  userId: string,
  keyword: string,
  products: ScrapedProduct[],
  storeCount: number,
  tier: Tier,
): Promise<void> {
  const normalized = normalizeKeyword(keyword);
  if (!normalized || products.length === 0) return;

  try {
    const productIds = await idsForProducts(products);
    if (productIds.length === 0) return;

    // Same keyword moves to the top rather than adding a duplicate — a history
    // list where one term appears eight times has thrown away seven slots.
    await prisma.searchHistory.upsert({
      where: { userId_keyword: { userId, keyword: normalized } },
      create: { userId, keyword: normalized, productIds, storeCount },
      update: { productIds, storeCount, searchedAt: new Date() },
    });

    await pruneToLimit(userId, tier);
  } catch {
    // Deliberately silent. See the note above.
  }
}

/**
 * Drop the oldest entries beyond the tier's cap.
 *
 * Runs after every write rather than on a schedule, so a downgrade takes effect
 * at the next search instead of leaving someone with a paid-tier history they
 * no longer pay for.
 */
async function pruneToLimit(userId: string, tier: Tier): Promise<void> {
  const limit = TIER_LIMITS[tier].searchHistoryLimit;

  const keep = await prisma.searchHistory.findMany({
    where: { userId },
    orderBy: { searchedAt: "desc" },
    skip: limit,
    select: { id: true },
  });
  if (keep.length === 0) return;

  await prisma.searchHistory.deleteMany({
    where: { id: { in: keep.map((row) => row.id) } },
  });
}

/** Recent searches, newest first, capped at what the tier allows. */
export async function listHistory(userId: string, tier: Tier): Promise<HistoryEntry[]> {
  const rows = await prisma.searchHistory.findMany({
    where: { userId },
    orderBy: { searchedAt: "desc" },
    take: TIER_LIMITS[tier].searchHistoryLimit,
  });

  return rows.map((row) => ({
    id: row.id,
    keyword: row.keyword,
    resultCount: row.productIds.length,
    storeCount: row.storeCount,
    searchedAt: row.searchedAt.toISOString(),
  }));
}

/**
 * Rebuild one past search. Null when it isn't theirs or no longer exists.
 *
 * Costs nothing but a Product read — no scraping, no quota, no provider call.
 */
export async function reopenSearch(
  userId: string,
  id: string,
): Promise<ReopenedSearch | null> {
  const row = await prisma.searchHistory.findFirst({ where: { id, userId } });
  if (!row) return null;

  const products = await productsFromIds(row.productIds);

  return {
    id: row.id,
    keyword: row.keyword,
    searchedAt: row.searchedAt.toISOString(),
    products,
    partial: products.length < row.productIds.length,
    originalCount: row.productIds.length,
  };
}

/** Forget one search. Returns false when it wasn't theirs. */
export async function forgetSearch(userId: string, id: string): Promise<boolean> {
  const { count } = await prisma.searchHistory.deleteMany({ where: { id, userId } });
  return count > 0;
}

/** Forget all of them. */
export async function clearHistory(userId: string): Promise<number> {
  const { count } = await prisma.searchHistory.deleteMany({ where: { userId } });
  return count;
}
