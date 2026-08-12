// lib/scrapers/ebay.ts
//
// eBay is the one retailer with a real, free, official API, so there is no
// scraping here at all — and scraping is not a fallback: ebay.com answers a
// plain fetch with HTTP 403.
//
// Uses the Buy Browse API with an application (client-credentials) token,
// which is all that's needed for public search and item lookup — no user
// consent flow. 5,000 calls/day on the free tier.
//
// Requires EBAY_CLIENT_ID and EBAY_CLIENT_SECRET. Until those are set, every
// call returns a "failed" result with a clear reason instead of throwing, so
// a missing key degrades the eBay tile rather than breaking compiled search.
// Setup steps are in docs/INTEGRATIONS.md.

import { ScrapeHttpError, fetchJson } from "./http.js";
import {
  type ScrapeResult,
  type ScrapedProduct,
  fail,
  ok,
  toCents,
} from "./types.js";

const OAUTH_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const BROWSE_URL = "https://api.ebay.com/buy/browse/v1";
const SCOPE = "https://api.ebay.com/oauth/api_scope";

// eBay marketplace + delivery country. US-only for now, matching the retailers
// we cover; both are sent on every Browse call.
const MARKETPLACE_ID = "EBAY_US";

let cachedToken: { value: string; expiresAt: number } | null = null;

export function isEbayConfigured() {
  return Boolean(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET);
}

export async function searchEbay(
  keyword: string,
  limit = 4,
): Promise<ScrapeResult<ScrapedProduct[]>> {
  const started = Date.now();

  if (!isEbayConfigured()) {
    return fail("failed", NOT_CONFIGURED, elapsed(started));
  }

  try {
    const token = await getToken();
    const query = new URLSearchParams({
      q: keyword,
      limit: String(limit),
      // Fixed-price only. Auction "prices" are a bid in progress, not a price
      // you can pay, so charting them alongside retail prices is misleading.
      filter: "buyingOptions:{FIXED_PRICE}",
    });

    const payload = await fetchJson<any>(
      `${BROWSE_URL}/item_summary/search?${query}`,
      { headers: browseHeaders(token), retries: 1 },
    );

    const items = payload?.itemSummaries;
    if (!Array.isArray(items)) {
      // A zero-result search legitimately omits itemSummaries.
      if (payload?.total === 0) return ok([], elapsed(started));
      return fail("failed", "itemSummaries missing from Browse response", elapsed(started));
    }

    const products = items
      .map(parseItemSummary)
      .filter((p): p is ScrapedProduct => p !== null)
      .slice(0, limit);

    return ok(products, elapsed(started));
  } catch (err) {
    return fail(kindOf(err), messageOf(err), elapsed(started));
  }
}

export async function scrapeEbayProduct(
  url: string,
): Promise<ScrapeResult<ScrapedProduct>> {
  const started = Date.now();

  if (!isEbayConfigured()) {
    return fail("failed", NOT_CONFIGURED, elapsed(started));
  }

  const itemId = extractItemId(url);
  if (!itemId) {
    return fail("failed", `could not read an item id out of ${url}`, elapsed(started));
  }

  try {
    const token = await getToken();
    // Legacy numeric ids from a listing url need the compatibility endpoint;
    // v1|...|... ids go to the direct one.
    const endpoint = itemId.startsWith("v1|")
      ? `${BROWSE_URL}/item/${encodeURIComponent(itemId)}`
      : `${BROWSE_URL}/item/get_item_by_legacy_id?legacy_item_id=${itemId}`;

    const item = await fetchJson<any>(endpoint, {
      headers: browseHeaders(token),
      retries: 1,
    });

    const parsed = parseItem(item);
    if (!parsed) {
      return fail("failed", "item payload had no usable id/title", elapsed(started));
    }

    return ok(parsed, elapsed(started));
  } catch (err) {
    return fail(kindOf(err), messageOf(err), elapsed(started));
  }
}

