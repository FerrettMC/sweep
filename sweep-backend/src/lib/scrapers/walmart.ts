// lib/scrapers/walmart.ts
//
// Walmart is a Next.js pages-router site and ships the full product payload in
// __NEXT_DATA__, so a plain fetch is enough — no provider, no cost.
//
// Verified structures (search and PDP put the data in different places):
//   search: props.pageProps.initialData.searchResult.itemStacks[].items[]
//   PDP:    props.pageProps.initialData.data.product

import {
  ScrapeHttpError,
  extractNextData,
  fetchText,
} from "./http.js";
import {
  type ScrapeResult,
  type ScrapedProduct,
  fail,
  ok,
  toCents,
} from "./types.js";

const BASE = "https://www.walmart.com";

export async function searchWalmart(
  keyword: string,
  limit = 4,
): Promise<ScrapeResult<ScrapedProduct[]>> {
  const started = Date.now();
  const url = `${BASE}/search?q=${encodeURIComponent(keyword)}`;

  try {
    const html = await fetchText(url, { headers: { referer: `${BASE}/` } });
    const nextData = extractNextData(html);
    if (!nextData) {
      return fail("failed", "no __NEXT_DATA__ in search response", elapsed(started));
    }

    const stacks =
      nextData?.props?.pageProps?.initialData?.searchResult?.itemStacks;
    if (!Array.isArray(stacks)) {
      return fail(
        "failed",
        "searchResult.itemStacks missing — page structure likely changed",
        elapsed(started),
      );
    }

    // Walmart splits results across several stacks (organic, sponsored,
    // carousels); take the first one that actually holds items.
    const items: any[] =
      stacks.find((stack: any) => Array.isArray(stack?.items) && stack.items.length)
        ?.items ?? [];

    const products = items
      .map(parseSearchItem)
      .filter((p): p is ScrapedProduct => p !== null)
      .slice(0, limit);

    return ok(products, elapsed(started));
  } catch (err) {
    return fail(kindOf(err), messageOf(err), elapsed(started));
  }
}

export async function scrapeWalmartProduct(
  url: string,
): Promise<ScrapeResult<ScrapedProduct>> {
  const started = Date.now();

  try {
    const html = await fetchText(url, { headers: { referer: `${BASE}/` } });
    const nextData = extractNextData(html);
    if (!nextData) {
      return fail("failed", "no __NEXT_DATA__ in product response", elapsed(started));
    }

    const product = nextData?.props?.pageProps?.initialData?.data?.product;
    if (!product) {
      return fail(
        "failed",
        "initialData.data.product missing — page structure likely changed",
        elapsed(started),
      );
    }

    const parsed = parseProductPage(product, url);
    if (!parsed) {
      return fail("failed", "product payload had no usable id/title", elapsed(started));
    }

    return ok(parsed, elapsed(started));
  } catch (err) {
    return fail(kindOf(err), messageOf(err), elapsed(started));
  }
}

/** Build the canonical PDP url we can re-check later from an item id. */
export function walmartProductUrl(retailerId: string) {
  return `${BASE}/ip/${retailerId}`;
}

// ---- parsing ---------------------------------------------------------------

/**
 * Search items carry price in a display-oriented structure, and Walmart serves
 * TWO different shapes for it — the same query returns either one depending on
 * which variant you get. Both are handled here; getting this wrong silently
 * records the wrong number, which is worse than recording nothing.
 *
 *   Shape A: priceInfo.priceDetails.priceLines[] keyed by lineType
 *            (DISCOUNTED_PRICE = current, COMPARISON/WAS_PRICE = list)
 *   Shape B: flat strings, where the naming is actively misleading —
 *            linePrice = what you pay now, itemPrice = the was price.
 *
 * Do not trust `item.price`: it is 0 on every search result.
 * `itemPrice` is only a last resort, because in shape B it is the LIST price.
 */
