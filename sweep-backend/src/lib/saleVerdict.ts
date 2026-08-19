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
        claimedPercentOff !== null
          ? `The store claims ${claimedPercentOff}% off. Track it for a few days and Sweep can tell you whether that's real.`
          : "Track this for a few days and Sweep can tell you whether a sale is genuine.",
      claimedPercentOff,
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
      realPercentBelowTypical,
    };
  }

  if (realPercentBelowTypical >= 5) {
    return {
      verdict: "good-price",
      headline: `${realPercentBelowTypical}% below its usual price`,
      detail: `Typically ${formatCents(average)} across ${points} checks. Lowest we've recorded is ${formatCents(low)}.`,
      claimedPercentOff,
      realPercentBelowTypical,
    };
  }

  if (realPercentBelowTypical <= -5) {
    return {
      verdict: "above-usual",
      headline: "Pricier than usual right now",
      detail: `This normally sits around ${formatCents(average)}. It's been as low as ${formatCents(low)}.`,
      claimedPercentOff,
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
    realPercentBelowTypical,
  };
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
