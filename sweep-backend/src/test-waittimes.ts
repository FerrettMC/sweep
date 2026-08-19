// test-waittimes.ts — "Amazon usually takes about 40 seconds".
//   npm run test:waittimes
//
// Runs on the DEV database. The number is shown to someone deciding whether to
// keep waiting, so the ways it can mislead are what's tested: an average
// dragged by one bad crawl, our own timeouts reported as the store's speed,
// and a confident figure built on two samples.
import "./testEnv.js";
import { prisma } from "./lib/prisma.js";
import { typicalSearchSeconds } from "./lib/waitTimes.js";

let pass = 0,
  fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok && detail !== undefined) console.log("     ", JSON.stringify(detail).slice(0, 300));
};

// Only these retailers are touched, so anything already on the dev database
// for other stores can't affect the assertions.
const AMAZON = "amazon";
const ETSY = "etsy";
const NEWEGG = "newegg";
const ASOS = "asos";
const TOUCHED = [AMAZON, ETSY, NEWEGG, ASOS];

async function wipe() {
  await prisma.scrapeCheck.deleteMany({ where: { retailer: { in: TOUCHED } } });
}

async function record(
  retailer: string,
  durationMs: number,
  opts: { status?: string; productId?: string | null } = {},
) {
  await prisma.scrapeCheck.create({
    data: {
      retailer,
      status: opts.status ?? "success",
      durationMs,
      productId: opts.productId ?? null,
      checkedAt: new Date(),
    },
  });
}

try {
  await wipe();

  // Median 20s. The mean would be 56s, dragged by one bad crawl — a number no
  // individual search has ever taken.
  for (const ms of [18_000, 19_000, 20_000, 21_000, 240_000]) {
    await record(AMAZON, ms);
  }
  // Comfortably above the sample floor, all quick.
  for (const ms of [1_000, 1_100, 1_200, 1_300, 1_400, 1_500]) {
    await record(ETSY, ms);
  }

  const times = await typicalSearchSeconds();

  console.log("\n— the median, not the mean —");
  check("amazon reports 20s, not the 56s average", times.amazon === 20, times.amazon);
  check("etsy reports its own median", times.etsy === 1, times.etsy);

  console.log("\n— our timeouts are not the store's speed —");
  // A failure usually sits at whatever ceiling we set, so counting it would
  // report our patience rather than how fast the retailer is.
  await wipe();
  for (const ms of [2_000, 2_000, 2_000, 2_000, 2_000]) await record(NEWEGG, ms);
  for (let i = 0; i < 20; i++) await record(NEWEGG, 240_000, { status: "failed" });
  for (let i = 0; i < 20; i++) await record(NEWEGG, 240_000, { status: "blocked" });
  check(
    "failed and blocked checks are ignored",
    (await typicalSearchSeconds()).newegg === 2,
    (await typicalSearchSeconds()).newegg,
  );

  console.log("\n— product checks are a different question —");
  // They run through another path with different timeouts. Mixing them would
  // describe neither accurately.
  await wipe();
  const product = await prisma.product.create({
    data: {
      retailer: ASOS,
      retailerId: `waittest-${Date.now()}`,
      url: "https://example.com/waittest",
      title: "Wait test",
      currentPrice: 1000,
    },
  });
  for (let i = 0; i < 10; i++) {
    await record(ASOS, 90_000, { productId: product.id });
  }
  check(
    "a store with only product checks reports no search time",
    (await typicalSearchSeconds()).asos === undefined,
    (await typicalSearchSeconds()).asos,
  );
  await prisma.product.delete({ where: { id: product.id } });

  console.log("\n— silence beats a guess —");
  await wipe();
  for (const ms of [30_000, 30_000, 30_000, 30_000]) await record(AMAZON, ms);
  check(
    "four samples is not enough to claim a typical time",
    (await typicalSearchSeconds()).amazon === undefined,
    (await typicalSearchSeconds()).amazon,
  );
  await record(AMAZON, 30_000);
  check("five is", (await typicalSearchSeconds()).amazon === 30);

  console.log("\n— sub-second stores say nothing —");
  // Rounding to "usually 0 seconds" reads as broken, and a store that fast
  // doesn't need a warning.
  await wipe();
  for (let i = 0; i < 8; i++) await record(ETSY, 300);
  check(
    "a store faster than a second is left out",
    (await typicalSearchSeconds()).etsy === undefined,
    (await typicalSearchSeconds()).etsy,
  );

  console.log("\n— stale data doesn't describe today —");
  await wipe();
  for (let i = 0; i < 8; i++) {
    await prisma.scrapeCheck.create({
      data: {
        retailer: AMAZON,
        status: "success",
        durationMs: 5_000,
        checkedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      },
    });
  }
  check(
    "checks from a month ago are outside the window",
    (await typicalSearchSeconds()).amazon === undefined,
    (await typicalSearchSeconds()).amazon,
  );
} finally {
  await wipe();
  await prisma.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
