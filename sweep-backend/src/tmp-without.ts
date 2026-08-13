import "dotenv/config";
import { searchWalmart } from "./lib/scrapers/walmart.js";
let ok = 0, blocked = 0;
for (let i = 0; i < 4; i++) {
  const r = await searchWalmart("airpods", 4);
  r.status === "success" ? ok++ : blocked++;
  console.log(`   attempt ${i + 1}: ${r.status}`);
  await new Promise((r) => setTimeout(r, 3000));
}
console.log(`WITHOUT Sentry: ${ok} ok, ${blocked} blocked`);
process.exit(0);
