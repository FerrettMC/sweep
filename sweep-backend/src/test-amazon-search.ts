// src/test-amazon-search.ts
//
// Manual keyword search against Bright Data.
// WARNING: every run spends Bright Data quota (5,000 records/month free).
//
//   npm run test:amazon-search -- "electronic drum set"

import "dotenv/config";
import { isAmazonConfigured, searchAmazonProducts } from "./lib/scrapers/amazon.js";

async function main() {
  if (!isAmazonConfigured()) {
    console.error("BRIGHTDATA_API_KEY / BRIGHTDATA_AMAZON_DATASET_ID not set");
    process.exit(1);
  }

  const keyword = process.argv[2] ?? "electronic drum set";
  const result = await searchAmazonProducts(keyword, 5);

  if (result.status === "success") {
    console.log(`✅ ${result.data.length} results in ${result.durationMs}ms`);
    console.log(JSON.stringify(result.data, null, 2));
  } else {
    console.log(`❌ ${result.status} after ${result.durationMs}ms`);
    console.log(result.detail);
  }
}

main().catch(console.error);
