// src/test-scrapers.ts
//
// Live smoke test for the self-written scrapers. Run it whenever a retailer
// tile goes quiet — it tells you which scrapers still parse and, when one
// breaks, whether it broke because the page changed or because we got blocked.
//
//   npm run test:scrapers            # search path, all retailers
//   npm run test:scrapers -- "sony headphones"
//
// Does NOT touch Amazon: that path costs Bright Data quota. Use test-amazon.ts.
import "dotenv/config";
import { searchAsos } from "./lib/scrapers/asos.js";
import { searchBestBuy } from "./lib/scrapers/bestbuy.js";
import { searchNewegg } from "./lib/scrapers/newegg.js";
import { isEbayConfigured, searchEbay } from "./lib/scrapers/ebay.js";
import { scrapeWalmartProduct, searchWalmart } from "./lib/scrapers/walmart.js";
const keyword = process.argv[2] ?? "airpods";
function report(name, result) {
    if (result.status === "success") {
        console.log(`\n✅ ${name} — ${result.data.length} items in ${result.durationMs}ms`);
        for (const p of result.data) {
            const price = p.price === null ? "no price" : `$${(p.price / 100).toFixed(2)}`;
            const list = p.listPrice ? ` (was $${(p.listPrice / 100).toFixed(2)})` : "";
            console.log(`   ${price}${list}  ${p.title.slice(0, 58)}`);
            console.log(`      id=${p.retailerId} avail=${p.availability} rating=${p.rating}`);
        }
        if (result.data.length === 0) {
            console.log("   ⚠️  parsed fine but returned nothing — check the keyword");
        }
    }
    else {
        const icon = result.status === "blocked" ? "🚫" : "❌";
        console.log(`\n${icon} ${name} — ${result.status} after ${result.durationMs}ms`);
        console.log(`   ${result.detail.slice(0, 240)}`);
    }
}
async function main() {
    console.log(`Searching all retailers for "${keyword}"...`);
    report("walmart", await searchWalmart(keyword, 3));
    report("bestbuy", await searchBestBuy(keyword, 3));
    report("newegg", await searchNewegg(keyword, 3));
    report("asos", await searchAsos(keyword, 3));
    if (isEbayConfigured()) {
        report("ebay", await searchEbay(keyword, 3));
    }
    else {
        console.log("\n⏭️  ebay — skipped, EBAY_CLIENT_ID/EBAY_CLIENT_SECRET not set");
    }
    // Round-trip the single-product path too: search gives us a url, and price
    // tracking depends on being able to re-read that url on a schedule.
    const walmart = await searchWalmart(keyword, 1);
    if (walmart.status === "success" && walmart.data[0]) {
        const { url } = walmart.data[0];
        console.log(`\n— re-checking one Walmart product by url —\n   ${url}`);
        const pdp = await scrapeWalmartProduct(url);
        if (pdp.status === "success") {
            console.log(`   ✅ $${((pdp.data.price ?? 0) / 100).toFixed(2)} — ${pdp.data.title.slice(0, 50)}`);
        }
        else {
            console.log(`   ${pdp.status}: ${pdp.detail.slice(0, 200)}`);
        }
    }
}
main().catch(console.error);
