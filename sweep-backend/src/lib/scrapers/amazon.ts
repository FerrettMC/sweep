// lib/scrapers/amazon.ts
//
// Amazon is the one retailer we pay for. Their anti-bot layer is purpose-built
// and actively maintained, so plain fetch is a dead end — this goes through
// Bright Data's Amazon Scraper API instead of trying to evade it in-house.
//
// Free tier is 5,000 records/month, which is a real ceiling: every call here
// spends quota. That's why the scheduler treats Amazon as `metered` and checks
// it less aggressively than the free scrapers.
//
// Bright Data answers either 200 with data, or 202 with a snapshot id we then
// poll — both paths are handled below.

import {
  type ScrapeResult,
  type ScrapedProduct,
  fail,
  ok,
  toCents,
} from "./types.js";

const API_BASE = "https://api.brightdata.com/datasets/v3";

function config() {
  return {
    apiKey: process.env.BRIGHTDATA_API_KEY,
    productDataset: process.env.BRIGHTDATA_AMAZON_DATASET_ID,
    searchDataset:
      process.env.BRIGHTDATA_AMAZON_SEARCH_DATASET_ID ??
      process.env.BRIGHTDATA_AMAZON_DATASET_ID,
  };
}

export function isAmazonConfigured() {
  const { apiKey, productDataset } = config();
  return Boolean(apiKey && productDataset);
}

// ---- 1. Single product lookup — scheduled re-checks of a tracked item ----
export async function scrapeAmazonProduct(
  url: string,
): Promise<ScrapeResult<ScrapedProduct>> {
  const started = Date.now();
  const { apiKey, productDataset } = config();

  if (!apiKey || !productDataset) {
    return fail("failed", NOT_CONFIGURED, elapsed(started));
  }

  try {
    const rows = await runJob(
      `${API_BASE}/scrape?dataset_id=${productDataset}&format=json`,
      { input: [{ url }] },
      apiKey,
    );

    const parsed = rows?.[0] ? parseAmazonProduct(rows[0], url) : null;
    if (!parsed) {
      return fail("failed", "Bright Data returned no rows for this url", elapsed(started));
    }
    return ok(parsed, elapsed(started));
  } catch (err) {
    return fail(kindOf(err), messageOf(err), elapsed(started));
  }
}

// ---- 2. Keyword search — the Amazon leg of compiled multi-site search ----
export async function searchAmazonProducts(
  keyword: string,
  limit = 4,
): Promise<ScrapeResult<ScrapedProduct[]>> {
  const started = Date.now();
  const { apiKey, searchDataset } = config();

  if (!apiKey || !searchDataset) {
    return fail("failed", NOT_CONFIGURED, elapsed(started));
  }

  try {
    const rows = await runJob(
      `${API_BASE}/scrape?dataset_id=${searchDataset}` +
        `&notify=false&include_errors=true&type=discover_new&discover_by=keyword`,
      { input: [{ keyword, zipcode: "" }], limit_per_input: limit },
      apiKey,
    );

    const products = (rows ?? [])
      .map((row) => parseAmazonProduct(row, row?.url ?? ""))
      .filter((p): p is ScrapedProduct => p !== null)
      .slice(0, limit);

    return ok(products, elapsed(started));
  } catch (err) {
    return fail(kindOf(err), messageOf(err), elapsed(started));
  }
}

// ---- shared: submit a job, following the sync-or-snapshot fork ----
async function runJob(
  url: string,
  body: unknown,
  apiKey: string,
): Promise<any[] | null> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    // Bright Data's /scrape holds the connection while it crawls and only
    // falls back to a snapshot id if that takes too long. Measured runs finish
    // in 19-23s normally but 70s when Amazon makes it retry, so a 60s ceiling
    // hung up on jobs that were about to succeed — the crawl completed and we
    // had already stopped listening. Amazon's slot on the server allows four
    // minutes; this should sit inside that, not below the normal worst case.
    signal: AbortSignal.timeout(180_000),
  });

  if (res.status === 200) {
    return parseRows(await res.text());
  }

  if (res.status === 202) {
    const { snapshot_id } = (await res.json()) as { snapshot_id: string };
    return pollSnapshot(snapshot_id, apiKey);
  }

  const errorBody = await res.text();
  // 401/403 here means our key or dataset is wrong, not that Amazon blocked
  // us — Bright Data absorbs Amazon's blocking on our behalf.
  throw new BrightDataError(
    `Bright Data returned ${res.status}: ${errorBody.slice(0, 400)}`,
    res.status === 429 ? "blocked" : "failed",
  );
}

