// lib/probe.ts
//
// "Can the production server actually reach this page?"
//
// Exists because that question has been unanswerable, and answering it wrongly
// has cost three separate investigations. Walmart, Newegg and ASOS all worked
// perfectly from a home connection and all failed once deployed, because the
// thing that decides it is which IP the request comes from — and there was no
// way to make a request from Railway's.
//
// So: give it a url, it fetches from wherever the server is, and reports what
// came back. Not the page — the shape of the page. Status, size, timing,
// whether it looks like a challenge, and which payload markers a parser would
// be looking for.
//
// SAFETY. This makes the server fetch a url somebody typed, from inside the
// production network, which is the definition of SSRF. The admin key is not
// enough on its own: a key can leak, and the blast radius here includes the
// cloud metadata endpoint, which hands out credentials to anything that asks.
// So the destination is resolved and checked against private space BEFORE the
// request, redirects are followed manually with the same check each hop, and
// the body is capped rather than buffered whole.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const TIMEOUT_MS = 25_000;
/** Enough to see the shape of a page; far short of what a hostile url could send. */
const MAX_BYTES = 3_000_000;
const MAX_REDIRECTS = 4;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** What a parser would be hunting for, and which store put it there. */
const MARKERS: { name: string; needle: string; store: string }[] = [
  { name: "__NEXT_DATA__", needle: "__NEXT_DATA__", store: "Walmart and other Next.js sites" },
  { name: "JSON-LD Product", needle: '"@type":"Product"', store: "Zappos, many others" },
  { name: "JSON-LD Product (spaced)", needle: '"@type": "Product"', store: "same, formatted" },
  { name: "Apollo SSR", needle: "ApolloSSRDataTransport", store: "Best Buy" },
  { name: "ItemCell", needle: '"ItemCell"', store: "Newegg" },
  { name: "searchTerm", needle: '"searchTerm"', store: "ASOS" },
  { name: "preloaded state", needle: "__PRELOADED_STATE__", store: "various" },
];

/** Phrases that mean a bot wall rather than a page. */
const CHALLENGES = [
  "pardon our interruption",
  "access to this page has been denied",
  "verify you are a human",
  "px-captcha",
  "/_incapsula_",
  "unusual traffic",
  "are you a robot",
  "checking your browser",
];

export interface ProbeResult {
  url: string;
  finalUrl: string;
  status: number | null;
  ms: number;
  bytes: number;
  truncated: boolean;
  /** Marker names found in the body. */
  markers: string[];
  /** Challenge phrases found, if any. */
  challenges: string[];
  /** Rough count of price-shaped values — a quick "is there product data here". */
  priceish: number;
  redirects: string[];
  /** Set instead of the rest when the fetch never completed. */
  error: string | null;
  /** Set when the url was refused before any request was made. */
  refused: string | null;
  /**
   * True when the request ended somewhere meaningfully different from where it
   * was pointed — in practice, bounced to the site root.
   *
   * This is a soft block and it is the easy one to misread. There is no
   * challenge page and no error status: the store simply serves its homepage
   * instead of the page you asked for. Everything a parser looks for is
   * present, because a homepage is still a page, so without this the result
   * reads as a clean success. Walmart does exactly this to datacenter IPs.
   */
  bounced: boolean;
}

/**
 * Is this address one we must never ask the server to fetch?
 *
 * Loopback, private ranges, link-local — and 169.254.169.254 in particular,
 * which is the cloud metadata service and will hand out credentials to any
 * process that can reach it.
 */
function isForbiddenAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v6 = ip.toLowerCase();
    if (v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80")) {
      return true;
    }
    // IPv4-mapped, e.g. ::ffff:127.0.0.1 — check the embedded address.
    const mapped = v6.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isForbiddenAddress(mapped[1]);
    return false;
  }

  const [a, b] = ip.split(".").map(Number);
  if (a === 127 || a === 0 || a === 10) return true;
  if (a === 169 && b === 254) return true;          // link-local, incl. metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true;          // private
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  return false;
}

