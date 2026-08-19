// test-searchcache.ts — not paying twice for the same question.
//   npm run test:searchcache
//
// Runs on the DEV database. The cases that matter are the refusals: serving a
// cached miss, a cached failure, or fewer results than a paying tier asked for
// are all ways this could quietly make the app worse to save money.
import "./testEnv.js";
import { prisma } from "./lib/prisma.js";
import {
  normalizeKeyword,
  readSearchCache,
  writeSearchCache,
} from "./lib/scrapers/searchCache.js";
import { cacheSearchResults } from "./lib/priceChecker.js";
import type { ScrapedProduct } from "./lib/scrapers/types.js";

let pass = 0,
  fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok && detail !== undefined) console.log("     ", JSON.stringify(detail).slice(0, 300));
};

const TAG = `cachetest-${Date.now()}`;
const KEYWORD = `widget ${TAG}`;

const product = (n: number, price: number): ScrapedProduct => ({
  retailer: "ebay",
  retailerId: `${TAG}-${n}`,
  title: `Test Widget ${n} ${TAG}`,
  price,
  listPrice: null,
  currency: "USD",
  imageUrl: null,
  url: `https://example.com/${TAG}/${n}`,
  availability: "IN_STOCK",
  rating: null,
  ratingCount: null,
  sellerRating: 99.3,
  sellerRatingCount: 412,
});

const four = [product(1, 1000), product(2, 2000), product(3, 3000), product(4, 4000)];

try {
  console.log("\n— the key —");
  check("case and spacing collapse", normalizeKeyword("  AirPods   Pro ") === "airpods pro");
  check("already-normal keys are untouched", normalizeKeyword("airpods pro") === "airpods pro");

  console.log("\n— nothing cached yet —");
  check("a question never asked is a miss", (await readSearchCache("ebay", KEYWORD, 4, false)) === null);

  console.log("\n— a real answer, stored and served —");
  await cacheSearchResults(four);
  await writeSearchCache("ebay", KEYWORD, 4, four);

  const hit = await readSearchCache("ebay", KEYWORD, 4, false);
  check("hits after being written", hit !== null && hit.length === 4, hit?.length);
  check(
    "order is preserved — relevance is part of what we paid for",
    hit?.map((p) => p.retailerId).join() === four.map((p) => p.retailerId).join(),
    hit?.map((p) => p.retailerId),
  );
  check(
    "seller feedback survives the round trip",
    hit?.[0].sellerRating === 99.3 && hit?.[0].sellerRatingCount === 412,
    { rating: hit?.[0].sellerRating, count: hit?.[0].sellerRatingCount },
  );
  check("normalized key matches a differently-typed query",
    (await readSearchCache("ebay", `  WIDGET   ${TAG}  `, 4, false)) !== null);

  console.log("\n— prices come from Product, not from the cache —");
  // The whole design: the match set is cached, the prices are looked up. A
  // price that changed after caching must be the one we serve.
  await prisma.product.updateMany({
    where: { retailerId: `${TAG}-1` },
    data: { currentPrice: 777 },
  });
  const refreshed = await readSearchCache("ebay", KEYWORD, 4, false);
  check(
    "a price updated since caching is served, not the cached one",
    refreshed?.[0].price === 777,
    refreshed?.[0].price,
  );

  console.log("\n— refusals —");
  check(
    "a cache filled for 4 can't answer a request for 8",
    (await readSearchCache("ebay", KEYWORD, 8, false)) === null,
  );
  check(
    "a smaller request is served from a bigger cache, trimmed",
    (await readSearchCache("ebay", KEYWORD, 2, false))?.length === 2,
  );
  check(
    "another retailer's cache is not ours",
    (await readSearchCache("amazon", KEYWORD, 4, false)) === null,
  );

  console.log("\n— an empty result is never cached —");
  // An empty answer is also what a subtly broken parser returns, and caching
  // it would hide the breakage for hours.
  const emptyKey = `empty ${TAG}`;
  await writeSearchCache("ebay", emptyKey, 4, []);
  check("writing nothing stores nothing", (await readSearchCache("ebay", emptyKey, 4, false)) === null);

  console.log("\n— entries decay —");
  await prisma.searchCache.updateMany({
    where: { keyword: normalizeKeyword(KEYWORD) },
    data: { fetchedAt: new Date(Date.now() - 60 * 60 * 1000) },
  });
  check(
    "an hour old is stale for a free store (45m)",
    (await readSearchCache("ebay", KEYWORD, 4, false)) === null,
  );
  check(
    "but still fresh for the metered one (3h), which is where the money is",
    (await readSearchCache("ebay", KEYWORD, 4, true)) !== null,
  );

  console.log("\n— entries survive products disappearing, up to a point —");
  await prisma.searchCache.updateMany({
    where: { keyword: normalizeKeyword(KEYWORD) },
    data: { fetchedAt: new Date() },
  });
  await prisma.product.updateMany({
    where: { retailerId: `${TAG}-4` },
    data: { currentPrice: null },
  });
  check(
    "one missing of four still serves — 3 of 4 is above the floor",
    (await readSearchCache("ebay", KEYWORD, 4, false))?.length === 3,
  );
  await prisma.product.updateMany({
    where: { retailerId: { in: [`${TAG}-2`, `${TAG}-3`] } },
    data: { currentPrice: null },
  });
  check(
    "three missing of four is a miss, not a thin result",
    (await readSearchCache("ebay", KEYWORD, 4, false)) === null,
  );
  console.log("\n— what must never be served stale —");
  // Deal radar exists to notice a price moved. If it read a cached match set
  // it would compare today's prices against today's prices and report no
  // change, which defeats the feature rather than merely ageing it.
  const radarSource = (await import("node:fs")).readFileSync(
    new URL("./lib/dealRadar.ts", import.meta.url),
    "utf8",
  );
  check("deal radar asks for fresh results", /fresh:\s*true/.test(radarSource));

  // Product lookup calls enrich, which is deliberately never wrapped in the
  // cache — a page about one product should be about that product right now.
  const scrapersSource = (await import("node:fs")).readFileSync(
    new URL("./lib/scrapers/index.ts", import.meta.url),
    "utf8",
  );
  const enrichWrapper = scrapersSource.slice(
    scrapersSource.indexOf("enrich: adapter.enrich"),
    scrapersSource.indexOf("enrich: adapter.enrich") + 220,
  );
  check("product lookup is never served from cache", !enrichWrapper.includes("cached("), enrichWrapper.slice(0, 120));

  // Scheduled price checks call scrapeProduct, also unwrapped.
  const scrapeWrapper = scrapersSource.slice(
    scrapersSource.indexOf("scrapeProduct: (url: string)"),
    scrapersSource.indexOf("scrapeProduct: (url: string)") + 160,
  );
  check("price checks are never served from cache", !scrapeWrapper.includes("cached("), scrapeWrapper.slice(0, 120));
} finally {
  await prisma.searchCache.deleteMany({ where: { keyword: { contains: TAG } } });
  await prisma.product.deleteMany({ where: { retailerId: { startsWith: TAG } } });
  await prisma.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
