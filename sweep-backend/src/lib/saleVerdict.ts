// lib/saleVerdict.ts
//
// Is a "sale" real, judged against the product's own price history?
//
// This is what's left of "Sweep this deal" after product lookup replaced it,
// and it's the half worth keeping. A retailer's struck-through price is
// whatever they say it is; our own recorded history is the only number in the
// app that can't be staged, so when the two disagree we say so plainly.
//
// Costs nothing to compute — the history is already loaded to draw the graph.

import { UNVERIFIED_ABOVE_PERCENT, type DiscountConfidence } from "./discount.js";

/** History points needed before we'll make a claim about "usual" pricing. */
const MIN_HISTORY_POINTS = 3;

export type SaleVerdict =
  | "genuine-low"      // Cheapest we've ever recorded.
  | "good-price"       // Meaningfully below its own usual.
  | "typical-price"    // The "sale" is just the normal price.
  | "above-usual"      // Currently pricier than normal.
  | "no-history";      // We haven't watched it long enough to say.

/** The assessment itself, as the app renders it. */
export interface SaleAssessment {
  verdict: SaleVerdict;
  headline: string;
  detail: string;
  /** The retailer's claimed discount, which may well be theatre. */
  claimedPercentOff: number | null;
  /**
   * How much we trust that claim on its face, before history is considered.
   *
   * Null when there's no claim to judge. Optional on the wire so an older app
   * ignores it and renders as it always did.
   */
  claimedConfidence?: DiscountConfidence | null;
  /** What it's actually worth against its own history. */
  realPercentBelowTypical: number | null;
}

export function judgeSale(input: {
  price: number;
  listPrice: number | null;
  low: number | null;
  average: number | null;
  points: number;
  claimedPercentOff: number | null;
}): SaleAssessment {
  const { price, low, average, points, claimedPercentOff } = input;

  if (points < MIN_HISTORY_POINTS || average === null || low === null) {
    return {
      verdict: "no-history",
      headline: "Not enough history yet",
      detail:
        claimedPercentOff === null
          ? "Track this for a few days and Sweep can tell you whether a sale is genuine."
          : confidenceOf(claimedPercentOff) === "unverified"
            ? `${claimedPercentOff}% off is a big claim, and some sellers inflate the crossed-out price to make one. Track it for a few days and Sweep will know the real price.`
            : `The store claims ${claimedPercentOff}% off. Track it for a few days and Sweep can tell you whether that's real.`,
      claimedPercentOff,
      claimedConfidence: confidenceOf(claimedPercentOff),
      realPercentBelowTypical: null,
    };
  }

  const realPercentBelowTypical = Math.round(((average - price) / average) * 100);

  if (price <= low) {
    return {
      verdict: "genuine-low",
      headline: "Lowest price we've seen",
      detail: `Across ${points} checks this has never been cheaper.`,
      claimedPercentOff,
      claimedConfidence: confidenceOf(claimedPercentOff),
      realPercentBelowTypical,
    };
  }

  if (realPercentBelowTypical >= 5) {
    return {
      verdict: "good-price",
      headline: `${realPercentBelowTypical}% below its usual price`,
      detail: `Typically ${formatCents(average)} across ${points} checks. Lowest we've recorded is ${formatCents(low)}.`,
      claimedPercentOff,
      claimedConfidence: confidenceOf(claimedPercentOff),
      realPercentBelowTypical,
    };
  }

  if (realPercentBelowTypical <= -5) {
    return {
      verdict: "above-usual",
      headline: "Pricier than usual right now",
      detail: `This normally sits around ${formatCents(average)}. It's been as low as ${formatCents(low)}.`,
      claimedPercentOff,
      claimedConfidence: confidenceOf(claimedPercentOff),
      realPercentBelowTypical,
    };
  }

  return {
    verdict: "typical-price",
    headline:
      claimedPercentOff !== null
        ? `That "${claimedPercentOff}% off" is just the normal price`
        : "This is its normal price",
    detail: `It's sat around ${formatCents(average)} across ${points} checks. Lowest we've recorded is ${formatCents(low)}.`,
    claimedPercentOff,
    claimedConfidence: confidenceOf(claimedPercentOff),
    realPercentBelowTypical,
  };
}

function confidenceOf(percent: number | null): DiscountConfidence | null {
  if (percent === null) return null;
  return percent > UNVERIFIED_ABOVE_PERCENT ? "unverified" : "plausible";
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