/** Null when the url may be fetched; otherwise the reason it may not. */
async function refuse(raw: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "That is not a url.";
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `Only http and https. Refused ${parsed.protocol}`;
  }

  let addresses;
  try {
    addresses = await lookup(parsed.hostname, { all: true });
  } catch {
    return `Could not resolve ${parsed.hostname}`;
  }

  // Every address it resolves to, not just the first. A name that returns one
  // public and one private address would otherwise sail through.
  for (const { address } of addresses) {
    if (isForbiddenAddress(address)) {
      return `${parsed.hostname} resolves to ${address}, which is inside the private network`;
    }
  }

  return null;
}

export async function probe(rawUrl: string): Promise<ProbeResult> {
  const started = Date.now();
  const base: ProbeResult = {
    url: rawUrl,
    finalUrl: rawUrl,
    status: null,
    ms: 0,
    bytes: 0,
    truncated: false,
    markers: [],
    challenges: [],
    priceish: 0,
    redirects: [],
    error: null,
    refused: null,
    bounced: false,
  };

  let current = rawUrl;
  const redirects: string[] = [];

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // Re-checked on every hop. A public url that redirects to 169.254.169.254
    // is exactly how this gets abused, and checking only the first would miss it.
    const why = await refuse(current);
    if (why) return { ...base, refused: why, redirects, ms: Date.now() - started };

    let res: Response;
    try {
      res = await fetch(current, {
        redirect: "manual",
        headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      return {
        ...base,
        finalUrl: current,
        redirects,
        ms: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).toString();
      redirects.push(current);
      continue;
    }

    // Read with a cap rather than res.text(), so a hostile or simply enormous
    // response cannot exhaust the server's memory.
    const reader = res.body?.getReader();
    let bytes = 0;
    let truncated = false;
    const chunks: Uint8Array[] = [];
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          bytes += value.byteLength;
          if (bytes > MAX_BYTES) {
            truncated = true;
            await reader.cancel();
            break;
          }
          chunks.push(value);
        }
      }
    }

    const body = Buffer.concat(chunks).toString("utf8");
    const low = body.toLowerCase();

    return {
      url: rawUrl,
      finalUrl: current,
      status: res.status,
      ms: Date.now() - started,
      bytes,
      truncated,
      markers: MARKERS.filter((m) => body.includes(m.needle)).map((m) => m.name),
      challenges: CHALLENGES.filter((c) => low.includes(c)),
      priceish: (body.match(/"(?:price|currentPrice|salePrice)"\s*:\s*"?\d+\.\d{2}/g) ?? []).length,
      redirects,
      error: null,
      refused: null,
      bounced: bouncedToRoot(rawUrl, current),
    };
  }

  return {
    ...base,
    finalUrl: current,
    redirects,
    ms: Date.now() - started,
    error: `More than ${MAX_REDIRECTS} redirects`,
  };
}

/**
 * Did we ask for a page and land on the front door?
 *
 * Only counts when the request actually had a path to lose — asking for the
 * homepage and receiving the homepage is not a bounce, and a redirect that
 * merely adds a locale or a trailing slash is not one either.
 */
function bouncedToRoot(from: string, to: string): boolean {
  try {
    const wanted = new URL(from);
    const landed = new URL(to);
    const wantedPath = wanted.pathname.replace(/\/+$/, "");
    const landedPath = landed.pathname.replace(/\/+$/, "");
    if (!wantedPath) return false;
    // The query is irrelevant. Being sent to /?from=blocked is landing on the
    // homepage just as much as being sent to / is, and an earlier version
    // treated the parameter as evidence it was a real destination.
    return landedPath === "";
  } catch {
    return false;
  }
}

/** Exported for the tests, which check the refusals rather than the network. */
export const _internal = { isForbiddenAddress, refuse, bouncedToRoot, MARKERS };
