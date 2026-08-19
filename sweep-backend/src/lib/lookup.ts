// lib/lookup.ts
//
// Product lookup: one enriched page about one product.
//
// This replaced "Sweep this deal", and the shape of the work changed with it.
// A sweep fanned out to every retailer and re-read history across all of them
// to answer "is this a good deal?". A lookup asks one store everything it
// knows about one item, which is both cheaper and closer to what people were
// actually opening the app to do.
//
// Three properties matter here:
//
//  1. It never invents data. Stores differ wildly in what they expose, and a
//     page that pads Etsy out to look like Amazon would be lying about the
//     thing the app exists to be trusted on.
//  2. It degrades to what we already know. If the store is down, cooling off,
//     or has no enricher at all, the cached row still makes a real page —
//     price, history, image, title — rather than an error screen.
//  3. It pays for itself. A lookup reads a live price, so it updates the
//     shared product cache and price history on the way past. Someone reading
//     a product page improves the data for everyone tracking that item.

import type { DetailCoverage, ProductDetail } from "./productDetail.js";
import { COVERAGE } from "./productDetail.js";
import { prisma } from "./prisma.js";
import { upsertScrapedProduct } from "./priceChecker.js";
import { adapters } from "./scrapers/index.js";
import { judgeSale, type SaleAssessment } from "./saleVerdict.js";
import type { Retailer, ScrapedProduct } from "./scrapers/types.js";

export interface PricePoint {
  price: number;
  checkedAt: string;
}

export interface LookupResult {
  detail: ProductDetail;
  /**
   * Is this "sale" real, judged against the product's own price history?
   *
   * The one claim on the page that comes from our data rather than the
   * store's, and the only one nobody else can make. Free to compute — the
   * history is already loaded for the graph — and it was always the strongest
   * part of what "Sweep this deal" did. Null when there is no price to judge.
   */
  sale: SaleAssessment | null;
  /** Which sections this store can fill at all — see productDetail.ts. */
  coverage: DetailCoverage;
  history: PricePoint[];
  /** Our product row, so the page can offer to track it. */
  productId: string;
  isTracked: boolean;
  /**
   * Whether we reached the store just now.
   *
   * False means everything below came from cache — still worth showing, but
   * the page says so rather than presenting stale data as live.
   */
  fresh: boolean;
  /** Why we fell back, when we did. Null on the happy path. */
  staleReason: "blocked" | "failed" | "unsupported" | null;
}

/**
 * Look one product up.
 *
 * `productId` must already exist — callers resolve a url or retailer/id pair
 * through resolveProduct first, so that "we can't identify this product" is
 * answered before anyone's daily allowance is touched.
 */
export async function lookupProduct(
  productId: string,
  options: { userId?: string; historyDays?: number | null } = {},
): Promise<LookupResult | null> {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return null;

  const retailer = product.retailer as Retailer;
  const adapter = adapters[retailer];

  let detail: ProductDetail | null = null;
  let staleReason: LookupResult["staleReason"] = null;

  if (!adapter?.enrich) {
    staleReason = "unsupported";
  } else {
    const result = await adapter.enrich(product.url);
    if (result.status === "success") {
      detail = result.data;
    } else {
      // "blocked" and "failed" mean different things to the reader: one is the
      // store refusing us right now, the other is our problem. Both fall back,
      // but the page can say which.
      staleReason = result.status === "blocked" ? "blocked" : "failed";
    }
  }

  // A live read is also a price check. Folding it back into the shared cache
  // is free — we already paid for the call — and it means a popular product
  // being read stays fresh for everyone tracking it.
  if (detail) {
    try {
      await upsertScrapedProduct(toScraped(detail));
    } catch {
      // Cache maintenance must never cost the user the page they asked for.
    }
  }

  const [history, tracked] = await Promise.all([
    loadHistory(productId, options.historyDays),
    options.userId
      ? prisma.trackedProduct.findUnique({
          where: { userId_productId: { userId: options.userId, productId } },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);

  const shown = detail ?? fromCache(product);
  const prices = history.map((point) => point.price);

  return {
    detail: shown,
    sale: shown.price === null ? null : judgeSale({
      price: shown.price,
      listPrice: shown.listPrice,
      low: prices.length ? Math.min(...prices) : null,
      average: prices.length
        ? Math.round(prices.reduce((sum, p) => sum + p, 0) / prices.length)
        : null,
      points: prices.length,
      claimedPercentOff:
        shown.listPrice !== null && shown.listPrice > shown.price
          ? Math.round(((shown.listPrice - shown.price) / shown.listPrice) * 100)
          : null,
    }),
    coverage: COVERAGE[retailer] ?? {
      reviews: false,
      seller: false,
      shipping: false,
      specs: false,
    },
    history,
    productId,
    isTracked: tracked !== null,
    fresh: detail !== null,
    staleReason,
  };
}

/**
 * Price history for the graph.
 *
 * Bounded by the tier's history window, because that's the promise the plan
 * makes. `null` days means unlimited (Ultimate).
 */
async function loadHistory(
  productId: string,
  historyDays: number | null | undefined,
): Promise<PricePoint[]> {
  const since =
    typeof historyDays === "number"
      ? new Date(Date.now() - historyDays * 24 * 60 * 60 * 1000)
      : undefined;

  const rows = await prisma.priceHistory.findMany({
    where: { productId, ...(since ? { checkedAt: { gte: since } } : {}) },
    orderBy: { checkedAt: "asc" },
    select: { price: true, checkedAt: true },
    // A ceiling so a long-tracked product can't return thousands of points to
    // a phone that will draw them into 300 pixels.
    take: 500,
  });

  return rows.map((row) => ({
    price: row.price,
    checkedAt: row.checkedAt.toISOString(),
  }));
}

/** The detail we can build without reaching the store at all. */
function fromCache(
  product: NonNullable<Awaited<ReturnType<typeof prisma.product.findUnique>>>,
): ProductDetail {
  return {
    retailer: product.retailer as Retailer,
    retailerId: product.retailerId,
    title: product.title,
    url: product.url,
    price: product.currentPrice,
    listPrice: product.listPrice,
    currency: product.currency,
    availability: product.availability,
    inStock: null,
    images: product.imageUrl ? [product.imageUrl] : [],
    brand: null,
    description: null,
    features: [],
    specs: [],
    rating: product.rating,
    ratingCount: product.ratingCount,
    // Explicitly null rather than empty structures: "we have no reviews for
    // you" and "this product has no reviews" must not render the same way.
    reviews: null,
    seller: null,
    shipping: null,
    trust: null,
    coupon: null,
    condition: null,
    fetchedAt: (product.lastCheckedAt ?? product.createdAt).toISOString(),
  };
}

/** Back to the price-check shape, so the cache update can be reused as-is. */
function toScraped(detail: ProductDetail): ScrapedProduct {
  return {
    retailer: detail.retailer,
    retailerId: detail.retailerId,
    title: detail.title,
    price: detail.price,
    listPrice: detail.listPrice,
    currency: detail.currency,
    imageUrl: detail.images[0] ?? null,
    url: detail.url,
    availability: detail.availability,
    rating: detail.rating,
    ratingCount: detail.ratingCount,
    sellerRating: detail.seller?.ratingPercent ?? null,
    sellerRatingCount: detail.seller?.ratingCount ?? null,
  };
}
