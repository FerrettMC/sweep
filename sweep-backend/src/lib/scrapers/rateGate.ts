// lib/scrapers/rateGate.ts
//
// A hard ceiling on how fast we talk to any one retailer.
//
// This exists because pacing used to live in ONE caller — the scheduler's batch
// checker — and every other path went straight past it. Compiled search, Deal
// Radar, "Sweep this deal", pasting a link and drop re-verification all called
// the adapters directly, so on a busy minute the real outbound rate was
// "however many users happened to be active", with nothing bounding it.
//
// Putting the gate inside the adapters instead means there is no way to reach a
// retailer without going through it. A new feature that scrapes gets the limit
// for free rather than needing to remember.
//
// Two knobs per retailer, because they defend against different things:
//
//   maxConcurrent  — how many requests may be in flight at once. Bot detection
//                    notices parallelism more than volume.
//   minIntervalMs  — the floor between consecutive requests. Shared across all
//                    workers, so it's a true per-retailer rate, not per-caller.
//
// Requests queue rather than fail. A search that waits 200ms is fine; a search
// that returns "blocked" because we hammered the site is not.

import type { Retailer } from "./types.js";

export interface GateLimits {
  maxConcurrent: number;
  minIntervalMs: number;
}

/**
 * Measured or conservative, per retailer.
 *
 * Amazon and eBay are deliberately looser: Amazon goes through Bright Data,
 * which absorbs blocking and bills per call, and eBay is an official API with
 * its own published quota. The four we scrape ourselves are the ones that can
 * quietly start refusing us.
 *
 * Nothing here exceeds ~3 requests/second, well under the 10/s the retailers
 * would plausibly tolerate — the cost of being slow is latency on a rare path,
 * and the cost of being fast is losing a store for hours.
 */
const LIMITS: Record<Retailer, GateLimits> = {
  // Bright Data handles the blocking; the real constraint is spend.
  amazon: { maxConcurrent: 2, minIntervalMs: 0 },
  // Serves "Robot or human?" under burst. Reputation-sensitive.
  walmart: { maxConcurrent: 2, minIntervalMs: 400 },
  // Product pages already refuse datacenter IPs; the search path is all we have.
  bestbuy: { maxConcurrent: 1, minIntervalMs: 700 },
  // Official API with a documented quota.
  ebay: { maxConcurrent: 4, minIntervalMs: 0 },
  newegg: { maxConcurrent: 2, minIntervalMs: 400 },
  // Etsy publish 5 queries/second and 5,000/day. 250ms is 4/s — deliberately
  // under the ceiling rather than exactly on it, since a burst that lands in
  // the same second as a scheduled check would otherwise tip us over.
  etsy: { maxConcurrent: 2, minIntervalMs: 250 },
  asos: { maxConcurrent: 2, minIntervalMs: 400 },
};

interface Lane {
  active: number;
  nextAllowedAt: number;
  queue: (() => void)[];
}

const lanes = new Map<Retailer, Lane>();

function laneFor(retailer: Retailer): Lane {
  let lane = lanes.get(retailer);
  if (!lane) {
    lane = { active: 0, nextAllowedAt: 0, queue: [] };
    lanes.set(retailer, lane);
  }
  return lane;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `work` against `retailer`, waiting for a slot first.
 *
 * Failures still release the slot — an adapter that throws must not wedge the
 * lane shut for everything behind it.
 */
export async function throttled<T>(retailer: Retailer, work: () => Promise<T>): Promise<T> {
  const limits = LIMITS[retailer];
  const lane = laneFor(retailer);

  if (lane.active >= limits.maxConcurrent) {
    await new Promise<void>((resolve) => lane.queue.push(resolve));
  }
  lane.active++;

  try {
    // Claimed before awaiting, so two callers can't both see the same slot and
    // fire together — the gap has to hold across concurrent workers, not just
    // sequential ones.
    const now = Date.now();
    const waitUntil = Math.max(now, lane.nextAllowedAt);
    lane.nextAllowedAt = waitUntil + limits.minIntervalMs;
    if (waitUntil > now) await sleep(waitUntil - now);

    return await work();
  } finally {
    lane.active--;
    lane.queue.shift()?.();
  }
}

/** Current ceiling per retailer, for tests and diagnostics. */
export function gateLimits(): Record<Retailer, GateLimits & { maxPerSecond: number }> {
  const out = {} as Record<Retailer, GateLimits & { maxPerSecond: number }>;
  for (const [retailer, limits] of Object.entries(LIMITS) as [Retailer, GateLimits][]) {
    out[retailer] = {
      ...limits,
      // The interval is the binding constraint whenever it's set; concurrency
      // only matters when requests are free to overlap.
      maxPerSecond: limits.minIntervalMs > 0 ? 1000 / limits.minIntervalMs : Infinity,
    };
  }
  return out;
}
