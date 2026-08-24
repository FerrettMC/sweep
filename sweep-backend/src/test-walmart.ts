import "./testEnv.js";
import { searchWalmart, scrapeWalmartProduct } from "./lib/scrapers/walmart.js";
import { isDecodoConfigured } from "./lib/scrapers/decodo.js";

console.log("decodo configured:", isDecodoConfigured());
if (!isDecodoConfigured()) {
  console.log("→ set DECODO_AUTH_TOKEN in sweep-backend/.env first");
  process.exit(0);
}

const s = await searchWalmart("wireless headphones", 4);
console.log(`\nsearch: ${s.status} in ${s.durationMs}ms`);
if (s.status === "success") {
  for (const p of s.data) {
    console.log(`  ${(p.price ?? 0) / 100} — ${p.title.slice(0, 58)}`);
  }
} else {
  console.log("  detail:", s.detail?.slice(0, 200));
}

const first = s.status === "success" ? s.data[0] : null;
if (first) {
  const p = await scrapeWalmartProduct(first.url);
  console.log(`\nproduct: ${p.status} in ${p.durationMs}ms`);
  if (p.status === "success") {
    console.log("  title:", p.data.title.slice(0, 60));
    console.log("  price:", p.data.price, "| list:", p.data.listPrice);
    console.log("  image:", p.data.imageUrl ? "yes" : "no");
    console.log("  rating:", p.data.rating, "count:", p.data.ratingCount);
  } else {
    console.log("  detail:", p.detail?.slice(0, 200));
  }
}
