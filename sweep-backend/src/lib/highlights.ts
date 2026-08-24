// lib/highlights.ts
//
// Picks the handful of results worth showing above the per-store columns.
//
// A compiled search returns a few products from every store, which is a wall.
// Most people are asking one of three questions — what's the biggest discount,
// what's actually good, who's cheapest — so answer those first and keep the
// full per-store breakdown underneath for anyone who wants it.
//
// Biggest drop leads because it's the most time-sensitive: the cheapest item is
// still cheapest tomorrow, but a drop might not still be there.

import { type DiscountConfidence, claimedDiscount } from "./discount.js";
import type { ScrapedProduct } from "./scrapers/types.js";

export type HighlightKind = "cheapest" | "best_rated" | "biggest_discount";

export interface Highlight {
  kind: HighlightKind;
  label: string;
  /** Why this one won, in words the UI can show directly. */
  reason: string;
  product: ScrapedProduct;
  /**
   * Present on "Biggest drop" only: how much we trust the claim.
   *
   * Optional so an older app that doesn't know the field renders exactly as it
   * did before — it just won't show the caveat.
   */
  confidence?: DiscountConfidence;
}

/** Ratings below this many reviews are noise, not signal. */
const MIN_RATINGS_FOR_BEST_RATED = 25;

export function pickHighlights(products: ScrapedProduct[]): Highlight[] {
  const priced = products.filter(
    (p): p is ScrapedProduct & { price: number } => p.price !== null && p.price > 0,
  );
  if (priced.length === 0) return [];

  const highlights: Highlight[] = [];
  const claimed = new Set<string>();
  const key = (p: ScrapedProduct) => `${p.retailer}:${p.retailerId}`;

  // Order matters twice over: it's the order the cards appear in, and it's the
  // order they claim products. Whoever picks first gets the product, so claim
  // priority has to match display priority — otherwise a card could be labelled
  // "Biggest drop" while showing the second-biggest, which is just false.

  // 1. Biggest discount off the retailer's own list price.
  //
  // Sorted so anything we can vouch for outranks anything we can't, and only
  // then by size. Straight descending order would hand this card to a fake MSRP
  // permanently: an invented 87% beats a real 45% every time, so the one card
  // meant to surface real deals would show nothing but the least honest listing
  // on the page. A doubtful claim can still win — but only when there's no
  // credible discount to show instead, and it says so when it does.
  const discounted = priced
    .map((p) => ({ product: p, discount: claimedDiscount(p.price, p.listPrice) }))
    .filter(
      (entry): entry is { product: ScrapedProduct & { price: number }; discount: NonNullable<ReturnType<typeof claimedDiscount>> } =>
        entry.discount !== null,
    )
    .sort((a, b) => {
      const trust = rank(a.discount.confidence) - rank(b.discount.confidence);
      return trust !== 0 ? trust : b.discount.percent - a.discount.percent;
    });

  const biggest = discounted[0];
  if (biggest) {
    const unverified = biggest.discount.confidence === "unverified";
    highlights.push({
      kind: "biggest_discount",
      label: unverified ? "Big claim" : "Biggest drop",
      reason: unverified
        ? `Store claims ${biggest.discount.percent}% off — track it to see if that's real`
        : `${biggest.discount.percent}% off its usual price`,
      product: biggest.product,
      confidence: biggest.discount.confidence,
    });
    claimed.add(key(biggest.product));
  }

  // 2. Best reviewed, ignoring items with too few ratings to mean anything.
  const rated = priced
    .filter((p) => p.rating !== null && (p.ratingCount ?? 0) >= MIN_RATINGS_FOR_BEST_RATED)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.ratingCount ?? 0) - (a.ratingCount ?? 0));

  const bestRated = rated.find((p) => !claimed.has(key(p)));
  if (bestRated) {
    highlights.push({
      kind: "best_rated",
      label: "Best reviewed",
      reason: `${bestRated.rating?.toFixed(1)}★ from ${formatCount(bestRated.ratingCount ?? 0)} ratings`,
      product: bestRated,
    });
    claimed.add(key(bestRated));
  }

  // 3. Cheapest overall, last. If the genuinely cheapest item already won one
  // of the labels above, no Cheapest card is shown rather than promoting the
  // second-cheapest under a name that wouldn't be true.
  const cheapest = [...priced].sort((a, b) => a.price - b.price)[0];
  if (cheapest && !claimed.has(key(cheapest))) {
    highlights.push({
      kind: "cheapest",
      label: "Cheapest",
      reason: `Lowest price of ${priced.length} results`,
      product: cheapest,
    });
  }

  return highlights;
}

/** Lower sorts first, so a discount we believe outranks one we don't. */
function rank(confidence: DiscountConfidence): number {
  return confidence === "plausible" ? 0 : 1;
}

function formatCount(count: number) {
  if (count >= 1000) return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k`;
  return String(count);
}
