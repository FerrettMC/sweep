import { claimedDiscount } from "./lib/discount.js";
import { pickHighlights } from "./lib/highlights.js";
import { judgeSale } from "./lib/saleVerdict.js";
import type { ScrapedProduct } from "./lib/scrapers/types.js";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) console.log(`    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`);
}

// The real listing that started this: $20.09 against a $159.95 "list price".
check("87% off is unverified", claimedDiscount(2009, 15995)?.confidence, "unverified");
check("50% off is still plausible", claimedDiscount(5000, 10000)?.confidence, "plausible");
check("51% off tips over", claimedDiscount(4900, 10000)?.confidence, "unverified");
check("9% off is not a deal", claimedDiscount(9100, 10000), null);
check("no list price, no claim", claimedDiscount(1000, null), null);
check("list below price is ignored", claimedDiscount(1000, 900), null);

const product = (id: string, price: number, listPrice: number | null): ScrapedProduct => ({
  retailer: "walmart",
  retailerId: id,
  title: `Product ${id}`,
  price,
  listPrice,
  currency: "USD",
  imageUrl: null,
  url: `https://www.walmart.com/ip/${id}`,
  availability: "in_stock",
  rating: null,
  ratingCount: null,
});

// A believable 45% must not be buried by an invented 87%.
const mixed = pickHighlights([product("fake", 2009, 15995), product("real", 5500, 10000)]);
const drop = mixed.find((h) => h.kind === "biggest_discount");
check("real 45% wins over fake 87%", drop?.product.retailerId, "real");
check("and is labelled normally", drop?.label, "Biggest drop");

// With nothing credible on the page, the doubtful one shows — and admits it.
const onlyFake = pickHighlights([product("fake", 2009, 15995)]);
const fakeDrop = onlyFake.find((h) => h.kind === "biggest_discount");
check("doubtful claim still surfaces", fakeDrop?.product.retailerId, "fake");
check("but is marked", fakeDrop?.label, "Big claim");
check("and hedges in words", fakeDrop?.reason.includes("claims 87% off"), true);

// No history is exactly when an outsized claim is most dangerous.
const noHistory = judgeSale({
  price: 2009, listPrice: 15995, low: null, average: null, points: 0, claimedPercentOff: 87,
});
check("no-history flags the claim", noHistory.claimedConfidence, "unverified");
check("and warns about inflation", noHistory.detail.includes("inflate"), true);

// History outranks any claim: the verdict comes from what we recorded.
const withHistory = judgeSale({
  price: 2009, listPrice: 15995, low: 1899, average: 2600, points: 12, claimedPercentOff: 87,
});
check("history still drives the verdict", withHistory.verdict, "good-price");
// 23% below its own recorded average — a real discount, and nothing like 87%.
check("and reports the honest number", withHistory.realPercentBelowTypical, 23);
check("claim is reported, not trusted", withHistory.claimedConfidence, "unverified");

console.log(failures === 0 ? "\nall passed" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
