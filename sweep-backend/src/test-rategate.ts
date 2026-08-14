// src/test-rategate.ts — proves no retailer can be hit faster than its ceiling.
//   npm run test:ratelimit
//
// Tests the gate itself rather than going through the adapters, because
// stubbing an adapter REPLACES the throttled wrapper and would measure nothing.
// The wiring is asserted separately.
import { adapters, unthrottledAdapters } from "./lib/scrapers/index.js";
import { gateLimits, throttled } from "./lib/scrapers/rateGate.js";
import { RETAILERS, type Retailer } from "./lib/scrapers/types.js";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, d?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${l}`);
  if (!ok && d !== undefined) console.log("     ", JSON.stringify(d));
};

const limits = gateLimits();
console.log("configured ceilings:\n");
for (const [r, l] of Object.entries(limits)) {
  const rate = l.maxPerSecond === Infinity ? "unpaced (proxied / official API)" : `${l.maxPerSecond.toFixed(1)}/s`;
  console.log(`  ${r.padEnd(9)} concurrent=${l.maxConcurrent}  gap=${l.minIntervalMs}ms  -> ${rate}`);
}

console.log("\n— every adapter is actually wrapped —");
for (const r of RETAILERS) {
  check(
    `${r}: search and scrapeProduct go through the gate`,
    adapters[r].search !== unthrottledAdapters[r].search &&
      adapters[r].scrapeProduct !== unthrottledAdapters[r].scrapeProduct,
  );
}

console.log("\n— measured rate under a burst —");
async function measure(retailer: Retailer, n: number) {
  const stamps: number[] = [];
  const started = Date.now();
  await Promise.all(
    Array.from({ length: n }, () =>
      throttled(retailer, async () => {
        stamps.push(Date.now());
        await new Promise((r) => setTimeout(r, 5));
      }),
    ),
  );
  stamps.sort((a, b) => a - b);
  let tightest = Infinity;
  for (let i = 1; i < stamps.length; i++) tightest = Math.min(tightest, stamps[i] - stamps[i - 1]);
  return { perSecond: n / ((Date.now() - started) / 1000), tightest };
}

for (const retailer of ["walmart", "bestbuy", "newegg", "asos"] as Retailer[]) {
  const { perSecond, tightest } = await measure(retailer, 8);
  const expected = limits[retailer].minIntervalMs;
  check(
    `${retailer}: 8 at once -> ${perSecond.toFixed(1)}/s, tightest gap ${tightest}ms (floor ${expected}ms)`,
    perSecond <= 10 && tightest >= expected - 60,
    { perSecond, tightest, expected },
  );
}

console.log("\n— the gap holds across concurrent callers, not just sequential ones —");
const { tightest } = await measure("walmart", 4);
check(`four simultaneous callers still ${tightest}ms apart`, tightest >= 340, { tightest });

console.log("\n— a throwing call releases its slot —");
await Promise.allSettled(
  Array.from({ length: 3 }, () => throttled("asos", async () => { throw new Error("boom"); })),
);
const after = await measure("asos", 2);
check("lane still works after failures", Number.isFinite(after.perSecond), after);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
