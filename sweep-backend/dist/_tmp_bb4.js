import { fetchText } from "./lib/scrapers/http.js";
const wait = Number(process.argv[2] ?? 180);
console.log(`cooling down ${wait}s...`);
await new Promise((r) => setTimeout(r, wait * 1000));
// ONE request only, to a product page.
const u = "https://www.bestbuy.com/site/apple-airpods-4-white/6447384.p?skuId=6447384";
const t = Date.now();
try {
    const h = await fetchText(u, {
        timeoutMs: 30000,
        retries: 0,
        headers: { referer: "https://www.bestbuy.com/" },
    });
    console.log(`PDP after cooldown: OK ${Date.now() - t}ms len=${h.length} apollo=${h.includes("ApolloSSRDataTransport")}`);
}
catch (e) {
    console.log(`PDP after cooldown: FAIL ${Date.now() - t}ms ${e.name}: ${String(e.message).slice(0, 140)}`);
}
