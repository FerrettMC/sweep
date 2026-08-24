// src/bandwidth-model.ts
//
// Is Decodo's $4/GB residential proxy cheaper than their per-request Scraper
// API, for Walmart?
//
//   npm run bandwidth-model
//
// Two products, two billing units, and they don't compare directly:
//
//   Scraper API   per REQUEST, flat, regardless of how heavy the page is
//   Residential   per GIGABYTE, so a heavy page costs more than a light one
//
// That distinction is the whole question. Walmart search pages are 1.47 MB of
// HTML — among the heaviest things we fetch — so bandwidth billing is at its
// least flattering exactly where we use it most.

// ---- measured, not guessed -------------------------------------------------
//
// Fetched through Decodo on 24 Aug 2026 and measured both ways. Re-measure if
// Walmart changes their page weight; these are the load-bearing numbers.

const PRODUCT_RAW_KB = 0.49 * 1024;
const PRODUCT_GZIP_KB = 119;
const SEARCH_RAW_KB = 1.47 * 1024;
const SEARCH_GZIP_KB = 178;

const KB_PER_GB = 1024 * 1024;

// ---- what each option costs ------------------------------------------------

const RESIDENTIAL_COST_PER_GB = 4;
const SCRAPER_MONTHLY = 19;
const SCRAPER_REQUESTS = 38_000;
const SCRAPER_PER_REQUEST = SCRAPER_MONTHLY / SCRAPER_REQUESTS;

/**
 * Proxy overhead beyond the page itself: TLS handshake, CONNECT tunnel,
 * request headers, response headers. Small next to a 1.5 MB page, not zero.
 */
const OVERHEAD = 1.08;

function perGb(kb: number) {
  return Math.floor(KB_PER_GB / (kb * OVERHEAD));
}
function perScrape(kb: number) {
  return RESIDENTIAL_COST_PER_GB / perGb(kb);
}

console.log("Walmart page weight, measured through Decodo:");
console.log(`  product   ${(PRODUCT_RAW_KB / 1024).toFixed(2)} MB raw   ${PRODUCT_GZIP_KB} KB gzipped`);
console.log(`  search    ${(SEARCH_RAW_KB / 1024).toFixed(2)} MB raw   ${SEARCH_GZIP_KB} KB gzipped`);

console.log("\n$4 of residential bandwidth buys:");
console.log("                        scrapes/GB   $/scrape   vs Scraper API");
for (const [name, kb] of [
  ["product, gzipped", PRODUCT_GZIP_KB],
  ["search,  gzipped", SEARCH_GZIP_KB],
  ["product, raw    ", PRODUCT_RAW_KB],
  ["search,  raw    ", SEARCH_RAW_KB],
] as [string, number][]) {
  const each = perScrape(kb);
  const ratio = each / SCRAPER_PER_REQUEST;
  const verdict = ratio < 0.9 ? "cheaper" : ratio > 1.1 ? "MORE expensive" : "about the same";
  console.log(
    `  ${name}      ${String(perGb(kb)).padStart(6)}   $${each.toFixed(5)}   ${ratio.toFixed(1)}x  ${verdict}`,
  );
}

console.log(`\n  Scraper API for comparison:        $${SCRAPER_PER_REQUEST.toFixed(5)} flat, any page size`);

// ---- what we'd actually spend ----------------------------------------------
//
// Volume from cost-model.ts, scaled for Walmart. Amazon is assumed 50% of
// tracked items there; Walmart is a second-choice store for most people, so a
// smaller share — but searches fan out to EVERY routed store, so search volume
// doesn't shrink the same way.

const WALMART_SHARE_OF_TRACKED = 0.2;
const AMAZON_REQ_AT_100_USERS = 15_560;
const CHECKS = Math.round((AMAZON_REQ_AT_100_USERS / 0.5) * WALMART_SHARE_OF_TRACKED);
const SEARCHES = 3_000; // every search hits Walmart once, tier limits aside

console.log(`\nAt 100 users (${CHECKS.toLocaleString()} price checks + ${SEARCHES.toLocaleString()} searches per month):`);

const gzipMonthly = CHECKS * perScrape(PRODUCT_GZIP_KB) + SEARCHES * perScrape(SEARCH_GZIP_KB);
const rawMonthly = CHECKS * perScrape(PRODUCT_RAW_KB) + SEARCHES * perScrape(SEARCH_RAW_KB);
const scraperMonthly = (CHECKS + SEARCHES) * SCRAPER_PER_REQUEST;

console.log(`  residential, billed gzipped   $${gzipMonthly.toFixed(2)}`);
console.log(`  residential, billed raw       $${rawMonthly.toFixed(2)}`);
console.log(`  scraper API (pay $19 either way)  $${scraperMonthly.toFixed(2)} of a $${SCRAPER_MONTHLY} plan`);

console.log("\nThe one thing this model can't tell you:");
console.log("  whether a bare residential proxy gets past Walmart at all.");
console.log("  The Scraper API is proven — 12/12. A raw proxy is only an IP;");
console.log("  our TLS fingerprint and headers are still Node's. Test it with");
console.log("  a few cents before switching anything.");
