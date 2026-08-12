// lib/scrapers/newegg.ts
//
// Newegg — electronics and computer parts. Free, no key, no provider.
//
// Search results come back inside a large inline JSON blob whose shape is
// PascalCase (it mirrors their internal .NET models):
//
//   "Products":[{ "ItemCell":{ "Item":"...", "UnitCost":249.99, "FinalPrice":199.99, ... } }]
//
// UnitCost is the list price and FinalPrice is what you pay — the opposite way
// round from what the names suggest, so read them carefully.
import { ScrapeHttpError, extractBalancedObject, fetchText } from "./http.js";
import { fail, ok, toCents, } from "./types.js";
const BASE = "https://www.newegg.com";
export async function searchNewegg(keyword, limit = 4) {
    const started = Date.now();
    const url = `${BASE}/p/pl?d=${encodeURIComponent(keyword)}`;
    try {
        const html = await fetchText(url, {
            timeoutMs: 25_000,
            headers: { referer: `${BASE}/` },
        });
        const products = collectProducts(html).slice(0, limit);
        if (products.length === 0) {
            return fail("failed", "no priced items found in the Products payload — page structure likely changed", elapsed(started));
        }
        return ok(products, elapsed(started));
    }
    catch (err) {
        return fail(kindOf(err), messageOf(err), elapsed(started));
    }
}
export async function scrapeNeweggProduct(url) {
    const started = Date.now();
    const itemId = extractItemNumber(url);
    if (!itemId) {
        return fail("failed", `couldn't read an item number out of ${url}`, elapsed(started));
    }
    try {
        const html = await fetchText(url, {
            timeoutMs: 25_000,
            headers: { referer: `${BASE}/` },
        });
        // Product pages do NOT wrap the item being viewed in an "ItemCell" — that
        // key only appears for the recommendation carousel, so parsing the page the
        // same way search is parsed silently returns a *different* product's price.
        // The viewed item is a bare object keyed by its own id instead.
        const prices = extractPricesForItem(html, itemId);
        if (!prices) {
            return fail("failed", `page didn't contain pricing for item ${itemId} — the listing may have been removed`, elapsed(started));
        }
        const title = decodeEntities(html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ?? "").replace(/\s*-\s*Newegg\.com\s*$/i, "");
        if (!title) {
            return fail("failed", "no title on the product page", elapsed(started));
        }
        return ok({
            retailer: "newegg",
            retailerId: itemId,
            title,
            price: prices.price,
            listPrice: prices.listPrice && prices.listPrice > prices.price ? prices.listPrice : null,
            currency: "USD",
            imageUrl: html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] ?? null,
            url,
            availability: /"Instock"\s*:\s*true/.test(html) ? "IN_STOCK" : null,
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
/**
 * Pull FinalPrice/UnitCost out of the object that carries `"Item":"<id>"`.
 *
 * Scoped to a bounded window after the id so a nearby recommendation's price
 * can't be picked up by accident — attaching another product's price to a
 * tracked item is the single worst failure mode this scraper has.
 */
function extractPricesForItem(html, itemId) {
    const marker = html.indexOf(`"Item":"${itemId}"`);
    if (marker === -1)
        return null;
    const window = html.slice(marker, marker + 1200);
    const price = toCents(window.match(/"FinalPrice"\s*:\s*([0-9.]+)/)?.[1]);
    if (price === null)
        return null;
    return { price, listPrice: toCents(window.match(/"UnitCost"\s*:\s*([0-9.]+)/)?.[1]) };
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
export function neweggProductUrl(retailerId) {
    return `${BASE}/p/${retailerId}`;
}
// ---- parsing ---------------------------------------------------------------
function collectProducts(html) {
    const byId = new Map();
    // Walk every `"ItemCell":{...}` object in the document rather than trying to
    // parse the whole blob — the surrounding payload is huge and its outer shape
    // differs between search and product pages.
    for (const match of html.matchAll(/"ItemCell"\s*:\s*/g)) {
        const start = (match.index ?? 0) + match[0].length;
        const raw = extractBalancedObject(html, start);
        if (!raw)
            continue;
        try {
            const parsed = parseItemCell(JSON.parse(raw));
            if (parsed && !byId.has(parsed.retailerId)) {
                byId.set(parsed.retailerId, parsed);
            }
        }
        catch {
            // One malformed cell shouldn't discard the rest of the page.
        }
    }
    return [...byId.values()];
}
function parseItemCell(cell) {
    const retailerId = cell?.Item;
    // Description is an OBJECT, not a string — its .Title is the product name.
    // Reading it directly renders "[object Object]" on every card.
    const title = cell?.Description?.Title ?? cell?.Description?.IMDescription ?? null;
    const price = toCents(cell?.FinalPrice);
    if (!retailerId || !title || price === null)
        return null;
    // UnitCost is the pre-discount price despite the name.
    const listPrice = toCents(cell?.UnitCost);
    return {
        retailer: "newegg",
        retailerId: String(retailerId),
        title: String(title),
        price,
        listPrice: listPrice && listPrice > price ? listPrice : null,
        currency: "USD",
        imageUrl: imageFrom(cell),
        url: cell?.ItemUrl
            ? absolute(cell.ItemUrl)
            : neweggProductUrl(String(retailerId)),
        availability: cell?.Active === "1" || cell?.IsActivated ? "IN_STOCK" : null,
        rating: numberOrNull(cell?.Review?.Rating ?? cell?.Review?.Score),
        ratingCount: numberOrNull(cell?.Review?.TotalReviews ?? cell?.Review?.Count),
        sellerRating: null,
        sellerRatingCount: null,
    };
}
/** Images arrive as a comma-separated filename list against a known CDN. */
function imageFrom(cell) {
    const list = cell?.NewImage?.ImageNameList ?? cell?.ImageNameList;
    if (typeof list !== "string" || !list)
        return null;
    const first = list.split(",")[0]?.trim();
    return first ? `https://c1.neweggimages.com/productimage/nb640/${first}` : null;
}
function absolute(path) {
    if (typeof path !== "string")
        return BASE;
    return path.startsWith("http") ? path : `${BASE}${path}`;
}
/**
 * Newegg item numbers come in two shapes and both appear in urls:
 *   /p/N82E16826999039        legacy
 *   /p/0TF-00D2-00003         current, with dashes
 */
function extractItemNumber(url) {
    return url.match(/\/p\/([A-Z0-9][A-Z0-9-]{6,})/i)?.[1] ?? null;
}
function numberOrNull(value) {
    const n = typeof value === "string" ? Number(value) : value;
    return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
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