// ---- shared: poll until the async job is ready, then fetch results ----
async function pollSnapshot(
  snapshotId: string,
  apiKey: string,
  maxAttempts = 40,
  delayMs = 5000,
): Promise<any[] | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, delayMs));

    const progressRes = await fetch(`${API_BASE}/progress/${snapshotId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });

    if (!progressRes.ok) {
      throw new BrightDataError(
        `progress check failed: ${progressRes.status}`,
        "failed",
      );
    }

    const progress = (await progressRes.json()) as { status: string };

    if (progress.status === "ready") {
      const dataRes = await fetch(
        `${API_BASE}/snapshot/${snapshotId}?format=json`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(60_000),
        },
      );
      return parseRows(await dataRes.text());
    }

    if (progress.status === "failed") {
      throw new BrightDataError(`job ${snapshotId} failed`, "failed");
    }

    // status === "running" — keep waiting
  }

  throw new BrightDataError(
    `job ${snapshotId} timed out after ${(maxAttempts * delayMs) / 1000}s`,
    "failed",
  );
}

/**
 * Bright Data does not always answer with a JSON array.
 *
 * Requests that pass `format=json` get one; the keyword-discovery endpoint
 * answers with NDJSON — one object per line — and feeding that to JSON.parse
 * dies at line 2 with "Unexpected non-whitespace character". Handle both,
 * plus a bare single object, so a format change can't silently blank Amazon.
 */
function parseRows(body: string): any[] {
  const trimmed = body.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    // A single object, or an error envelope.
    return [parsed];
  } catch {
    // Fall through to NDJSON.
  }

  const rows: any[] = [];
  for (const line of trimmed.split("\n")) {
    const candidate = line.trim();
    if (!candidate) continue;
    try {
      rows.push(JSON.parse(candidate));
    } catch {
      // One malformed line shouldn't discard the whole response.
    }
  }

  if (rows.length === 0) {
    throw new BrightDataError(
      `couldn't parse response as JSON or NDJSON: ${trimmed.slice(0, 200)}`,
      "failed",
    );
  }

  return rows;
}

// ---- shared: normalize raw Bright Data fields into our shape ----
function parseAmazonProduct(raw: any, fallbackUrl: string): ScrapedProduct | null {
  const retailerId = raw?.asin;
  const title = raw?.title;
  if (!retailerId || !title) return null;

  const price = toCents(raw?.final_price);
  const listPrice = toCents(raw?.initial_price);

  return {
    retailer: "amazon",
    retailerId: String(retailerId),
    title: String(title),
    price,
    listPrice: listPrice && price && listPrice > price ? listPrice : null,
    currency: raw?.currency ?? "USD",
    imageUrl: raw?.image_url ?? raw?.image ?? null,
    url: raw?.url ?? fallbackUrl,
    availability: raw?.availability ?? null,
    rating: numberOrNull(raw?.rating),
    ratingCount: numberOrNull(raw?.reviews_count),
    sellerRating: null,
    sellerRatingCount: null,
  };
}

class BrightDataError extends Error {
  constructor(
    message: string,
    readonly kind: "failed" | "blocked",
  ) {
    super(message);
    this.name = "BrightDataError";
  }
}

const NOT_CONFIGURED =
  "Amazon is not configured — set BRIGHTDATA_API_KEY and BRIGHTDATA_AMAZON_DATASET_ID (see docs/INTEGRATIONS.md)";

function numberOrNull(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function elapsed(started: number) {
  return Date.now() - started;
}

function kindOf(err: unknown): "failed" | "blocked" {
  return err instanceof BrightDataError ? err.kind : "failed";
}

function messageOf(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
