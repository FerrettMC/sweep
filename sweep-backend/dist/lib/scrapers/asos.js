// lib/scrapers/asos.ts
//
// ASOS — clothing. Free, no key.
//
// Search results are inlined in the page as a plain JSON island:
//
//   "search":{"searchTerm":"t-shirt","products":[{ id, price, description, image, url }]}
//
// Their public catalogue API (/api/product/catalogue/v3/products/:id) answers
// 503 from here, so product refreshes go through the product page instead,
// which does serve prices.
//
// Note ASOS image urls come back without a scheme or extension —
// "images.asos-media.com/products/…/209900638-1-black" — so they need both
// added before anything can render them.
import { ScrapeHttpError, extractBalancedObject, fetchText } from "./http.js";
import { fail, ok, toCents, } from "./types.js";
const BASE = "https://www.asos.com";
export async function searchAsos(keyword, limit = 4) {
    const started = Date.now();
    const url = `${BASE}/us/search/?q=${encodeURIComponent(keyword)}`;
    try {
        const html = await fetchText(url, {
            timeoutMs: 25_000,
            headers: { referer: `${BASE}/us/` },
        });
        const products = parseSearchProducts(html).slice(0, limit);
        if (products.length > 0)
            return ok(products, elapsed(started));
        // No island at all is ASOS's genuine "nothing matched" page — searching it
        // for "airpods" is a real zero-result search, not a broken scraper. Only
        // treat it as a failure if the page is too small to be a real response,
        // which is what a block or an error page looks like.
        //
        // Getting this wrong matters: a mislabelled failure would drag the health
        // board down every time someone searched a category ASOS doesn't stock.
        if (html.length > 50_000)
            return ok([], elapsed(started));
        return fail("failed", `unexpectedly small response (${html.length}b) with no results`, elapsed(started));
    }
    catch (err) {
        return fail(kindOf(err), messageOf(err), elapsed(started));
    }
}
export async function scrapeAsosProduct(url) {
    const started = Date.now();
    const productId = extractProductId(url);
    if (!productId) {
        return fail("failed", `couldn't read a product id out of ${url}`, elapsed(started));
    }
    try {
        const html = await fetchText(url, {
            timeoutMs: 25_000,
            headers: { referer: `${BASE}/us/` },
        });
        const price = toCents(html.match(/"price"\s*:\s*\{\s*"current"\s*:\s*\{\s*"value"\s*:\s*([0-9.]+)/)?.[1]);
        if (price === null) {
            return fail("failed", "no current price on the product page", elapsed(started));
        }
        const previous = toCents(html.match(/"previous"\s*:\s*\{\s*"value"\s*:\s*([0-9.]+)/)?.[1]);
        const title = decodeEntities(html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ??
            html.match(/<title>([^<]+)<\/title>/)?.[1] ??
            "").replace(/\s*\|\s*ASOS\s*$/i, "");
        if (!title) {
            return fail("failed", "no title on the product page", elapsed(started));
        }
        const image = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] ?? null;
        return ok({
            retailer: "asos",
            retailerId: productId,
            title,
            price,
            listPrice: previous && previous > price ? previous : null,
            currency: "USD",
            imageUrl: image ? normalizeImage(image) : null,
            url,
            availability: /"isInStock"\s*:\s*true/.test(html) ? "IN_STOCK" : null,
            // ASOS doesn't publish star ratings on the listing.
            rating: null,
            ratingCount: null,
            sellerRating: null,
            sellerRatingCount: null,
        }, elapsed(started));
    }
    catch (err) {
        return fail(kindOf(err), messageOf(err), elapsed(started));
    }
}
export function asosProductUrl(retailerId) {
    return `${BASE}/us/prd/${retailerId}`;
}
// ---- parsing ---------------------------------------------------------------
/**
 * Pull the products out of the inlined search island.
 *
 * Each product object is parsed on its own rather than parsing the island as a
 * whole. The island is embedded in a JS context and contains escapes that are
 * legal there but not in JSON ("Bad escaped character in JSON"), so a single
 * JSON.parse over the whole thing fails and silently returns nothing — which
 * is how ASOS came back empty for "t-shirt" while working for other queries.
 */
function parseSearchProducts(html) {
    const marker = html.search(/"search"\s*:\s*\{\s*"searchTerm"/);
    if (marker === -1)
        return [];
    const arrayStart = html.indexOf('"products":[', marker);
    if (arrayStart === -1)
        return [];
    const products = [];
    let cursor = html.indexOf("[", arrayStart) + 1;
    // Walk sibling objects until the array closes. Bounded by a sane item count
    // so a malformed page can't spin.
    for (let i = 0; i < 200; i++) {
        while (cursor < html.length && /[\s,]/.test(html[cursor]))
            cursor++;
        if (html[cursor] !== "{")
            break;
        const raw = extractBalancedObject(html, cursor);
        if (!raw)
            break;
        cursor += raw.length;
        try {
            const parsed = parseSearchItem(JSON.parse(raw));
            if (parsed)
                products.push(parsed);
        }
        catch {
            // One product with an unparseable escape shouldn't cost us the rest.
        }
    }
    return products;
}
function parseSearchItem(item) {
    const retailerId = item?.id;
    const title = item?.description ?? item?.name;
    const price = toCents(item?.price);
    if (!retailerId || !title || price === null)
        return null;
    const listPrice = toCents(item?.previousPrice ?? item?.rrp);
    return {
        retailer: "asos",
        retailerId: String(retailerId),
        title: String(title),
        price,
        listPrice: listPrice && listPrice > price ? listPrice : null,
        currency: "USD",
        imageUrl: normalizeImage(item?.image),
        url: item?.url ? `${BASE}/us/${String(item.url).replace(/^\/+/, "")}` : asosProductUrl(String(retailerId)),
        availability: item?.isSellingFast === undefined ? "IN_STOCK" : "IN_STOCK",
        rating: null,
        ratingCount: null,
        sellerRating: null,
        sellerRatingCount: null,
    };
}
/**
 * Search returns bare image paths with no scheme and no extension
 * ("images.asos-media.com/products/…/209900638-1-black"); product pages return
 * full urls. Handle both.
 *
 * The `$n_480w$` preset is what ASOS's own site requests. Asking for it gets a
 * predictable, thumbnail-sized render instead of whatever the master happens to
 * be, which is both faster and less likely to trip up an image loader.
 */
function normalizeImage(value) {
    if (typeof value !== "string" || !value)
        return null;
    const withScheme = value.startsWith("http")
        ? value
        : `https://${value.replace(/^\/+/, "")}`;
    // Already carries render params — leave it alone.
    if (withScheme.includes("?"))
        return withScheme;
    return `${withScheme.replace(/\.(jpg|jpeg|png|webp)$/i, "")}?$n_480w$`;
}
/** ASOS urls end in /prd/209900638, sometimes with a #colourWayId fragment. */
function extractProductId(url) {
    return url.match(/\/prd\/(\d+)/)?.[1] ?? null;
}
function decodeEntities(text) {
    return text
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .trim();
}
function elapsed(started) {
    return Date.now() - started;
}
function kindOf(err) {
    return err instanceof ScrapeHttpError && err.kind === "blocked" ? "blocked" : "failed";
}
function messageOf(err) {
    return err instanceof Error ? err.message : String(err);
}