function parseSearchItem(item: any): ScrapedProduct | null {
  const retailerId = item?.usItemId;
  const title = item?.name;
  if (!retailerId || !title) return null;

  const priceInfo = item?.priceInfo ?? {};
  const lines = priceInfo?.priceDetails?.priceLines;

  let price =
    toCents(priceLineValue(lines, "DISCOUNTED_PRICE", "PRICE")) ??
    toCents(priceLineValue(lines, "CURRENT_PRICE", "PRICE")) ??
    toCents(priceInfo?.currentPrice?.price) ??
    toCents(priceInfo?.linePrice) ??
    toCents(priceInfo?.itemPrice);

  let listPrice =
    toCents(priceLineValue(lines, "COMPARISON", "WAS_PRICE")) ??
    toCents(priceInfo?.wasPrice?.price) ??
    toCents(priceInfo?.wasPrice) ??
    toCents(priceInfo?.itemPrice);

  // Last line of defence against the two shapes being mixed up again: the
  // price you pay can never exceed the struck-through price. If it does, we
  // read the fields backwards, so swap rather than record a wrong price.
  if (price !== null && listPrice !== null && price > listPrice) {
    [price, listPrice] = [listPrice, price];
  }

  const canonical = item?.canonicalUrl;

  return {
    retailer: "walmart",
    retailerId: String(retailerId),
    title: String(title),
    price,
    // Walmart sometimes repeats the current price as the "was" price; a list
    // price that isn't actually higher is noise, not a discount.
    listPrice: listPrice && price && listPrice > price ? listPrice : null,
    currency: item?.priceInfo?.priceDetails?.currency ?? "USD",
    imageUrl: item?.imageInfo?.thumbnailUrl ?? null,
    url: canonical
      ? `${BASE}${stripQuery(canonical)}`
      : walmartProductUrl(String(retailerId)),
    availability: normalizeAvailability(
      item?.availabilityStatusV2?.value ?? item?.availabilityStatus,
    ),
    rating: numberOrNull(item?.averageRating),
    ratingCount: numberOrNull(item?.numberOfReviews),
    sellerRating: null,
    sellerRatingCount: null,
  };
}

/** The PDP uses a cleaner priceInfo shape than search does. */
function parseProductPage(product: any, fallbackUrl: string): ScrapedProduct | null {
  const retailerId = product?.usItemId;
  const title = product?.name;
  if (!retailerId || !title) return null;

  const priceInfo = product?.priceInfo ?? {};
  const price = toCents(priceInfo?.currentPrice?.price);
  const listPrice =
    toCents(priceInfo?.wasPrice?.price) ?? toCents(priceInfo?.listPrice?.price);

  return {
    retailer: "walmart",
    retailerId: String(retailerId),
    title: String(title),
    price,
    listPrice: listPrice && price && listPrice > price ? listPrice : null,
    currency: priceInfo?.currentPrice?.currencyUnit ?? "USD",
    imageUrl: product?.imageInfo?.thumbnailUrl ?? null,
    url: product?.canonicalUrl
      ? `${BASE}${stripQuery(product.canonicalUrl)}`
      : fallbackUrl,
    availability: normalizeAvailability(product?.availabilityStatus),
    rating: numberOrNull(product?.averageRating),
    ratingCount: numberOrNull(product?.numberOfReviews),
    sellerRating: null,
    sellerRatingCount: null,
  };
}

function priceLineValue(lines: any, lineType: string, key: string) {
  if (!Array.isArray(lines)) return null;
  const line = lines.find((l: any) => l?.lineType === lineType);
  const entry = line?.values?.find((v: any) => v?.key === key);
  return entry?.value ?? null;
}

/** Canonical urls arrive with tracking params; the bare path is stable. */
function stripQuery(path: string) {
  return path.split("?")[0];
}

function normalizeAvailability(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  return raw.toUpperCase().replace(/[\s-]+/g, "_");
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
