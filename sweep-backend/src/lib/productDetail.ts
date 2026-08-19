// lib/productDetail.ts
//
// One shape for "everything we can say about a single product".
//
// The design constraint is coverage, and it is severe: Amazon returns an AI
// review summary with per-topic sentiment and customer photos, eBay returns
// seller feedback and a delivery window, Etsy returns almost none of it. A
// type that assumed the richest store would force every other store to invent
// data, which is the one thing a price-comparison app cannot do.
//
// So every field below is optional, and the rule for rendering is: show what
// exists, omit what doesn't, never substitute something that looks similar.
// A missing section is honest. A guessed one is not.

import type { Retailer } from "./scrapers/types.js";

/**
 * How buyers describe one aspect of a product, as summarised by the store.
 *
 * Amazon derives these from its own review corpus. We pass them through rather
 * than recompute anything: we have no access to the underlying reviews, and a
 * number we can't derive is a number we shouldn't imply we derived.
 */
export interface ReviewTopic {
  /** "Sound quality", "Fit", "Battery life". */
  topic: string;
  positiveMentions: number;
  negativeMentions: number;
  /** The store's own one-line characterisation, where it gives one. */
  description: string | null;
  /** Verbatim buyer quotes. Trimmed of the leading ellipsis Amazon includes. */
  quotes: string[];
}

export interface ReviewSummary {
  /** Prose summary of what buyers say, written by the store, not by us. */
  text: string | null;
  /** Aspects buyers agree are good / bad / are split on. */
  positive: string[];
  negative: string[];
  mixed: string[];
  topics: ReviewTopic[];
  /** Photos buyers attached to reviews. */
  images: string[];
}

export interface SellerInfo {
  name: string | null;
  /** Feedback as a percentage, 0–100. Marketplaces only. */
  ratingPercent: number | null;
  ratingCount: number | null;
  /** How many sellers offer this item, where the store says. */
  offerCount: number | null;
  url: string | null;
}

export interface ShippingInfo {
  /** Cents. 0 means genuinely free, null means we don't know — not the same. */
  costCents: number | null;
  /** ISO dates bounding the store's own delivery estimate. */
  earliest: string | null;
  latest: string | null;
}

/** A name/value row from the store's spec table. */
export interface SpecRow {
  label: string;
  value: string;
}

/**
 * Signals about the listing itself rather than the product.
 *
 * Kept separate from specs because these change how much to trust the page,
 * not what the item is. "Frequently returned" is the single most useful thing
 * on an Amazon listing and it is nowhere near the price.
 */
export interface TrustSignals {
  /** "Amazon's Choice", "Best Seller" — the store's own badge text. */
  badge: string | null;
  amazonChoice: boolean;
  /** Amazon flags items with an unusually high return rate. Worth surfacing. */
  frequentlyReturned: boolean;
  frequentlyReturnedNote: string | null;
  /** "2K+ bought in past month" — demand, in the store's own words. */
  boughtRecently: string | null;
  bestSellerRank: number | null;
  bestSellerCategory: string | null;
}

export interface ProductDetail {
  retailer: Retailer;
  retailerId: string;
  title: string;
  url: string;
  /** Cents. Null when the item exists but isn't purchasable right now. */
  price: number | null;
  listPrice: number | null;
  currency: string;
  availability: string | null;
  inStock: boolean | null;

  images: string[];
  brand: string | null;
  description: string | null;
  /** The store's bullet points, verbatim. */
  features: string[];
  specs: SpecRow[];

  rating: number | null;
  ratingCount: number | null;
  reviews: ReviewSummary | null;

  seller: SellerInfo | null;
  shipping: ShippingInfo | null;
  trust: TrustSignals | null;

  /** Store-issued discount, where the store exposes one. */
  coupon: string | null;

  /** Condition, for marketplaces where it varies. */
  condition: string | null;

  /** When this was read from the store. */
  fetchedAt: string;
}

/**
 * Which sections a store can fill, so the client can render placeholders that
 * match reality rather than showing empty panels for data that will never come.
 *
 * Sent alongside the detail rather than inferred from which fields are null:
 * "Etsy never returns shipping" and "this Etsy listing happens to have no
 * shipping" want different UI, and only the server knows which is which.
 */
export interface DetailCoverage {
  reviews: boolean;
  seller: boolean;
  shipping: boolean;
  specs: boolean;
}

export const COVERAGE: Record<Retailer, DetailCoverage> = {
  // The richest by a distance: review summaries, per-topic sentiment, buyer
  // photos, a full spec table.
  amazon: { reviews: true, seller: true, shipping: false, specs: true },
  // Seller feedback and a real delivery window; no review corpus at all,
  // because eBay rates sellers rather than products.
  ebay: { reviews: false, seller: true, shipping: true, specs: true },
  // Reviews exist per-listing but many listings have none. Shop-level only.
  etsy: { reviews: true, seller: true, shipping: false, specs: true },
  bestbuy: { reviews: true, seller: false, shipping: false, specs: true },
  walmart: { reviews: false, seller: false, shipping: false, specs: false },
  newegg: { reviews: false, seller: false, shipping: false, specs: false },
  asos: { reviews: false, seller: false, shipping: false, specs: false },
};

/** Amazon prefixes many quotes with an ellipsis where it clipped the review. */
export function cleanQuote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.replace(/^[\s.…]+/, "").replace(/[\s.…]+$/, "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Coerce to a finite number, or null. Store payloads mix strings and nulls. */
export function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Non-empty strings only, deduplicated, order preserved. */
export function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item === "string" && item.trim()) seen.add(item.trim());
  }
  return [...seen];
}
