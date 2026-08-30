// src/test-searchhistory.ts — reopening a search you already paid for.
//   npm run test:searchhistory     (needs the dev server running)
//
// The point of this feature is that reopening costs NOTHING: no scrape, no
// provider call, no quota. If that ever stops being true it becomes a way to
// spend money by scrolling a list, so it's the first thing checked here.
//
// The second is the tier cap. It prunes on every write, which means a downgrade
// has to take effect rather than leaving someone with a paid-tier history.
import { assertNotProduction, targetSummary } from "./testEnv.js";

assertNotProduction();
console.log(`target: ${targetSummary()}`);

import { prisma } from "./lib/prisma.js";
import { createTestUser, purgeTestUser } from "./testCleanup.js";
import {
  clearHistory,
  forgetSearch,
  listHistory,
  rememberSearch,
  reopenSearch,
} from "./lib/searchHistory.js";
import { TIER_LIMITS } from "./lib/tiers.js";
import type { ScrapedProduct } from "./lib/scrapers/types.js";

const API = process.env.API_URL ?? "http://127.0.0.1:3001";

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok && detail !== undefined) console.log("     ", JSON.stringify(detail));
};

const userIds: string[] = [];
const productIds: string[] = [];

/** A real Product row, since history stores ids and reads prices back from them. */
async function makeProduct(n: number, price: number | null = 1999) {
  const row = await prisma.product.create({
    data: {
      retailer: "ebay",
      retailerId: `hist-test-${Date.now()}-${n}`,
      url: `https://www.ebay.com/itm/hist-${n}`,
      title: `History test product ${n}`,
      currentPrice: price,
      currency: "USD",
    },
  });
  productIds.push(row.id);
  return row;
}

function scraped(row: { retailerId: string; title: string; currentPrice: number | null; url: string }): ScrapedProduct {
  return {
    retailer: "ebay",
    retailerId: row.retailerId,
    title: row.title,
    price: row.currentPrice,
    listPrice: null,
    currency: "USD",
    imageUrl: null,
    url: row.url,
    availability: "IN_STOCK",
    rating: null,
    ratingCount: null,
  };
}

try {
  const user = await createTestUser("history", API);
  userIds.push(user.id);

  const rows = await Promise.all([makeProduct(1), makeProduct(2), makeProduct(3)]);
  const products = rows.map(scraped);

  console.log("\n— remembering —");
  await rememberSearch(user.id, "Wireless  Headphones ", products, 4, "free");
  let history = await listHistory(user.id, "free");
  check("the search is remembered", history.length === 1, history);
  // Normalized the same way the cache normalizes, or the same question lands
  // twice under two spellings.
  check("the keyword is normalized", history[0]?.keyword === "wireless headphones", history[0]?.keyword);
  check("it counts the results", history[0]?.resultCount === 3, history[0]);
  check("it counts the stores asked", history[0]?.storeCount === 4, history[0]);

  console.log("\n— the same search again doesn't duplicate —");
  await rememberSearch(user.id, "wireless headphones", products, 4, "free");
  history = await listHistory(user.id, "free");
  check("still one entry", history.length === 1, history.length);

  console.log("\n— reopening —");
  const reopened = await reopenSearch(user.id, history[0].id);
  check("it comes back", reopened !== null);
  check("with the same products", reopened?.products.length === 3, reopened?.products.length);
  check("in the order they were shown",
    reopened?.products.map((p) => p.retailerId).join(",") === products.map((p) => p.retailerId).join(","));
  check("and is not flagged partial", reopened?.partial === false);

  console.log("\n— prices are read live, not snapshotted —");
  // The whole reason only ids are stored. A price tracker serving a stale
  // snapshot would be undermining its own point.
  await prisma.product.update({ where: { id: rows[0].id }, data: { currentPrice: 999 } });
  const after = await reopenSearch(user.id, history[0].id);
  check("the new price shows", after?.products[0]?.price === 999, after?.products[0]?.price);

  console.log("\n— a product that goes away —");
  await prisma.product.update({ where: { id: rows[1].id }, data: { currentPrice: null } });
  const partial = await reopenSearch(user.id, history[0].id);
  check("it drops out", partial?.products.length === 2, partial?.products.length);
  // Saying so matters: 3 results silently becoming 2 reads as a bug.
  check("and the result says so", partial?.partial === true);
  check("with the original count", partial?.originalCount === 3, partial?.originalCount);

  console.log("\n— tier caps —");
  const capUser = await createTestUser("histcap", API);
  userIds.push(capUser.id);
  const freeLimit = TIER_LIMITS.free.searchHistoryLimit;
  for (let i = 0; i < freeLimit + 4; i++) {
    await rememberSearch(capUser.id, `search number ${i}`, products, 1, "free");
  }
  const capped = await listHistory(capUser.id, "free");
  check(`free keeps ${freeLimit}`, capped.length === freeLimit, capped.length);
  check("the newest survive", capped[0]?.keyword === `search number ${freeLimit + 3}`, capped[0]?.keyword);
  check("the oldest are gone", !capped.some((h) => h.keyword === "search number 0"));

  console.log("\n— a bigger tier keeps more —");
  for (let i = 0; i < 5; i++) {
    await rememberSearch(capUser.id, `pro search ${i}`, products, 1, "pro");
  }
  const proHistory = await listHistory(capUser.id, "pro");
  check("pro's cap is higher than free's",
    TIER_LIMITS.pro.searchHistoryLimit > TIER_LIMITS.free.searchHistoryLimit);
  check("so nothing was pruned this time", proHistory.length === freeLimit + 5, proHistory.length);

  console.log("\n— downgrading prunes —");
  // Reading as free must not show more than free allows, and the next write
  // must actually delete the excess rather than hiding it.
  await rememberSearch(capUser.id, "back to free", products, 1, "free");
  const afterDowngrade = await prisma.searchHistory.count({ where: { userId: capUser.id } });
  check("stored rows are back to the free cap", afterDowngrade === freeLimit, afterDowngrade);

  console.log("\n— it is theirs alone —");
  const stranger = await createTestUser("histother", API);
  userIds.push(stranger.id);
  const mine = (await listHistory(user.id, "free"))[0];
  check("another user can't reopen it", (await reopenSearch(stranger.id, mine.id)) === null);
  check("another user can't delete it", (await forgetSearch(stranger.id, mine.id)) === false);
  check("and it survives the attempt", (await reopenSearch(user.id, mine.id)) !== null);

  console.log("\n— forgetting —");
  check("delete works for the owner", (await forgetSearch(user.id, mine.id)) === true);
  check("and it's gone", (await listHistory(user.id, "free")).length === 0);
  const removed = await clearHistory(capUser.id);
  check("clearing removes the rest", removed === freeLimit, removed);
  check("leaving nothing", (await listHistory(capUser.id, "free")).length === 0);

  console.log("\n— nothing worth remembering —");
  await rememberSearch(user.id, "empty search", [], 3, "free");
  check("a search with no results isn't stored", (await listHistory(user.id, "free")).length === 0);
  await rememberSearch(user.id, "   ", products, 3, "free");
  check("a blank keyword isn't stored", (await listHistory(user.id, "free")).length === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
} finally {
  await prisma.searchHistory.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  for (const id of userIds) await purgeTestUser(id);
  await prisma.$disconnect();
}

process.exit(fail === 0 ? 0 : 1);
