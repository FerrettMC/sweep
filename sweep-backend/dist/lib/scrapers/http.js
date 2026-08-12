// lib/scrapers/http.ts
//
// Shared fetch layer for the self-written scrapers. Retailers time out and
// rate-limit unpredictably (Best Buy served a 1.7MB search page fine, then
// timed out on the next product request), so every scraper goes through the
// same timeout + backoff + block-detection path rather than each reinventing it.
const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
];
export const DEFAULT_TIMEOUT_MS = 20_000;
export class ScrapeHttpError extends Error {
    kind;
    status;
    constructor(message, kind, status) {
        super(message);
        this.kind = kind;
        this.status = status;
        this.name = "ScrapeHttpError";
    }
}
/** Status codes that mean "the anti-bot layer said no", not "the page broke". */
function isBlockingStatus(status) {
    return status === 403 || status === 429 || status === 503;
}
/**
 * Body-level block detection. A retailer can return 200 and still be serving a
 * challenge page, so status alone isn't enough.
 */
function looksBlocked(body) {
    if (body.length > 100_000)
        return false; // a full page of real content
    return /captchaRelativeURL|Robot or human|Are you a robot|Access Denied|Request unsuccessful|px-captcha|Pardon Our Interruption/i.test(body);
}
/**
 * Fetch a URL as text, retrying transient failures with exponential backoff.
 * Throws ScrapeHttpError so callers can distinguish blocked from failed.
 */
export async function fetchText(url, options = {}) {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, retries = 2, headers = {}, accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", } = options;
    let lastError = new ScrapeHttpError("no attempt made", "failed");
    for (let attempt = 0; attempt <= retries; attempt++) {
        if (attempt > 0) {
            // 600ms, 1800ms — enough to ride out a brief rate limit without making
            // the caller's request hang for the full budget.
            await sleep(600 * 3 ** (attempt - 1));
        }
        try {
            const res = await fetch(url, {
                headers: {
                    "user-agent": USER_AGENTS[attempt % USER_AGENTS.length],
                    accept,
                    "accept-language": "en-US,en;q=0.9",
                    "accept-encoding": "gzip, deflate, br",
                    "cache-control": "no-cache",
                    ...headers,
                },
                signal: AbortSignal.timeout(timeoutMs),
                redirect: "follow",
            });
            const body = await res.text();
            if (isBlockingStatus(res.status) || looksBlocked(body)) {
                // Blocking is not transient — retrying the same request from the same
                // IP just burns time, so fail fast and let the caller record it.
                throw new ScrapeHttpError(`blocked (status ${res.status}): ${body.slice(0, 300)}`, "blocked", res.status);
            }
            if (!res.ok) {
                throw new ScrapeHttpError(`HTTP ${res.status}: ${body.slice(0, 300)}`, "failed", res.status);
            }
            return body;
        }
        catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            if (lastError instanceof ScrapeHttpError && lastError.kind === "blocked") {
                throw lastError;
            }
        }
    }
    throw lastError;
}
export async function fetchJson(url, options = {}) {
    const body = await fetchText(url, {
        ...options,
        accept: options.accept ?? "application/json",
    });
    try {
        return JSON.parse(body);
    }
    catch {
        throw new ScrapeHttpError(`response was not JSON: ${body.slice(0, 300)}`, "failed");
    }
}
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Pull the `__NEXT_DATA__` blob out of a Next.js pages-router HTML document.
 * Walmart and Target both ship one; only Walmart puts product data in it.
 */
export function extractNextData(html) {
    const match = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match)
        return null;
    try {
        return JSON.parse(match[1]);
    }
    catch {
        return null;
    }
}
/**
 * Scan forward from `start` and return the balanced `{...}` substring.
 * Needed for payloads embedded in JS rather than in a script tag we can slice
 * on a closing tag (Best Buy's Apollo transport).
 */
export function extractBalancedObject(source, start) {
    if (source[start] !== "{")
        return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < source.length; i++) {
        const char = source[i];
        if (inString) {
            if (escaped)
                escaped = false;
            else if (char === "\\")
                escaped = true;
            else if (char === '"')
                inString = false;
            continue;
        }
        if (char === '"')
            inString = true;
        else if (char === "{")
            depth++;
        else if (char === "}") {
            depth--;
            if (depth === 0)
                return source.slice(start, i + 1);
        }
    }
    return null;
}
