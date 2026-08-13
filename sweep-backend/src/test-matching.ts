// src/test-matching.ts — the product-matching bar for "Sweep this deal".
//   npm run test:matching
//
// No database, no network. These are the judgement calls that decide whether we
// tell someone "same product, cheaper elsewhere", and getting one wrong sends
// them to buy the wrong thing — so they're pinned down here.
import { compareProducts, searchKeyFor } from "./lib/matching.js";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, d?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${l}`);
  if (!ok && d !== undefined) console.log("     ", JSON.stringify(d));
};
const cmp = (a: string, b: string) => compareProducts({ title: a }, { title: b });

console.log("\n— should be confident these are the same —");
let r = cmp(
  "Sony WH-1000XM5 Wireless Noise Cancelling Headphones - Black",
  "Sony - WH-1000XM5 Wireless Noise Canceling Over-the-Ear Headphones - Black",
);
check("same model across two retailers' phrasing", r.confidence === "same", r);

r = cmp("Apple AirPods 4 - White", "Apple AirPods 4 with Active Noise Cancellation - White");
check("a variant suffix does not make it a different product outright", r.confidence !== "unrelated", r);

console.log("\n— must NEVER be called the same —");
r = cmp("Sony WH-1000XM5 Wireless Headphones", "Sony WH-1000XM4 Wireless Headphones");
check("XM5 vs XM4 is not the same product", r.confidence !== "same", r);

r = cmp("Apple iPad 256GB Wi-Fi", "Apple iPad 64GB Wi-Fi");
check("256GB vs 64GB is not the same product", r.confidence !== "same", r);

r = cmp("Sony WH-1000XM5 Headphones", "Bose QuietComfort Ultra Headphones");
check("different brand is not the same product", r.confidence !== "same", r);

r = cmp("Sony WH-1000XM5 Wireless Headphones", "Sony WH-1000XM5 Wireless Headphones - Refurbished");
check("a refurb of the same model is not a like-for-like swap", r.confidence !== "same", r);
check("  ...and says why", r.caveats.some((c) => /refurb/i.test(c)), r.caveats);

r = cmp("Duracell AA Batteries 4 Pack", "Duracell AA Batteries 24 Pack");
check("a different pack size is not the same product", r.confidence !== "same", r);
check("  ...and says why", r.caveats.some((c) => /pack/i.test(c)), r.caveats);

r = cmp("Apple AirPods Pro 3", "Apple AirPods Pro 3 Silicone Case Cover");
check("an accessory is not the product", r.confidence !== "same", r);

console.log("\n— unrelated items are dropped entirely —");
r = cmp("Sony WH-1000XM5 Wireless Headphones", "Bear Naked Granola Vanilla Almond");
check("completely unrelated scores as unrelated", r.confidence === "unrelated", r);

console.log("\n— search keys stay short —");
const key = searchKeyFor(
  "Apple - AirPods Pro 3, Wireless Active Noise Cancelling Earbuds with Heart Rate Sensing Feature - White",
);
check(`key is short ("${key}")`, key.length <= 60 && key.split(" ").length <= 6, key);
check("key keeps the brand", key.includes("apple"), key);

const key2 = searchKeyFor("Sony WH-1000XM5 Wireless Noise Cancelling Over-Ear Headphones Black");
check(`key keeps the model number ("${key2}")`, /1000xm5/.test(key2), key2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
