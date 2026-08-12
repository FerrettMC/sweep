// src/test-amazon.ts
//
// Manual single-product check against Bright Data.
// WARNING: every run spends Bright Data quota (5,000 records/month free).
//
//   npm run test:amazon -- "https://www.amazon.com/dp/B0CXQ54SRK"

import "dotenv/config";
import { isAmazonConfigured, scrapeAmazonProduct } from "./lib/scrapers/amazon.js";

async function main() {
  if (!isAmazonConfigured()) {
    console.error("BRIGHTDATA_API_KEY / BRIGHTDATA_AMAZON_DATASET_ID not set");
    process.exit(1);
  }

  const testUrl =
    process.argv[2] ??
    "https://www.amazon.com/Alesis-Strata-Prime-Controller-Multi-Channel/dp/B0CXQ54SRK";

  console.log("Fetching:", testUrl);
  console.log("Using dataset ID:", process.env.BRIGHTDATA_AMAZON_DATASET_ID);

  const result = await scrapeAmazonProduct(testUrl);

  if (result.status === "success") {
    console.log(`✅ ${result.durationMs}ms`);
    console.log(JSON.stringify(result.data, null, 2));
  } else {
    console.log(`❌ ${result.status} after ${result.durationMs}ms`);
    console.log(result.detail);
  }
}

main().catch(console.error);
