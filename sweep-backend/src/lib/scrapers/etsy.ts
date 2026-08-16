// lib/scrapers/etsy.ts
//
// Etsy through their Open API v3.
//
// Added because three stores is a thin comparison and the ones we could scrape
// don't answer from a datacenter. Etsy publishes a real API with a plain API
// key — no affiliate approval, no sales threshold, no proxy — which currently
// makes it the cheapest store to add by a wide margin.
//
// Deliberately scoped to home, clothing, toys and beauty. Etsy sells phone
// cases and laptop stickers, so leaving it unrestricted would put handmade
// accessories in the results for "airpods pro" — technically matches, useless
// to the person searching.
//
// Worth knowing about the data: Etsy listings are often one-off or made to
// order, so a "price drop" on a handmade item means less than it does on a
// SKU that ten thousand people are also watching. It earns its place in search
// and lists more than in price tracking.

import { fail, ok, type ScrapeResult, type ScrapedProduct } from "./types.js";

const BASE = "https://openapi.etsy.com/v3/application";
const TIMEOUT_MS = 8_000;

export function etsyApiKey(): string | null {
  return process.env.ETSY_API_KEY?.trim() || null;
}

/**
 * Etsy states prices as an integer plus the divisor that makes it decimal:
 * { amount: 1999, divisor: 100 } is 19.99. Divisor is not always 100, so
 * dividing by a hardcoded hundred would be wrong for some currencies.
 */
interface EtsyPrice {
  amount?: number;
  divisor?: number;
  currency_code?: string;
}

interface EtsyListing {
  listing_id?: number;
  title?: string;
  url?: string;
  price?: EtsyPrice;
  quantity?: number;
  images?: { url_570xN?: string; url_fullxfull?: string }[];
  num_favorers?: number;
}

function priceToCents(price: EtsyPrice | undefined): number | null {
  if (!price || typeof price.amount !== "number") return null;
  const divisor = price.divisor && price.divisor > 0 ? price.divisor : 100;
  const cents = Math.round((price.amount / divisor) * 100);
  return cents > 0 ? cents : null;
}

function toProduct(raw: EtsyListing): ScrapedProduct | null {
  if (!raw.listing_id || !raw.title) return null;
  const price = priceToCents(raw.price);
  if (price === null) return null;

  return {
    retailer: "etsy",
    retailerId: String(raw.listing_id),
    title: raw.title,
    price,
    // Etsy has no "was" price on the listing itself — sales are applied at the
    // shop level and not exposed here. Claiming a struck-through price we
    // can't see would be inventing one.
    listPrice: null,
    currency: raw.price?.currency_code ?? "USD",
    imageUrl: raw.images?.[0]?.url_570xN ?? raw.images?.[0]?.url_fullxfull ?? null,
    url: raw.url ?? `https://www.etsy.com/listing/${raw.listing_id}`,
    availability: raw.quantity === 0 ? "out_of_stock" : "in_stock",
    // Favourites are not a rating and must not be shown as one — a listing
    // with 400 favourites has not been rated 400 times.
    rating: null,
    ratingCount: null,
    sellerRating: null,
    sellerRatingCount: null,
  };
}

async function call(path: string, params: Record<string, string>) {
  const key = etsyApiKey();
  if (!key) throw new Error("ETSY_API_KEY is not set");

  const res = await fetch(`${BASE}/${path}?${new URLSearchParams(params)}`, {
    headers: { "x-api-key": key, accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw Object.assign(
      new Error(`Etsy API ${res.status}: ${body.slice(0, 200)}`),
      { status: res.status },
    );
  }
  return res.json();
}

export async function searchEtsy(
  keyword: string,
  limit = 4,
): Promise<ScrapeResult<ScrapedProduct[]>> {
  const started = Date.now();
  try {
    const body = (await call("listings/active", {
      keywords: keyword,
      limit: String(Math.min(Math.max(limit, 1), 100)),
      // Cheapest first matches what a comparison app is for. Etsy's default
      // ordering is relevance, which buries the price we're here to show.
      sort_on: "price",
      sort_order: "asc",
      includes: "Images",
    })) as { results?: EtsyListing[] };

    const products = (body.results ?? [])
      .map(toProduct)
      .filter((p): p is ScrapedProduct => p !== null)
      .slice(0, limit);

    return ok(products, Date.now() - started);
  } catch (err) {
    return fail("failed", describe(err), Date.now() - started);
  }
}

export async function scrapeEtsyProduct(
  url: string,
): Promise<ScrapeResult<ScrapedProduct>> {
  const started = Date.now();
  const id = url.match(/\/listing\/(\d+)/)?.[1] ?? (/^\d+$/.test(url) ? url : null);
  if (!id) {
    return fail("failed", `no listing id in ${url.slice(0, 120)}`, Date.now() - started);
  }

  try {
    const raw = (await call(`listings/${id}`, { includes: "Images" })) as EtsyListing;
    const product = toProduct(raw);
    if (!product) {
      return fail("failed", `listing ${id} returned nothing usable`, Date.now() - started);
    }
    return ok(product, Date.now() - started);
  } catch (err) {
    return fail("failed", describe(err), Date.now() - started);
  }
}

export function etsyProductUrl(retailerId: string) {
  return `https://www.etsy.com/listing/${retailerId}`;
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError") return `no answer within ${TIMEOUT_MS / 1000}s`;
    return err.message.slice(0, 300);
  }
  return String(err).slice(0, 300);
}
