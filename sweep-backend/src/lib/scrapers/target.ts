// lib/scrapers/target.ts
//
// STATUS: implemented but currently blocked. Read this before debugging it.
//
// Target does NOT work the way Walmart does, despite both being Next.js sites.
// Their __NEXT_DATA__ contains only { statusCode, pageContentQuerySSRPreloadVars }
// — the product grid is fetched client-side from RedSky, their internal API.
//
// So the only viable path is calling RedSky directly. That works in principle:
// the required `key` is a public web key inlined in every Target page, and this
// module scrapes it at runtime rather than hardcoding it, so a key rotation
// heals itself.
//
// What actually stops us is PerimeterX. RedSky answers datacenter IPs with
// HTTP 403 and a captcha body:
//
//   { "captchaRelativeURL": "/captcha?trackingId=..." }
//
// That will hit Railway/Render too, since those are datacenter IPs as well.
// Options, in the order worth trying — see docs/INTEGRATIONS.md:
//   1. A residential proxy in front of just this scraper.
//   2. Bright Data, which already handles Amazon for us, has a Target dataset.
//   3. Ship without Target and light the tile up later.
//
// Everything below is wired and will start returning data the moment requests
// stop being challenged — no rewrite needed.

import { ScrapeHttpError, fetchJson, fetchText } from "./http.js";
import {
  type ScrapeResult,
  type ScrapedProduct,
  fail,
  ok,
  toCents,
} from "./types.js";

const BASE = "https://www.target.com";
const REDSKY = "https://redsky.target.com/redsky_aggregations/v1/web";

// Last key observed inlined in Target's HTML. Only a seed — refreshKey()
// re-scrapes it, and this is here so a cold start still has something to try.
const FALLBACK_KEY = "9f36aeafbe60771e321a7cc95a78140772ab3e96";

// Default store for pricing. Target prices vary by store and RedSky requires
// one; this is a high-volume store that keeps national pricing sane.
const PRICING_STORE_ID = "3991";

let cachedKey: { value: string; fetchedAt: number } | null = null;
const KEY_TTL_MS = 6 * 60 * 60 * 1000;

export async function searchTarget(
  keyword: string,
  limit = 4,
): Promise<ScrapeResult<ScrapedProduct[]>> {
  const started = Date.now();

  try {
    const key = await resolveKey();
    const query = new URLSearchParams({
      key,
      channel: "WEB",
      count: String(limit),
      default_purchasability_filter: "true",
      include_dmc_dmr: "true",
      keyword,
      offset: "0",
      page: `/s/${keyword}`,
      platform: "desktop",
      pricing_store_id: PRICING_STORE_ID,
      useragent: "Mozilla/5.0",
      visitor_id: randomVisitorId(),
    });

    const payload = await fetchJson<any>(`${REDSKY}/plp_search_v2?${query}`, {
      headers: { origin: BASE, referer: `${BASE}/` },
      retries: 1,
    });

    const raw = payload?.data?.search?.products;
    if (!Array.isArray(raw)) {
      return fail(
        "failed",
        "data.search.products missing from RedSky response",
        elapsed(started),
      );
    }

    const products = raw
      .map(parseProduct)
      .filter((p): p is ScrapedProduct => p !== null)
      .slice(0, limit);

    return ok(products, elapsed(started));
  } catch (err) {
    return fail(kindOf(err), messageOf(err), elapsed(started));
  }
}

export async function scrapeTargetProduct(
  url: string,
): Promise<ScrapeResult<ScrapedProduct>> {
  const started = Date.now();

  const tcin = extractTcin(url);
  if (!tcin) {
    return fail("failed", `could not read a TCIN out of ${url}`, elapsed(started));
  }

  try {
    const key = await resolveKey();
    const query = new URLSearchParams({
      key,
      tcin,
      is_bot: "false",
      store_id: PRICING_STORE_ID,
      pricing_store_id: PRICING_STORE_ID,
      has_pricing_store_id: "true",
      channel: "WEB",
      page: `/p/A-${tcin}`,
    });

    const payload = await fetchJson<any>(`${REDSKY}/pdp_client_v1?${query}`, {
      headers: { origin: BASE, referer: `${BASE}/` },
      retries: 1,
    });

    const product = payload?.data?.product;
    if (!product) {
      return fail("failed", "data.product missing from RedSky response", elapsed(started));
    }

    const parsed = parseProduct(product);
    if (!parsed) {
      return fail("failed", "product payload had no usable tcin/title", elapsed(started));
    }

    return ok(parsed, elapsed(started));
  } catch (err) {
    return fail(kindOf(err), messageOf(err), elapsed(started));
  }
}

export function targetProductUrl(retailerId: string) {
  return `${BASE}/p/-/A-${retailerId}`;
}

// ---- key handling ----------------------------------------------------------

async function resolveKey(): Promise<string> {
  if (cachedKey && Date.now() - cachedKey.fetchedAt < KEY_TTL_MS) {
    return cachedKey.value;
  }

  try {
    const html = await fetchText(`${BASE}/`, { retries: 1, timeoutMs: 15_000 });
    // The key is inside an escaped JSON island, so it reads as \"apiKey\":\"...\"
    const found = html.match(/\\?"apiKey\\?"\s*:\s*\\?"([a-f0-9]{40})\\?"/)?.[1];
    if (found) {
      cachedKey = { value: found, fetchedAt: Date.now() };
      return found;
    }
  } catch {
    // Homepage blocked too — fall through to the seed key.
  }

  cachedKey = { value: FALLBACK_KEY, fetchedAt: Date.now() };
  return FALLBACK_KEY;
}

// ---- parsing ---------------------------------------------------------------

function parseProduct(product: any): ScrapedProduct | null {
  const retailerId = product?.tcin;
  const title = product?.item?.product_description?.title;
  if (!retailerId || !title) return null;

  const price = toCents(
    product?.price?.current_retail ?? product?.price?.current_retail_min,
  );
  const listPrice = toCents(product?.price?.reg_retail);

  return {
    retailer: "target",
    retailerId: String(retailerId),
    // Target titles carry HTML entities from their CMS.
    title: decodeEntities(String(title)),
    price,
    listPrice: listPrice && price && listPrice > price ? listPrice : null,
    currency: "USD",
    imageUrl: product?.item?.enrichment?.images?.primary_image_url ?? null,
    url: product?.item?.enrichment?.buy_url ?? targetProductUrl(String(retailerId)),
    availability: product?.item?.eligibility_rules ? "IN_STOCK" : null,
    rating: numberOrNull(product?.ratings_and_reviews?.statistics?.rating?.average),
    ratingCount: numberOrNull(product?.ratings_and_reviews?.statistics?.rating?.count),
    sellerRating: null,
    sellerRatingCount: null,
  };
}

/** Target urls look like /p/some-slug/-/A-94300569 */
function extractTcin(url: string): string | null {
  return url.match(/\/A-(\d+)/)?.[1] ?? url.match(/tcin=(\d+)/)?.[1] ?? null;
}

function decodeEntities(text: string) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function randomVisitorId() {
  // RedSky wants a 32-char uppercase hex visitor id; it does not need to be
  // stable across calls, only well-formed.
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += "0123456789ABCDEF"[Math.floor(Math.random() * 16)];
  }
  return out;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

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
