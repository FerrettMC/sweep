// lib/discount.ts
//
// How much is off, and whether we believe it.
//
// A struck-through price is whatever the retailer says it is. Most of the time
// that's fine — Amazon and Best Buy are disciplined about list prices, and a
// 30% claim is usually a 30% sale. Marketplace sellers are a different story:
// invent a $159.95 "list" for a $20 pair of headphones and you've manufactured
// an 87% discount out of nothing.
//
// That matters more than it sounds, because anything that ranks by discount
// sorts descending — so a made-up number beats every real sale on the page,
// every time. The fix isn't to hide big discounts (some are real, and those are
// exactly what people are here for). It's to stop treating a claim as a fact:
// past a certain size, say we can't vouch for it and let the user decide.
//
// Where we have our own price history, don't use this at all — use judgeSale().
// Our recorded history is the one number in the app nobody can stage.

/** A "discount" smaller than this is marketing, not a deal. */
export const MIN_DISCOUNT_PERCENT = 10;

/**
 * Past this, we stop vouching for the retailer's claim.
 *
 * 50% is a judgement call, not a measurement. Genuine half-off happens —
 * clearances, end-of-line stock, Black Friday — so this can't mean "fake". It
 * means "big enough that an inflated list price is at least as likely as a real
 * sale, and we have no history to tell them apart".
 */
export const UNVERIFIED_ABOVE_PERCENT = 50;

export type DiscountConfidence =
  /** Plausible on its face. Still the retailer's claim, not our measurement. */
  | "plausible"
  /** Large enough that we won't stand behind it without history. */
  | "unverified";

export interface Discount {
  percent: number;
  confidence: DiscountConfidence;
}

/**
 * The discount a retailer is claiming, with our confidence in it.
 *
 * Returns null when there's no claim worth repeating — no list price, a list
 * price at or below the actual price, or a difference too small to matter.
 */
export function claimedDiscount(
  price: number | null,
  listPrice: number | null,
): Discount | null {
  if (price === null || price <= 0) return null;
  if (listPrice === null || listPrice <= price) return null;

  const percent = Math.round(((listPrice - price) / listPrice) * 100);
  if (percent < MIN_DISCOUNT_PERCENT) return null;

  return {
    percent,
    confidence:
      percent > UNVERIFIED_ABOVE_PERCENT ? "unverified" : "plausible",
  };
}