export function ebayProductUrl(retailerId: string) {
  return `https://www.ebay.com/itm/${retailerId}`;
}

// ---- auth ------------------------------------------------------------------

/**
 * Application tokens last ~2 hours. Cache until shortly before expiry so we
 * spend call budget on searches rather than on re-authenticating.
 */
async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.value;
  }

  const credentials = Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`,
  ).toString("base64");

  const res = await fetch(OAUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: SCOPE,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new ScrapeHttpError(
      `eBay OAuth failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
      "failed",
      res.status,
    );
  }

  const body = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in - 120) * 1000,
  };
  return cachedToken.value;
}

function browseHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE_ID,
    "Content-Type": "application/json",
  };
}

// ---- parsing ---------------------------------------------------------------

function parseItemSummary(item: any): ScrapedProduct | null {
  const retailerId = item?.legacyItemId ?? item?.itemId;
  const title = item?.title;
  if (!retailerId || !title) return null;

  const price = toCents(item?.price?.value);
  const listPrice = toCents(
    item?.marketingPrice?.originalPrice?.value ?? item?.originalPrice?.value,
  );

  return {
    retailer: "ebay",
    retailerId: String(retailerId),
    title: String(title),
    price,
    listPrice: listPrice && price && listPrice > price ? listPrice : null,
    currency: item?.price?.currency ?? "USD",
    imageUrl: item?.image?.imageUrl ?? item?.thumbnailImages?.[0]?.imageUrl ?? null,
    url: item?.itemWebUrl ?? ebayProductUrl(String(retailerId)),
    availability: item?.itemEndDate ? "LISTED" : "IN_STOCK",
    // eBay publishes no product rating at all — verified: not in
    // item_summary/search, and getItem?fieldgroups=PRODUCT returns no
    // primaryProductReviewRating for ordinary marketplace listings either.
    // Seller feedback is the signal it does have, and on eBay it's arguably
    // the more useful one, so it's surfaced separately.
    rating: null,
    ratingCount: null,
    sellerRating: numberOrNull(item?.seller?.feedbackPercentage),
    sellerRatingCount: numberOrNull(item?.seller?.feedbackScore),
  };
}

function parseItem(item: any): ScrapedProduct | null {
  const retailerId = item?.legacyItemId ?? item?.itemId;
  const title = item?.title;
  if (!retailerId || !title) return null;

  const price = toCents(item?.price?.value);
  const listPrice = toCents(item?.marketingPrice?.originalPrice?.value);

  return {
    retailer: "ebay",
    retailerId: String(retailerId),
    title: String(title),
    price,
    listPrice: listPrice && price && listPrice > price ? listPrice : null,
    currency: item?.price?.currency ?? "USD",
    imageUrl: item?.image?.imageUrl ?? null,
    url: item?.itemWebUrl ?? ebayProductUrl(String(retailerId)),
    availability: item?.estimatedAvailabilities?.[0]?.estimatedAvailabilityStatus ?? null,
    rating: null,
    ratingCount: null,
    sellerRating: numberOrNull(item?.seller?.feedbackPercentage),
    sellerRatingCount: numberOrNull(item?.seller?.feedbackScore),
  };
}

/** feedbackPercentage comes back as a string ("99.3"), feedbackScore as a number. */
function numberOrNull(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function extractItemId(url: string): string | null {
  if (url.startsWith("v1|")) return url;
  return url.match(/\/itm\/(?:.*\/)?(\d{9,})/)?.[1] ?? url.match(/item=(\d{9,})/)?.[1] ?? null;
}

const NOT_CONFIGURED =
  "eBay is not configured — set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET (see docs/INTEGRATIONS.md)";

function elapsed(started: number) {
  return Date.now() - started;
}

function kindOf(err: unknown): "failed" | "blocked" {
  return err instanceof ScrapeHttpError && err.kind === "blocked"
    ? "blocked"
    : "failed";
}

function messageOf(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
