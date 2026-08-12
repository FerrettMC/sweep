// lib/scrapers/url.ts
//
// Turning whatever a human pasted into a URL we can actually scrape.
//
// People do not paste clean canonical URLs. They paste what the share sheet
// gave them (`https://a.co/d/4kZ9x`), what they copied off an address bar with
// no scheme (`www.walmart.com/ip/123`), or a canonical link with forty
// characters of tracking junk on the end. All three have to work.

import { detectRetailer } from "./index.js";
import type { Retailer } from "./types.js";

/**
 * Hosts that are pure redirectors. These carry no retailer information in the
 * hostname, so they must be resolved before we can tell who the link is for.
 */
const SHORTENERS = new Set([
  "a.co",
  "amzn.to",
  "amzn.eu",
  "ebay.us",
  "ebay.to",
  "goto.walmart.com",
  "bestbuy.7tiv.net", // Best Buy's affiliate redirector
]);

/**
 * Query params that are tracking noise. Stripping them matters beyond
 * tidiness: the shared Product cache is keyed partly on url, so two users
 * pasting the same item with different tracking params must not create two
 * rows and two scrape schedules.
 */
const TRACKING_PARAMS = [
  /^utm_/i,
  /^pd_rd_/i,
  /^pf_rd_/i,
  /^_encoding$/i,
  /^psc$/i,
  /^ref_?$/i,
  /^tag$/i,
  /^linkCode$/i,
  /^th$/i,
  /^athbdg$/i,
  /^classType$/i,
  /^sourceid$/i,
  /^irgwc$/i,
  /^sharedid$/i,
  /^clickid$/i,
  /^gclid$/i,
  /^fbclid$/i,
];

export interface NormalizedUrl {
  url: string;
  retailer: Retailer;
}

export type NormalizeResult =
  | { ok: true; value: NormalizedUrl }
  | { ok: false; reason: "malformed" | "unsupported"; detail: string };

/**
 * Normalize a pasted link and work out which retailer it belongs to.
 * Network access is only used when the link is a shortener that must be
 * resolved — everything else is pure string work.
 */
export async function normalizeProductUrl(raw: string): Promise<NormalizeResult> {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, reason: "malformed", detail: "empty link" };
  }

  let parsed = parse(trimmed);
  if (!parsed) {
    return { ok: false, reason: "malformed", detail: `couldn't read "${trimmed}" as a link` };
  }

  // Resolve share/short links to whatever they actually point at.
  if (SHORTENERS.has(parsed.hostname.toLowerCase())) {
    const resolved = await resolveRedirect(parsed.toString());
    if (!resolved) {
      return {
        ok: false,
        reason: "malformed",
        detail: "that short link didn't resolve to anything",
      };
    }
    const reparsed = parse(resolved);
    if (!reparsed) {
      return { ok: false, reason: "malformed", detail: "short link resolved to a bad url" };
    }
    parsed = reparsed;
  }

  const cleaned = stripTracking(parsed);
  const retailer = detectRetailer(cleaned);

  if (!retailer) {
    return {
      ok: false,
      reason: "unsupported",
      detail: parsed.hostname,
    };
  }

  return { ok: true, value: { url: cleaned, retailer } };
}

/** Parse, tolerating a missing scheme — which is how most pasted links arrive. */
function parse(input: string): URL | null {
  const candidate = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url;
  } catch {
    return null;
  }
}

function stripTracking(url: URL): string {
  const keep = new URLSearchParams();

  for (const [key, value] of url.searchParams) {
    if (TRACKING_PARAMS.some((pattern) => pattern.test(key))) continue;
    keep.append(key, value);
  }

  url.search = keep.toString();
  url.hash = "";
  return url.toString();
}

/**
 * Follow a shortener to its destination.
 *
 * Uses GET rather than HEAD because several of these redirectors answer HEAD
 * with a 405. We only need the final URL, not the body.
 */
async function resolveRedirect(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(15_000),
    });
    // res.url is the URL after all redirects. A blocked response still tells
    // us where we landed, which is all we need here.
    return res.url || null;
  } catch {
    return null;
  }
}
