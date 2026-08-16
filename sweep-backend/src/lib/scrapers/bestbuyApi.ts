// lib/scrapers/bestbuyApi.ts
//
// Best Buy through their official Products API instead of their website.
//
// Scraping bestbuy.com works fine from a home connection and not at all from a
// datacenter: measured side by side, the same code returned four products in
// 3.5s here and timed out after 65s on Railway. That is IP reputation, and no
// amount of parsing or pacing fixes it.
//
// Best Buy publish a free API that returns the same catalogue as structured
// JSON, so this path is better in every direction — no blocking, no HTML to
// re-learn when they redesign, prices and review counts as numbers rather than
// scraped strings, and roughly a tenth of the bytes.
//
// The scraper is kept as a fallback for when no key is configured, so local
// work and anyone running this without credentials still gets results.

import {
  fail,
  ok,
  toCents,
  type ScrapeResult,
  type ScrapedProduct,
} from "./types.js";

const BASE = "https://api.bestbuy.com/v1";

/** Only what we render — the default response is enormous. */
const FIELDS = [
  "sku",
  "name",
  "salePrice",
  "regularPrice",
  "image",
  "url",
  "onlineAvailability",
  "customerReviewAverage",
  "customerReviewCount",
].join(",");

/**
 * Long queries hurt relevance here for the same reason they did when scraping:
 * every term is ANDed, so a full product title with a colour and a capacity
 * matches nothing.
 */
const KEYWORD_WORDS = 6;

const TIMEOUT_MS = 8_000;

export function bestBuyApiKey(): string | null {
  return process.env.BESTBUY_API_KEY?.trim() || null;
}

interface ApiProduct {
  sku?: number;
  name?: string;
  salePrice?: number | null;
  regularPrice?: number | null;
  image?: string | null;
  url?: string | null;
  onlineAvailability?: boolean;
  customerReviewAverage?: string | number | null;
  customerReviewCount?: number | null;
}

function toProduct(raw: ApiProduct): ScrapedProduct | null {
  const sku = raw.sku;
  if (!sku || !raw.name) return null;

  const price = toCents(raw.salePrice);
  const regular = toCents(raw.regularPrice);

  return {
    retailer: "bestbuy",
    retailerId: String(sku),
    title: raw.name,
    price,
    // Only a genuine "was" price. Best Buy returns regularPrice equal to
    // salePrice when nothing is discounted, and showing a struck-through
    // identical number is how a fake sale looks.
    listPrice: regular !== null && price !== null && regular > price ? regular : null,
    currency: "USD",
    imageUrl: raw.image ?? null,
    url: raw.url || `https://www.bestbuy.com/site/-/${sku}.p?skuId=${sku}`,
    availability: raw.onlineAvailability === false ? "out_of_stock" : "in_stock",
    rating: raw.customerReviewAverage != null ? Number(raw.customerReviewAverage) : null,
    ratingCount: raw.customerReviewCount ?? null,
    sellerRating: null,
    sellerRatingCount: null,
  };
}

async function call(path: string, params: Record<string, string>) {
  const key = bestBuyApiKey();
  if (!key) throw new Error("BESTBUY_API_KEY is not set");

  const query = new URLSearchParams({ ...params, format: "json", apiKey: key });
  const res = await fetch(`${BASE}/${path}?${query}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: "application/json" },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // 403 here means the key is wrong or over quota, not that we're blocked as
    // a bot — worth distinguishing so the health page doesn't cry wolf.
    throw Object.assign(new Error(`Best Buy API ${res.status}: ${body.slice(0, 200)}`), {
      status: res.status,
    });
  }
  return res.json();
}

export async function searchBestBuyApi(
  keyword: string,
  limit = 4,
): Promise<ScrapeResult<ScrapedProduct[]>> {
  const started = Date.now();
  try {
    // Each word becomes its own search= term, ANDed together, which is how the
    // API expects a phrase. Punctuation confuses the parser, so it goes.
    const words = keyword
      .toLowerCase()
      .replace(/[^\w\s-]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, KEYWORD_WORDS);

    if (words.length === 0) return ok([], Date.now() - started);

    const terms = words.map((w) => `search=${encodeURIComponent(w)}`).join("&");
    const body = (await call(`products((${terms}))`, {
      show: FIELDS,
      pageSize: String(Math.min(Math.max(limit, 1), 100)),
      // Best sellers first: closer to what someone typing a product name means
      // than the API's default relevance, which favours accessories.
      sort: "bestSellingRank.asc",
    })) as { products?: ApiProduct[] };

    const products = (body.products ?? [])
      .map(toProduct)
      .filter((p): p is ScrapedProduct => p !== null)
      // A listing with no price can't be compared or tracked.
      .filter((p) => p.price !== null)
      .slice(0, limit);

    return ok(products, Date.now() - started);
  } catch (err) {
    return fail("failed", describe(err), Date.now() - started);
  }
}

export async function scrapeBestBuyApiProduct(
  url: string,
): Promise<ScrapeResult<ScrapedProduct>> {
  const started = Date.now();
  const sku =
    url.match(/(?:skuId=|\/sku\/)(\d{6,})/)?.[1] ??
    url.match(/\/(\d{6,})\.p/)?.[1] ??
    (/^\d{6,}$/.test(url) ? url : null);

  if (!sku) {
    return fail("failed", `no SKU in ${url.slice(0, 120)}`, Date.now() - started);
  }

  try {
    const raw = (await call(`products/${sku}.json`, { show: FIELDS })) as ApiProduct;
    const product = toProduct(raw);
    if (!product) {
      return fail("failed", `SKU ${sku} returned no usable product`, Date.now() - started);
    }
    return ok(product, Date.now() - started);
  } catch (err) {
    return fail("failed", describe(err), Date.now() - started);
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError") return `no answer within ${TIMEOUT_MS / 1000}s`;
    return err.message.slice(0, 300);
  }
  return String(err).slice(0, 300);
}
