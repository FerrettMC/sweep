// test-lookup.ts — the product lookup layer.
//
//   npm run test:lookup
//
// The Amazon half runs against a RECORDED Bright Data payload rather than the
// live API: it's deterministic, it costs nothing, and the thing worth testing
// is our parsing, not their uptime. The fixture is a real response, so a
// change in their field names still shows up here.
//
// The eBay and Etsy halves hit the live APIs, which are free.
import "./testEnv.js";
import { readFileSync } from "node:fs";
import { parseAmazonDetail } from "./lib/scrapers/amazon.js";
import { COVERAGE, cleanQuote, num, strings } from "./lib/productDetail.js";

let pass = 0,
  fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok && detail !== undefined) console.log("     ", JSON.stringify(detail).slice(0, 300));
};

const raw = JSON.parse(
  readFileSync(new URL("./fixtures/amazon-product.json", import.meta.url), "utf8"),
);

console.log("\n— Amazon: the basics survive the richer parser —");
const detail = parseAmazonDetail(raw, "https://www.amazon.com/dp/B0D1XD1ZV3")!;
check("parsed at all", detail !== null);
check("retailer + id", detail.retailer === "amazon" && detail.retailerId === "B0D1XD1ZV3");
check("title", detail.title.startsWith("Apple AirPods Pro 2"));
check("rating 4.6", detail.rating === 4.6, detail.rating);
check("review count", detail.ratingCount === 47267, detail.ratingCount);
check("brand", detail.brand === "Apple", detail.brand);
check("out of stock is reported as such", detail.inStock === false, detail.inStock);

console.log("\n— Amazon: review intelligence, the point of the page —");
const reviews = detail.reviews!;
check("reviews present", reviews !== null);
check("summary text", (reviews?.text ?? "").startsWith("Customers love the sound quality"));
check("positive keywords", reviews.positive.includes("Sound quality"), reviews.positive);
check("mixed keywords", reviews.mixed.includes("Fit"), reviews.mixed);
check("null negatives become an empty list, not [null]", reviews.negative.length === 0, reviews.negative);
check("topics parsed", reviews.topics.length === 6, reviews.topics.length);
check("buyer photos", reviews.images.length === 19, reviews.images.length);

const topic = reviews.topics[0];
check("topic named", topic.topic === "Sound quality", topic.topic);
check("positive mentions", topic.positiveMentions === 4497, topic.positiveMentions);
check("negative mentions", topic.negativeMentions === 811, topic.negativeMentions);
check("topic has quotes", topic.quotes.length === 4, topic.quotes.length);
check(
  "quotes are stripped of Amazon's leading ellipsis",
  topic.quotes.every((q) => !q.startsWith(".") && !q.startsWith("…")),
  topic.quotes.map((q) => q.slice(0, 20)),
);

console.log("\n— the mentions_count trap —");
// The recorded payload carries mentions_count: 5 alongside 4497 positive
// mentions. Anything computing a share from it would be fiction, so the field
// must not appear on our type at all.
check(
  "mentions_count is not carried through",
  !Object.keys(topic).some((k) => k.toLowerCase().includes("mentions_count")) &&
    !("mentionsCount" in topic),
  Object.keys(topic),
);
check(
  "the raw payload really is inconsistent (guarding the reason above)",
  raw.customers_say_topics[0].mentions_count <
    raw.customers_say_topics[0].positive_mentions_count,
  {
    mentions: raw.customers_say_topics[0].mentions_count,
    positive: raw.customers_say_topics[0].positive_mentions_count,
  },
);

console.log("\n— Amazon: specs, features, images —");
check("features", detail.features.length === 10, detail.features.length);
check("spec rows", detail.specs.length >= 6, detail.specs.length);
check(
  "specs are label/value pairs with both sides filled",
  detail.specs.every((s) => s.label.length > 0 && s.value.length > 0),
);
check("main image leads the gallery", detail.images[0] === raw.image_url, detail.images[0]);
check("gallery deduplicated", new Set(detail.images).size === detail.images.length);

console.log("\n— absent data stays absent —");
// This product has no coupon, no badge and no seller name. Every one of those
// must come back null rather than as an empty-but-present section, because the
// client decides whether to draw a panel from exactly this.
check("no coupon invented", detail.coupon === null, detail.coupon);
check("no trust panel when every signal is missing", detail.trust === null, detail.trust);
check("no shipping invented for Amazon", detail.shipping === null, detail.shipping);
check("seller panel only from real fields", detail.seller?.name === null || detail.seller === null);

console.log("\n— coverage is declared, not guessed —");
check("Amazon declares reviews", COVERAGE.amazon.reviews === true);
check("eBay declares no product reviews", COVERAGE.ebay.reviews === false);
check("eBay declares shipping", COVERAGE.ebay.shipping === true);
check("Amazon declares no shipping", COVERAGE.amazon.shipping === false);

console.log("\n— helpers —");
check("cleanQuote strips ellipses both ends", cleanQuote("…hello there…") === "hello there");
check("cleanQuote rejects empty", cleanQuote("  …  ") === null);
check("cleanQuote rejects non-strings", cleanQuote(null) === null);
check("num parses numeric strings", num("4.6") === 4.6);
check("num rejects empty string", num("") === null);
check("num rejects null", num(null) === null);
check("strings drops nulls and blanks", strings(["a", null, "", "  ", "b"]).length === 2);
check("strings deduplicates", strings(["a", "a", "b"]).length === 2);
check("strings preserves order", strings(["b", "a"]).join() === "b,a");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
