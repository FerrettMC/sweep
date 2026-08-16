// src/test-verify-drop.ts — the implausible-drop guard.
//   npm run test:verify-drop
//
// Uses a real product row but stubs the scrape, so the interesting cases (a
// re-read that disagrees, a re-read that fails) are reachable without waiting
// for a retailer to actually misbehave.
import { assertNotProduction, targetSummary } from "./testEnv.js";

// Loads .env.test over .env, then refuses to touch the live project.
assertNotProduction();
console.log(`target: ${targetSummary()}`);
import { prisma } from "./lib/prisma.js";
import { adapters } from "./lib/scrapers/index.js";
import { SUSPECT_DROP_PERCENT, verifyDrop } from "./lib/verifyDrop.js";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, d?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${l}`);
  if (!ok && d !== undefined) console.log("     ", JSON.stringify(d).slice(0, 200));
};

const product = await prisma.product.create({
  data: {
    retailer: "walmart",
    retailerId: `verify-test-${Date.now()}`,
    url: "https://www.walmart.com/ip/test/1",
    title: "Drop guard fixture",
    currentPrice: 1000,
    currency: "USD",
  },
});

const real = adapters.walmart.scrapeProduct;
const stub = (price: number | null, status: "success" | "failed" = "success") => {
  adapters.walmart.scrapeProduct = (async () =>
    status === "success"
      ? { status: "success", durationMs: 1, data: { ...({} as any), retailer: "walmart", retailerId: product.retailerId, title: product.title, price, listPrice: null, currency: "USD", imageUrl: null, url: product.url, availability: null, rating: null, ratingCount: null } }
      : { status: "failed", durationMs: 1, detail: "stubbed failure" }) as any;
};

try {
  console.log(`\n— ordinary drops don't cost an extra request (threshold ${SUSPECT_DROP_PERCENT}%) —`);
  let called = 0;
  adapters.walmart.scrapeProduct = (async () => { called++; return { status: "failed", durationMs: 1, detail: "should not run" }; }) as any;

  let v = await verifyDrop({ productId: product.id, previousPrice: 10000, newPrice: 9000 }); // 10%
  check("a 10% drop is believable", v.believable && v.reason === "within-normal-range", v);
  v = await verifyDrop({ productId: product.id, previousPrice: 10000, newPrice: 3500 }); // 65%
  check("a 65% clearance is believable without a re-check", v.believable, v);
  check("no re-scrape happened for either", called === 0, { called });

  console.log("\n— steep drops are re-checked —");
  stub(1000);
  v = await verifyDrop({ productId: product.id, previousPrice: 10000, newPrice: 1000 }); // 90%
  check("a 90% drop the re-read agrees with is allowed", v.believable && v.reason === "confirmed-by-recheck", v);

  stub(1015);
  v = await verifyDrop({ productId: product.id, previousPrice: 10000, newPrice: 1000 });
  check("a re-read within tolerance still counts as agreement", v.believable, v);

  console.log("\n— the cases this exists for —");
  stub(9800);
  v = await verifyDrop({ productId: product.id, previousPrice: 10000, newPrice: 1000 });
  check("a re-read that disagrees is suppressed", !v.believable && v.reason === "recheck-disagreed", v);

  stub(null, "failed");
  v = await verifyDrop({ productId: product.id, previousPrice: 10000, newPrice: 1000 });
  check("a failed re-read is suppressed, not assumed good", !v.believable && v.reason === "recheck-failed", v);

  stub(null);
  v = await verifyDrop({ productId: product.id, previousPrice: 10000, newPrice: 1000 });
  check("a re-read with no price is suppressed", !v.believable, v);

  v = await verifyDrop({ productId: "does-not-exist", previousPrice: 10000, newPrice: 1000 });
  check("a missing product is suppressed", !v.believable && v.reason === "recheck-failed", v);
} finally {
  adapters.walmart.scrapeProduct = real;
  await prisma.scrapeCheck.deleteMany({ where: { productId: product.id } });
  await prisma.product.delete({ where: { id: product.id } });
}

console.log(`\n${pass} passed, ${fail} failed  (cleaned up)`);
process.exit(fail ? 1 : 0);
