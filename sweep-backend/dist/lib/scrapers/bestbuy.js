// lib/scrapers/bestbuy.ts
//
// Best Buy runs the Next.js app router, so there is no __NEXT_DATA__ blob.
// What it does ship is an Apollo SSR cache, inlined as:
//
//   (window[Symbol.for("ApolloSSRDataTransport")] ??= []).push({ ...json })
//
// Those payloads hold the full GraphQL result — Product nodes with name,
// price, image, url and review info. We pull every blob, walk it for Product
// nodes, and keep the ones that carry a real price.
//
// Note: their public developer API (developer.bestbuy.com) remains a fallback
// if this breaks — see docs/INTEGRATIONS.md.
import { ScrapeHttpError, extractBalancedObject, fetchText, } from "./http.js";
import { fail, ok, toCents, } from "./types.js";
const BASE = "https://www.bestbuy.com";
const PUSH_MARKER = /ApolloSSRDataTransport"\)\]\s*\?\?=\s*\[\]\)\.push\(/g;
export async function searchBestBuy(keyword, limit = 4) {
    const started = Date.now();
    const url = `${BASE}/site/searchpage.jsp?st=${encodeURIComponent(keyword)}`;
    try {
        // Search pages are ~1.7MB, and Best Buy is the slowest of the three
        // self-scraped retailers, so it gets a longer budget than the default.
        const html = await fetchText(url, {
            timeoutMs: 30_000,
            headers: { referer: `${BASE}/` },
        });
        const products = collectProducts(html);
        if (products.length === 0) {
            return fail("failed", "no Product nodes with a price in the Apollo payload — page structure likely changed", elapsed(started));
        }
        return ok(products.slice(0, limit), elapsed(started));
    }
    catch (err) {
        return fail(kindOf(err), messageOf(err), elapsed(started));
    }
}
/**
 * Re-check one Best Buy product.
 *
 * This deliberately does NOT fetch the product page, because Best Buy does not
 * serve product pages to datacenter IPs. Measured from a clean state, after a
 * 4-minute cooldown, with no other traffic:
 *
 *   homepage                     200 in   0.5s
 *   /site/searchpage.jsp?st=...  200 in   2.0s
 *   /site/<slug>/<sku>.p         TIMEOUT at 25s   (every attempt)
 *   /product/<slug>/<bsin>       TIMEOUT at 25s   (every attempt)
 *
 * Searching the numeric SKU doesn't help either — Best Buy answers that with a
 * 308 straight to the product page, so it inherits the same hang.
 *
 * What does work is searching the product's name. Every Best Buy url carries a
 * slug of that name, so we recover the keyword from the url, search it, and
 * pick the result whose SKU (or BSIN) matches the url we were given. If no
 * confident match comes back we fail rather than guess — recording another
 * product's price would be far worse than recording nothing.
 */
export async function scrapeBestBuyProduct(url) {
    const started = Date.now();
    const target = parseProductUrl(url);
    if (!target.keyword) {
        return fail("failed", `couldn't recover a search term from ${url}`, elapsed(started));
    }
    const search = await searchBestBuy(target.keyword, 12);
    if (search.status !== "success") {
        return fail(search.status, search.detail, elapsed(started));
    }
    const match = search.data.find((product) => {
        if (target.sku && product.retailerId === target.sku)
            return true;
        if (target.bsin && product.url.includes(target.bsin))
            return true;
        return false;
    });
    if (!match) {
        // Falling back to the first result here would silently attach a different
        // product's price to this one.
        return fail("failed", `searched "${target.keyword}" and got ${search.data.length} results, none matching ` +
            `sku=${target.sku ?? "?"} bsin=${target.bsin ?? "?"} — the listing may have been removed`, elapsed(started));
    }
    return ok(match, elapsed(started));
}
/**
 * Best Buy urls come in two shapes, and between them they give us a keyword
 * plus an identifier to match on:
 *
 *   /site/apple-airpods-4-white/6447384.p?skuId=6447384
 *   /product/apple-airpods-4-white/JJGCQ83JQ5
 *   /product/apple-airpods-4-white/JJGCQ83JQ5/sku/6447384
 */
