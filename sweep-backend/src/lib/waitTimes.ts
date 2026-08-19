// lib/waitTimes.ts
//
// "Amazon usually takes about 40 seconds."
//
// A search fans out to several stores at once and they answer at wildly
// different speeds — the free APIs come back in a second or two, Amazon goes
// through a paid crawler and routinely takes half a minute. Progressive
// results already show each store as it lands, which fixed the feeling that
// the whole search was stuck. This fixes the remaining question, which is
// "is it stuck, or is that one just slow?".
//
// Costs nothing to produce: every scrape already writes a ScrapeCheck row with
// its durationMs, so this is a query against data we were keeping anyway.
//
// MEDIAN, not mean. One 240-second Amazon crawl drags an average somewhere no
// individual search has ever been, and the number is meant to answer "what
// usually happens", which is what a median is.

import { prisma } from "./prisma.js";
import type { Retailer } from "./scrapers/types.js";

/**
 * How far back to look.
 *
 * Long enough to survive a quiet night, short enough that a retailer which has
 * genuinely got slower stops being described by last month's good behaviour.
 */
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Fewer samples than this and we say nothing.
 *
 * Two lucky calls are not a typical time, and "usually 3 seconds" followed by
 * a 40-second wait is worse than having said nothing at all.
 */
const MIN_SAMPLES = 5;

export type WaitTimes = Partial<Record<Retailer, number>>;

/**
 * Median successful SEARCH duration per retailer, in seconds.
 *
 * Only searches: product checks go through a different code path with
 * different timeouts, and mixing them would describe neither. They're
 * separable because a product check records the productId it was for and a
 * search has none.
 *
 * Only successes: a failure is usually a timeout sitting at whatever ceiling
 * we set, so including them would report our own patience rather than the
 * store's speed.
 */
export async function typicalSearchSeconds(): Promise<WaitTimes> {
  const since = new Date(Date.now() - WINDOW_MS);

  // percentile_cont in the database rather than pulling every row back to
  // sort in memory. A week of checks is a lot of rows to move to compute one
  // number per store.
  const rows = await prisma.$queryRaw<
    { retailer: string; median: number | null; samples: bigint }[]
  >`
    SELECT
      "retailer",
      percentile_cont(0.5) WITHIN GROUP (ORDER BY "durationMs") AS median,
      COUNT(*) AS samples
    FROM "ScrapeCheck"
    WHERE "productId" IS NULL
      AND "status" = 'success'
      AND "durationMs" IS NOT NULL
      AND "checkedAt" >= ${since}
    GROUP BY "retailer"
  `;

  const out: WaitTimes = {};
  for (const row of rows) {
    if (Number(row.samples) < MIN_SAMPLES || row.median === null) continue;
    const seconds = Math.round(Number(row.median) / 1000);
    // Sub-second stores round to zero, which reads as broken. Anything this
    // fast doesn't need a warning anyway, so it simply isn't given one.
    if (seconds < 1) continue;
    out[row.retailer as Retailer] = seconds;
  }
  return out;
}
