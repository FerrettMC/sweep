// test-similar.ts — "you might also want", against our own cache.
//   npm run test:similar
//
// Runs on the DEV database, which testEnv guarantees. Seeds a small corpus,
// asks for similar products, and checks what comes back — the interesting
// cases are the ones it must NOT return, because a false "same product" is
// how someone buys the 64GB thinking it was the 256GB.
import "./testEnv.js";
import { prisma } from "./lib/prisma.js";
import { findSimilarProducts } from "./lib/similar.js";

let pass = 0,
  fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok && detail !== undefined) console.log("     ", JSON.stringify(detail).slice(0, 300));
};

const TAG = `simtest-${Date.now()}`;
const made: string[] = [];

async function seed(
  retailer: string,
  title: string,
  price: number | null,
): Promise<string> {
  const row = await prisma.product.create({
    data: {
      retailer,
      retailerId: `${TAG}-${made.length}`,
      url: `https://example.com/${TAG}/${made.length}`,
      title,
      currentPrice: price,
      currency: "USD",
    },
  });
  made.push(row.id);
  return row.id;
}

try {
  // The product being viewed.
  const source = await seed(
    "amazon",
    `Sony WH-1000XM5 Wireless Noise Cancelling Headphones ${TAG}`,
    39900,
  );

  // Same product, cheaper, elsewhere — the row's whole reason to exist.
  await seed("ebay", `Sony WH-1000XM5 Wireless Noise Cancelling Headphones ${TAG}`, 32900);
  // Same line, different model — related but not the same thing.
  await seed("ebay", `Sony WH-1000XM4 Wireless Noise Cancelling Headphones ${TAG}`, 24900);
  // A different brand entirely. Shares plenty of words.
  await seed("ebay", `Bose QuietComfort Wireless Noise Cancelling Headphones ${TAG}`, 27900);
  // An accessory. Shares the model number, which is exactly the trap.
  await seed("ebay", `Carrying Case for Sony WH-1000XM5 Headphones ${TAG}`, 1900);
  // No price — can't be compared, can't be shown.
  await seed("ebay", `Sony WH-1000XM5 Wireless Noise Cancelling Headphones ${TAG}`, null);

  const results = await findSimilarProducts(source, 10);
  const titles = results.map((r) => r.title);

  console.log("\n— what it finds —");
  check("returns something", results.length > 0, titles);
  check(
    "the same product, cheaper, is included",
    results.some((r) => r.title.includes("XM5") && r.price === 32900),
    titles,
  );
  check(
    "and is marked as the same product",
    results.find((r) => r.price === 32900)?.confidence === "same",
    results.find((r) => r.price === 32900),
  );

  console.log("\n— what it must not do —");
  check(
    "never returns the product being viewed",
    !results.some((r) => r.productId === source),
    results.map((r) => r.productId),
  );
  check(
    "a £19 case is not a £399 pair of headphones",
    !titles.some((t) => t.includes("Carrying Case")),
    titles,
  );
  check(
    "a different brand is never called the same product",
    !results.some((r) => r.title.includes("Bose") && r.confidence === "same"),
    results.filter((r) => r.title.includes("Bose")),
  );
  check(
    "a different model is never called the same product",
    !results.some((r) => r.title.includes("XM4") && r.confidence === "same"),
    results.filter((r) => r.title.includes("XM4")),
  );
  check(
    "listings with no price are left out",
    results.every((r) => typeof r.price === "number" && r.price > 0),
    results.map((r) => r.price),
  );

  console.log("\n— ordering and shape —");
  check(
    "confident matches come before loose ones",
    results.every((r, i) =>
      i === 0 || !(results[i - 1].confidence === "similar" && r.confidence === "same"),
    ),
    results.map((r) => r.confidence),
  );
  check(
    "saving is relative to the product being viewed",
    results.every((r) => r.saving === 39900 - r.price),
    results.map((r) => ({ price: r.price, saving: r.saving })),
  );
  check("every row carries a store label", results.every((r) => r.retailerLabel.length > 0));
  check("respects the limit", (await findSimilarProducts(source, 2)).length <= 2);

  console.log("\n— nothing to say —");
  const lonely = await seed("amazon", `Utterly Unique Widget ${TAG}`, 5000);
  check("no matches returns empty, not filler", (await findSimilarProducts(lonely)).length === 0);
  const priceless = await seed("amazon", `Sony WH-1000XM5 ${TAG}`, null);
  check(
    "a product with no price of its own asks nothing",
    (await findSimilarProducts(priceless)).length === 0,
  );
} finally {
  await prisma.product.deleteMany({ where: { id: { in: made } } });
  await prisma.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