function parseProductUrl(url) {
    const sku = url.match(/(?:skuId=|\/sku\/)(\d{6,})/)?.[1] ?? url.match(/\/(\d{6,})\.p/)?.[1] ?? null;
    const bsin = url.match(/\/product\/[^/]+\/([A-Z0-9]{8,})/)?.[1] ?? null;
    const slug = url.match(/\/product\/([^/?#]+)/)?.[1] ?? url.match(/\/site\/([^/?#]+)/)?.[1] ?? null;
    // "apple-airpods-4-white" -> "apple airpods 4 white"
    const keyword = slug
        ? decodeURIComponent(slug).replace(/-/g, " ").trim().slice(0, 80) || null
        : null;
    return { keyword, sku, bsin };
}
export function bestBuyProductUrl(retailerId) {
    return `${BASE}/site/-/${retailerId}.p?skuId=${retailerId}`;
}
// ---- parsing ---------------------------------------------------------------
function collectProducts(html) {
    const byId = new Map();
    for (const blob of extractApolloBlobs(html)) {
        walk(blob, (node) => {
            const parsed = parseProductNode(node);
            // The same SKU appears many times across the payload — most copies are
            // partial fragments (open-box variants, price-less stubs). Keep the
            // richest one rather than whichever we hit first.
            if (parsed && !byId.has(parsed.retailerId)) {
                byId.set(parsed.retailerId, parsed);
            }
        });
    }
    return [...byId.values()];
}
function extractApolloBlobs(html) {
    const blobs = [];
    PUSH_MARKER.lastIndex = 0;
    for (const match of html.matchAll(PUSH_MARKER)) {
        const start = (match.index ?? 0) + match[0].length;
        const raw = extractBalancedObject(html, start);
        if (!raw)
            continue;
        try {
            blobs.push(JSON.parse(sanitize(raw)));
        }
        catch {
            // One unparseable blob shouldn't cost us the others.
        }
    }
    return blobs;
}
/**
 * The inlined payload is JS, not JSON, and Apollo writes bare `undefined` for
 * absent fields. Only rewrite it in value position so we can't corrupt a
 * string that happens to contain the word.
 */
function sanitize(raw) {
    return raw.replace(/([:,\[])\s*undefined(?=\s*[,}\]])/g, "$1null");
}
function parseProductNode(node) {
    if (node?.__typename !== "Product")
        return null;
    const retailerId = node?.skuId;
    const title = node?.name?.short ?? node?.name?.title;
    const price = toCents(node?.price?.customerPrice ?? node?.price?.displayableCustomerPrice);
    if (!retailerId || !title || price === null)
        return null;
    const listPrice = toCents(node?.price?.displayableRegularPrice ?? node?.price?.regularPrice);
    const relative = node?.url?.relativePdp ?? node?.url?.pdp;
    return {
        retailer: "bestbuy",
        retailerId: String(retailerId),
        title: String(title),
        price,
        listPrice: listPrice && listPrice > price ? listPrice : null,
        currency: "USD",
        imageUrl: node?.primaryImage?.href ?? node?.primaryImage?.piscesHref ?? null,
        url: absoluteUrl(relative) ?? bestBuyProductUrl(String(retailerId)),
        availability: node?.dotComDisplayStatus === "active" ? "IN_STOCK" : node?.dotComDisplayStatus ?? null,
        rating: numberOrNull(node?.reviewInfo?.averageRating),
        ratingCount: numberOrNull(node?.reviewInfo?.reviewCount),
        sellerRating: null,
        sellerRatingCount: null,
    };
}
function absoluteUrl(path) {
    if (typeof path !== "string" || !path)
        return null;
    return path.startsWith("http") ? path : `${BASE}${path}`;
}
/** Depth-first walk; the payload nests Product nodes several levels deep. */
function walk(value, visit) {
    if (!value || typeof value !== "object")
        return;
    if (Array.isArray(value)) {
        for (const item of value)
            walk(item, visit);
        return;
    }
    visit(value);
    for (const key of Object.keys(value)) {
        walk(value[key], visit);
    }
}
function numberOrNull(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function elapsed(started) {
    return Date.now() - started;
}
function kindOf(err) {
    return err instanceof ScrapeHttpError && err.kind === "blocked"
        ? "blocked"
        : "failed";
}
function messageOf(err) {
    return err instanceof Error ? err.message : String(err);
}
