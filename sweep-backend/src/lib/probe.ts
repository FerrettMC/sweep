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

// ---- running a real adapter from here ---------------------------------------
//
// Fetching a url proves the PAGE is reachable. It does not prove the adapter
// works, and the two have already been confused once: a probe found Best Buy
// returning 200 with the right markers, which is not the same as the parser
// finding products in it. A site can serve a degraded page to a suspicious
// client — right shape, no contents — and every signal a url probe looks at
// would still be green.
//
// So this runs the actual adapter, through the actual rate gate, from wherever
// the server is. It is the only measurement that answers "will this work in the
// app", which is the question that matters.

import { adapters } from "./scrapers/index.js";
import { RETAILERS, type Retailer } from "./scrapers/types.js";

export interface AdapterProbeResult {
  retailer: string;
  keyword: string;
  status: string;
  ms: number;
  count: number;
  /** A few results, so "success with nothing in it" is visible rather than implied. */
  sample: { title: string; price: number | null; url: string }[];
  detail: string | null;
  /** True when this retailer costs money per call. */
  metered: boolean;
  error: string | null;
}

export async function probeAdapter(
  retailer: string,
  keyword: string,
  limit = 3,
): Promise<AdapterProbeResult> {
  const base: AdapterProbeResult = {
    retailer,
    keyword,
    status: "failed",
    ms: 0,
    count: 0,
    sample: [],
    detail: null,
    metered: false,
    error: null,
  };

  if (!RETAILERS.includes(retailer as Retailer)) {
    return { ...base, error: `Unknown retailer. Try one of: ${RETAILERS.join(", ")}` };
  }

  // Deliberately the gated adapter, and deliberately NOT checking
  // DISABLED_RETAILERS: the entire point is to test a store before switching it
  // on, and the rate gate is part of what is being tested.
  const adapter = adapters[retailer as Retailer];
  const started = Date.now();

  try {
    const result = await adapter.search(keyword, limit);
    const ok = result.status === "success";
    return {
      ...base,
      metered: adapter.metered,
      status: result.status,
      ms: Date.now() - started,
      count: ok ? result.data.length : 0,
      sample: ok
        ? result.data.slice(0, 3).map((p) => ({ title: p.title, price: p.price, url: p.url }))
        : [],
      detail: ok ? null : (result.detail ?? null)?.slice(0, 300) ?? null,
    };
  } catch (err) {
    return {
      ...base,
      metered: adapter.metered,
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---- stress ------------------------------------------------------------------
//
// One run tells you almost nothing about a retailer that fails intermittently.
// Best Buy read 33% over three attempts and 75% over eight, and neither number
// was worth a decision. This runs the adapter repeatedly from the server and
// reports the spread.
//
// TWO THINGS MAKE OR BREAK THIS.
//
// It must bypass the keyword cache. Searching the same term twice serves the
// second from cache without touching the retailer, so a naive loop would report
// a flawless 100% having made exactly one real request.
//
// And it must go through the rate gate, not around it. The gate's pacing is
// part of what is being tested — a store that only fails under the concurrency
// the app actually uses is a store that fails in production.

/** Enough to see a pattern; short enough that the request completes. */
const MAX_RUNS = 15;

export interface StressResult {
  retailer: string;
  runs: number;
  ok: number;
  failed: number;
  blocked: number;
  successRate: number;
  /** Milliseconds, of the successful runs only — a timeout is not a speed. */
  fastestMs: number | null;
  medianMs: number | null;
  slowestMs: number | null;
  /** Failure reasons and how often each occurred. */
  reasons: { reason: string; count: number }[];
  /** Every run in order, so a cluster of failures is visible as a cluster. */
  sequence: { n: number; status: string; ms: number }[];
  metered: boolean;
  error: string | null;
}

/**
 * Distinct keywords, so the cache cannot serve a repeat even if `fresh` were
 * ever to stop working. Belt and braces: the whole measurement is worthless if
 * a single request gets counted fifteen times.
 */
const TERMS = [
  "wireless headphones", "laptop", "coffee maker", "4k tv", "office chair",
  "bluetooth speaker", "air fryer", "monitor", "keyboard", "smart watch",
  "vacuum cleaner", "printer", "microwave", "webcam", "router",
];

export async function stress(
  retailer: string,
  runs: number,
  spendMoney = false,
): Promise<StressResult> {
  const base: StressResult = {
    retailer, runs: 0, ok: 0, failed: 0, blocked: 0, successRate: 0,
    fastestMs: null, medianMs: null, slowestMs: null,
    reasons: [], sequence: [], metered: false, error: null,
  };

  if (!RETAILERS.includes(retailer as Retailer)) {
    return { ...base, error: `Unknown retailer. Try one of: ${RETAILERS.join(", ")}` };
  }

  const adapter = adapters[retailer as Retailer];

  // Fifteen Amazon searches is fifteen Bright Data records, and fifteen Walmart
  // searches is fifteen billed Decodo requests. Neither should happen because
  // someone picked the wrong entry in a dropdown.
  if (adapter.metered && !spendMoney) {
    return {
      ...base,
      metered: true,
      error: `${retailer} bills per request. Confirm before stress testing it.`,
    };
  }

  const count = Math.max(1, Math.min(MAX_RUNS, Math.floor(runs) || 5));
  const sequence: StressResult["sequence"] = [];
  const okMs: number[] = [];
  const reasons = new Map<string, number>();

  for (let n = 0; n < count; n++) {
    const started = Date.now();
    let status = "failed";
    let reason = "";

    try {
      const result = await adapter.search(TERMS[n % TERMS.length], 3, { fresh: true });
      status = result.status;
      if (result.status === "success") okMs.push(Date.now() - started);
      else reason = (result.detail ?? result.status).slice(0, 120);
    } catch (err) {
      status = "threw";
      reason = err instanceof Error ? err.message.slice(0, 120) : String(err);
    }

    if (reason) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    sequence.push({ n: n + 1, status, ms: Date.now() - started });
  }

  const ok = sequence.filter((r) => r.status === "success").length;
  const blocked = sequence.filter((r) => r.status === "blocked").length;
  const sorted = [...okMs].sort((a, b) => a - b);

  return {
    retailer,
    runs: count,
    ok,
    failed: count - ok - blocked,
    blocked,
    successRate: Math.round((ok / count) * 100),
    fastestMs: sorted[0] ?? null,
    medianMs: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
    slowestMs: sorted[sorted.length - 1] ?? null,
    reasons: [...reasons.entries()]
      .map(([reason, c]) => ({ reason, count: c }))
      .sort((a, b) => b.count - a.count),
    sequence,
    metered: adapter.metered,
    error: null,
  };
}
