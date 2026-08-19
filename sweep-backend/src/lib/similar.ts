// lib/similar.ts
//
// "You might also want" on the product lookup page.
//
// The obvious way to build this is to take the title, search every retailer,
// and match what comes back. That is exactly what "Sweep this deal" did, and
// it is why that feature cost enough to be rationed at one use a day. Putting
// a paid Amazon call behind a row nobody asked to see would be a worse version
// of a thing we already removed.
//
// So this asks nobody. Every search, radar run and background job already
// writes its results into the shared Product table, which means we are sitting
// on a corpus of titles and prices from every search anyone has run. This
// queries that.
//
// What it costs: one indexed-ish query and some string comparison. No retailer
// call, no quota, no waiting.
//
// What it costs us instead is coverage — it can only suggest things somebody
// has already searched for. That is the right trade for a secondary row: it
// shows nothing when it knows nothing, and it gets better every time anybody
// uses the app.

import { compareProducts, searchKeyFor } from "./matching.js";
import { prisma } from "./prisma.js";
import { RETAILER_LABELS, type Retailer } from "./scrapers/types.js";

export interface SimilarProduct {
  productId: string;
  retailer: Retailer;
  retailerLabel: string;
  title: string;
  url: string;
  imageUrl: string | null;
  price: number;
  /** Positive means cheaper than the product being viewed. */
  saving: number;
  /** Never "unrelated" — those are dropped rather than shown. */
  confidence: "same" | "similar";
  /** Why we're not certain, in words, from the matcher. */
  caveats: string[];
}

/**
 * How many rows to pull before matching properly.
 *
 * The database narrows by keyword, which is crude; compareProducts is the part
 * that actually decides, and it runs in memory. This bounds how much work that
 * second stage does on a popular keyword.
 */
const CANDIDATE_LIMIT = 60;

/** Below this the listing is almost always an accessory, not the product. */
const ABSURDLY_CHEAP = 0.25;

/**
 * How old a cached product may be before it stops being worth suggesting.
 *
 * This is the one place the cache can genuinely go stale. An untracked product
 * is never checked on a schedule — nothing refreshes it unless somebody
 * searches its keyword again — so a row can sit at whatever price it had the
 * last time anyone looked, indefinitely.
 *
 * Elsewhere that's bounded: a keyword-cache entry expires and forces a fresh
 * scrape, and a product lookup always calls the store. Here there is no such
 * floor, so it has to be imposed. Two weeks is generous for "is this roughly
 * still the price" and short enough that nobody is sent to a listing that
 * stopped existing last month.
 *
 * Showing nothing is the right failure. This row is a convenience; a wrong
 * price on it would be a reason not to trust the ones that matter.
 */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export async function findSimilarProducts(
  productId: string,
  limit = 4,
): Promise<SimilarProduct[]> {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product || product.currentPrice === null) return [];

  // The distinctive words — brand and model, roughly. Anything shorter than
  // three characters matches half the table and narrows nothing.
  const terms = searchKeyFor(product.title)
    .split(" ")
    .filter((term) => term.length >= 3)
    .slice(0, 2);

  if (terms.length === 0) return [];

  const candidates = await prisma.product.findMany({
    where: {
      // Every term must appear. Requiring both "sony" and "wh-1000xm5" is what
      // separates a narrowing query from a scan of everything Sony sells.
      AND: terms.map((term) => ({
        title: { contains: term, mode: "insensitive" as const },
      })),
      id: { not: productId },
      currentPrice: { not: null },
      // See MAX_AGE_MS. Nothing refreshes an untracked product on its own, so
      // without this a price from months ago reads exactly like today's.
      lastCheckedAt: { gte: new Date(Date.now() - MAX_AGE_MS) },
    },
    select: {
      id: true,
      retailer: true,
      title: true,
      url: true,
      imageUrl: true,
      currentPrice: true,
    },
    // Cheapest first, so the cap keeps the rows most worth showing rather than
    // whichever happened to be inserted first.
    orderBy: { currentPrice: "asc" },
    take: CANDIDATE_LIMIT,
  });

  const price = product.currentPrice;
  const matches: SimilarProduct[] = [];

  for (const candidate of candidates) {
    const candidatePrice = candidate.currentPrice;
    if (candidatePrice === null) continue;

    // A quarter of the price is an accessory or a parsing artefact far more
    // often than it's a deal — a case for the phone, not the phone.
    if (candidatePrice < price * ABSURDLY_CHEAP) continue;

    const match = compareProducts(product, candidate);
    if (match.confidence === "unrelated") continue;

    matches.push({
      productId: candidate.id,
      retailer: candidate.retailer as Retailer,
      retailerLabel:
        RETAILER_LABELS[candidate.retailer as Retailer] ?? candidate.retailer,
      title: candidate.title,
      url: candidate.url,
      imageUrl: candidate.imageUrl,
      price: candidatePrice,
      saving: price - candidatePrice,
      confidence: match.confidence,
      caveats: match.caveats,
    });
  }

  // Confident matches first, then by how much they save. Someone scanning this
  // row wants "the same thing, cheaper" before "something like it".
  matches.sort((a, b) => {
    if (a.confidence !== b.confidence) return a.confidence === "same" ? -1 : 1;
    return b.saving - a.saving;
  });

  // One row per retailer. Four listings of the same item from one store is a
  // duplicate, not a choice.
  const seen = new Set<string>();
  const unique = matches.filter((match) => {
    const key = `${match.retailer}:${match.title.toLowerCase().slice(0, 40)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique.slice(0, limit);
}
