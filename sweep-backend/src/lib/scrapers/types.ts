// lib/scrapers/types.ts
//
// One shape every retailer normalizes into, so the rest of the app never has
// to know whether a price came from a JSON API, a Next.js data blob, or an
// Apollo SSR payload.

export const RETAILERS = [
  "amazon",
  "walmart",
  "bestbuy",
  "ebay",
  "newegg",
  "asos",
] as const;

export type Retailer = (typeof RETAILERS)[number];

export function isRetailer(value: string): value is Retailer {
  return (RETAILERS as readonly string[]).includes(value);
}

export const RETAILER_LABELS: Record<Retailer, string> = {
  amazon: "Amazon",
  walmart: "Walmart",
  bestbuy: "Best Buy",
  ebay: "eBay",
  newegg: "Newegg",
  asos: "ASOS",
};

/**
 * The supported stores as prose: "Amazon, Walmart, Best Buy, eBay and more".
 *
 * Generated rather than written out, because the list grows — every hardcoded
 * "6 stores" becomes a lie the day a seventh is added, and those strings hide
 * in error messages and marketing copy where nobody thinks to look.
 */
export function storeListPhrase(limit = 4): string {
  const names = Object.values(RETAILER_LABELS);
  const shown = names.slice(0, limit);
  return names.length > shown.length
    ? `${shown.join(", ")} and more`
    : shown.slice(0, -1).join(", ") + ` and ${shown[shown.length - 1]}`;
}

export interface ScrapedProduct {
  retailer: Retailer;
  /** ASIN / usItemId / TCIN / SKU — whatever that retailer keys the item by. */
  retailerId: string;
  title: string;
  /** Cents. Null when the item exists but has no purchasable price right now. */
  price: number | null;
  /** Cents. The retailer's struck-through "was" price, when they show one. */
  listPrice: number | null;
  currency: string;
  imageUrl: string | null;
  url: string;
  availability: string | null;
  /** Product rating out of 5. Null where the retailer doesn't publish one. */
  rating: number | null;
  ratingCount: number | null;
  /**
   * Seller feedback as a percentage (0–100), for marketplaces where the
   * meaningful signal is who's selling rather than what's being sold.
   *
   * eBay only. Deliberately a separate field from `rating`: 99.3% seller
   * feedback and 4.4 stars on a product are not the same claim, and showing
   * one in place of the other would let users compare numbers that don't mean
   * the same thing.
   */
  sellerRating: number | null;
  sellerRatingCount: number | null;
}

/**
 * Why a check failed, kept distinct because the two mean different things:
 * `blocked` is the retailer's anti-bot layer rejecting us (retrying the same
 * way won't help), `failed` is a structure change, timeout, or bad response
 * (worth retrying, and worth alerting on).
 */
export type ScrapeStatus = "success" | "failed" | "blocked";

export type ScrapeResult<T> =
  | { status: "success"; data: T; durationMs: number }
  | {
      status: "failed" | "blocked";
      data: null;
      detail: string;
      durationMs: number;
    };

export function ok<T>(data: T, durationMs: number): ScrapeResult<T> {
  return { status: "success", data, durationMs };
}

export function fail<T>(
  status: "failed" | "blocked",
  detail: string,
  durationMs: number,
): ScrapeResult<T> {
  // Bound what we store — a blocked response can be a full HTML error page and
  // we only need enough to tell the failure modes apart in an alert email.
  return { status, data: null, detail: detail.slice(0, 2000), durationMs };
}

/** Dollars (or a "$1,234.56" string) to integer cents. */
export function toCents(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n =
    typeof value === "number"
      ? value
      : Number(String(value).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}
