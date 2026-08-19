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

import {
  type ProductDetail,
  type ReviewTopic,
  cleanQuote,
  num,
  strings,
} from "../productDetail.js";

const BASE = "https://openapi.etsy.com/v3/application";
const TIMEOUT_MS = 8_000;

/**
 * Etsy's x-api-key wants the keystring and the shared secret joined by a
 * colon. The keystring alone returns 403 "Shared secret is required in
 * x-api-key header" — verified against the live API, since the documentation
 * is read both ways in the wild.
 */
export function etsyApiKey(): string | null {
  const key = process.env.ETSY_API_KEY?.trim();
  const secret = process.env.ETSY_SHARED_SECRET?.trim();
  if (!key || !secret) return null;
  return `${key}:${secret}`;
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

/**
 * Fetch full listings, with images, for ids we already have.
 *
 * The search endpoint accepts `includes=Images` and silently ignores it —
 * verified against the live API, where the response carries no image field of
 * any kind. The batch endpoint honours it, so images cost one extra call for
 * the whole page rather than one call per listing. At 5,000 requests a day
 * that is 2,500 searches, which is far more than this store will see.
 */
async function fetchWithImages(ids: number[]): Promise<EtsyListing[]> {
  if (ids.length === 0) return [];
  const body = (await call("listings/batch", {
    listing_ids: ids.join(","),
    includes: "Images",
  })) as { results?: EtsyListing[] };
  return body.results ?? [];
}

export async function searchEtsy(
  keyword: string,
  limit = 4,
): Promise<ScrapeResult<ScrapedProduct[]>> {
  const started = Date.now();
  try {
    // Relevance, not price. Sorting by price ascending sorts the whole
    // catalogue, so "coffee mug" returned a $0.22 t-shirt that merely
    // contained one of the words, while relevance returned an $11.77 mug.
    // Price ordering belongs within the results a search actually returns,
    // which is what the app already does with every store's rows.
    const body = (await call("listings/active", {
      keywords: keyword,
      limit: String(Math.min(Math.max(limit, 1), 100)),
      includes: "Images",
    })) as { results?: EtsyListing[] };

    const ids = (body.results ?? [])
      .map((listing) => listing.listing_id)
      .filter((id): id is number => typeof id === "number")
      .slice(0, limit);

    // Search order is relevance and batch does not preserve it, so the ids
    // decide the order rather than whatever comes back.
    const detailed = new Map(
      (await fetchWithImages(ids)).map((listing) => [listing.listing_id, listing]),
    );

    const products = ids
      .map((id) => detailed.get(id))
      .filter((listing): listing is EtsyListing => listing !== undefined)
      .map(toProduct)
      .filter((p): p is ScrapedProduct => p !== null);

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
    // Batch with a single id, for the same reason search uses it: the
    // single-listing endpoint returns no images either.
    const [raw] = await fetchWithImages([Number(id)]);
    const product = raw ? toProduct(raw) : null;
    if (!product) {
      return fail("failed", `listing ${id} returned nothing usable`, Date.now() - started);
    }
    return ok(product, Date.now() - started);
  } catch (err) {
    return fail("failed", describe(err), Date.now() - started);
  }
}

/**
 * Product lookup for one Etsy listing.
 *
 * Two calls: the listing itself (with images), and the listing's reviews.
 * Reviews are fetched separately because Etsy does not fold them into the
 * listing payload, and they are the one thing this store has that the price
 * check throws away.
 *
 * Coverage here is genuinely thinner than Amazon's, and that is reported
 * rather than padded. `num_favorers` is deliberately NOT mapped to a rating:
 * a listing favourited 400 times has not been rated 400 times, and putting
 * that number under a star would be a lie with a number attached.
 */
export async function enrichEtsyProduct(
  url: string,
): Promise<ScrapeResult<ProductDetail>> {
  const started = Date.now();
  const id = url.match(/\/listing\/(\d+)/)?.[1] ?? (/^\d+$/.test(url) ? url : null);
  if (!id) {
    return fail("failed", `no listing id in ${url.slice(0, 120)}`, Date.now() - started);
  }

  try {
    const [raw] = await fetchWithImages([Number(id)]);
    const base = raw ? toProduct(raw) : null;
    if (!base || !raw) {
      return fail("failed", `listing ${id} returned nothing usable`, Date.now() - started);
    }

    // A listing with no reviews is the common case, and a failure here must
    // not lose the listing we already have — the page is still worth showing.
    let reviews: Awaited<ReturnType<typeof fetchEtsyReviews>> = null;
    try {
      reviews = await fetchEtsyReviews(id);
    } catch {
      reviews = null;
    }

    const anyRaw = raw as Record<string, unknown>;
    const specs = [
      ["Materials", strings(anyRaw.materials).join(", ")],
      ["Made by", etsyEnum(anyRaw.who_made, WHO_MADE)],
      ["When made", etsyEnum(anyRaw.when_made, WHEN_MADE)],
    ]
      .filter(([, value]) => value)
      .map(([label, value]) => ({ label, value: String(value) }));

    return ok(
      {
        retailer: "etsy",
        retailerId: base.retailerId,
        title: base.title,
        url: base.url,
        price: base.price,
        listPrice: base.listPrice,
        currency: base.currency,
        availability: base.availability,
        inStock: typeof raw.quantity === "number" ? raw.quantity > 0 : null,

        images: strings([
          base.imageUrl,
          ...(raw.images ?? []).map((i) => i?.url_fullxfull ?? i?.url_570xN),
        ]),
        brand: null,
        description:
          typeof anyRaw.description === "string" && anyRaw.description.trim()
            ? anyRaw.description.trim()
            : null,
        features: strings(anyRaw.tags).slice(0, 8),
        specs,

        rating: reviews?.average ?? null,
        ratingCount: reviews?.count ?? null,
        reviews: reviews && reviews.topics.length > 0
          ? {
              text: null,
              positive: [],
              negative: [],
              mixed: [],
              topics: reviews.topics,
              images: reviews.images,
            }
          : null,

        seller: null,
        shipping: null,
        trust: null,
        coupon: null,
        condition: null,
        fetchedAt: new Date().toISOString(),
      },
      Date.now() - started,
    );
  } catch (err) {
    return fail("failed", describe(err), Date.now() - started);
  }
}

/**
 * Reviews for one listing.
 *
 * Etsy returns individual reviews rather than a summary, so unlike Amazon
 * there is nothing pre-aggregated to pass through — the average is computed
 * here from the ratings in the page we were given, and is therefore an average
 * of THOSE reviews, not of every review ever left. The count is Etsy's own
 * total, so the two are reported as what they are and never blended.
 */
async function fetchEtsyReviews(listingId: string): Promise<{
  average: number | null;
  count: number | null;
  topics: ReviewTopic[];
  images: string[];
} | null> {
  const body = (await call(`listings/${listingId}/reviews`, {
    limit: "20",
  })) as {
    count?: number;
    results?: {
      rating?: number;
      review?: string;
      image_url_fullxfull?: string | null;
    }[];
  };

  const results = body.results ?? [];
  if (results.length === 0) {
    return { average: null, count: num(body.count), topics: [], images: [] };
  }

  const ratings = results
    .map((r) => num(r.rating))
    .filter((r): r is number => r !== null);
  const average =
    ratings.length > 0
      ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
      : null;

  // Etsy has no topic model, so the reviews are presented as a single group
  // rather than invented topics. Positive/negative counts come from the star
  // ratings actually attached to the quotes shown.
  const quotes = results
    .map((r) => cleanQuote(r.review))
    .filter((q): q is string => q !== null)
    .slice(0, 6);

  const topics: ReviewTopic[] =
    quotes.length > 0
      ? [
          {
            topic: "What buyers said",
            positiveMentions: ratings.filter((r) => r >= 4).length,
            negativeMentions: ratings.filter((r) => r <= 2).length,
            description: null,
            quotes,
          },
        ]
      : [];

  return {
    average,
    count: num(body.count),
    topics,
    images: strings(results.map((r) => r.image_url_fullxfull)),
  };
}

// Etsy returns these fields as raw enum tokens. "someone_else" is a database
// value, not something to show a person, and an unmapped token is dropped
// rather than printed — a blank row beats a row that reads like a bug.
const WHO_MADE: Record<string, string> = {
  i_did: "The shop owner",
  collective: "A member of the shop",
  someone_else: "Another company",
};

const WHEN_MADE: Record<string, string> = {
  made_to_order: "Made to order",
  "2020_2026": "2020s",
  "2010_2019": "2010s",
  "2000_2009": "2000s",
  before_2000: "Before 2000",
  vintage: "Vintage",
};

function etsyEnum(value: unknown, table: Record<string, string>): string {
  return typeof value === "string" ? (table[value] ?? "") : "";
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
