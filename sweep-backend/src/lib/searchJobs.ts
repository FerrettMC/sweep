// lib/searchJobs.ts
//
// Amazon is slow in a way the other retailers aren't. Bright Data's free tier
// answers with a snapshot id and we poll it — in practice that means anywhere
// from a few seconds to ~3 minutes, while Walmart/Best Buy/eBay all come back
// inside ~5s.
//
// So a compiled search does NOT wait for Amazon. It returns the fast retailers
// straight away and hands back a job id; the client polls that separately and
// fills the Amazon column in when it lands.
//
// Deliberately in-memory: a job is only interesting for the couple of minutes
// its client is watching it, and a dropped job on restart costs the user
// nothing but a re-run. If this ever runs multi-instance, jobs would need to
// move to Postgres or Redis so a poll can't hit the wrong instance.

import { recordCheck } from "./health.js";
import { cacheSearchResults } from "./priceChecker.js";
import { adapters } from "./scrapers/index.js";
import type { Retailer, ScrapedProduct } from "./scrapers/types.js";

export type SearchJobStatus = "pending" | "success" | "failed" | "blocked";

export interface SearchJob {
  id: string;
  keyword: string;
  status: SearchJobStatus;
  products: ScrapedProduct[];
  detail: string | null;
  startedAt: number;
  finishedAt: number | null;
}

/** Bright Data's own polling gives up around 200s; leave room past that. */
const JOB_TIMEOUT_MS = 240_000;
/** How long a finished job stays readable, so a slow client can still collect it. */
const JOB_TTL_MS = 10 * 60 * 1000;

const jobs = new Map<string, SearchJob>();

/**
 * Kick off an Amazon search in the background and return its job id
 * immediately. Never throws — a failed job is a status, not an exception.
 */
export function startAmazonSearch(keyword: string, limit: number): string {
  const id = crypto.randomUUID();

  const job: SearchJob = {
    id,
    keyword,
    status: "pending",
    products: [],
    detail: null,
    startedAt: Date.now(),
    finishedAt: null,
  };

  jobs.set(id, job);
  sweepExpired();

  void run(job, limit);

  return id;
}

async function run(job: SearchJob, limit: number) {
  try {
    const result = await withTimeout(
      adapters.amazon.search(job.keyword, limit),
      JOB_TIMEOUT_MS,
    );

    if (result.status === "success") {
      job.status = "success";
      job.products = result.data;
      // Cache here rather than in the polling route, so results are kept even
      // if the client gives up waiting before Bright Data comes back.
      await cacheSearchResults(result.data);
    } else {
      job.status = result.status;
      job.detail = result.detail;
    }

    // Feeds the health board like any other scrape, even though it finished
    // long after the request that started it.
    await recordCheck({
      retailer: "amazon",
      status: result.status,
      detail: result.status === "success" ? null : result.detail,
      durationMs: result.durationMs,
    });
  } catch (err) {
    job.status = "failed";
    job.detail = err instanceof Error ? err.message : String(err);
    await recordCheck({
      retailer: "amazon",
      status: "failed",
      detail: job.detail,
      durationMs: Date.now() - job.startedAt,
    });
  } finally {
    job.finishedAt = Date.now();
  }
}

export function getSearchJob(id: string): SearchJob | null {
  return jobs.get(id) ?? null;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Amazon search timed out after ${ms / 1000}s`)), ms),
    ),
  ]);
}

/** Drop finished jobs past their TTL, and abandon pending ones past the timeout. */
function sweepExpired() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    const age = now - job.startedAt;
    if (job.finishedAt && now - job.finishedAt > JOB_TTL_MS) jobs.delete(id);
    else if (!job.finishedAt && age > JOB_TIMEOUT_MS + 30_000) jobs.delete(id);
  }
}


// ---- multi-retailer jobs ---------------------------------------------------
//
// The same idea as the Amazon job above, applied to every store.
//
// Waiting for the slowest retailer before showing anything makes a search feel
// as slow as its worst participant: eBay answers in under two seconds and the
// user stared at a spinner because Best Buy was still timing out. Each store
// now lands on its own, and the client renders it the moment it does.
//
// Retailers run concurrently and independently — one failing or hanging has no
// effect on the others beyond its own row saying so.

export interface RetailerSlot {
  retailer: Retailer;
  status: SearchJobStatus;
  products: ScrapedProduct[];
  detail: string | null;
  durationMs: number | null;
}

export interface MultiSearchJob {
  id: string;
  keyword: string;
  slots: Map<Retailer, RetailerSlot>;
  startedAt: number;
  /** Set once every slot has settled, so callers can stop polling. */
  finishedAt: number | null;
  /** Called once, when the last retailer settles. */
  onComplete?: (job: MultiSearchJob) => void | Promise<void>;
}

const multiJobs = new Map<string, MultiSearchJob>();

/** Generous: a slot that hangs is capped by the adapter's own deadline anyway. */
const SLOT_TIMEOUT_MS = 30_000;

export function startMultiSearch(
  keyword: string,
  limit: number,
  retailers: Retailer[],
  onComplete?: (job: MultiSearchJob) => void | Promise<void>,
): MultiSearchJob {
  const job: MultiSearchJob = {
    id: crypto.randomUUID(),
    keyword,
    slots: new Map(
      retailers.map((retailer) => [
        retailer,
        { retailer, status: "pending", products: [], detail: null, durationMs: null },
      ]),
    ),
    startedAt: Date.now(),
    finishedAt: null,
    onComplete,
  };

  multiJobs.set(job.id, job);
  sweepExpiredMulti();

  for (const retailer of retailers) void runSlot(job, retailer, limit);
  // Nothing to wait for; settle immediately so a caller isn't left polling.
  if (retailers.length === 0) void settle(job);

  return job;
}

async function runSlot(job: MultiSearchJob, retailer: Retailer, limit: number) {
  const slot = job.slots.get(retailer)!;
  const started = Date.now();

  try {
    const result = await withTimeout(
      adapters[retailer].search(job.keyword, limit),
      SLOT_TIMEOUT_MS,
    );

    if (result.status === "success") {
      slot.status = "success";
      slot.products = result.data;
      // Cached per slot rather than at the end, so a user who navigates away
      // still leaves the catalogue better off than they found it.
      await cacheSearchResults(result.data);
    } else {
      slot.status = result.status;
      slot.detail = result.detail;
    }
    slot.durationMs = result.durationMs;

    await recordCheck({
      retailer,
      status: result.status,
      detail: result.status === "success" ? null : result.detail,
      durationMs: result.durationMs,
    });
  } catch (err) {
    slot.status = "failed";
    slot.detail = err instanceof Error ? err.message : String(err);
    slot.durationMs = Date.now() - started;
    await recordCheck({
      retailer,
      status: "failed",
      detail: slot.detail,
      durationMs: slot.durationMs,
    });
  } finally {
    await settle(job);
  }
}

async function settle(job: MultiSearchJob) {
  if (job.finishedAt) return;
  const pending = [...job.slots.values()].some((s) => s.status === "pending");
  if (pending) return;

  job.finishedAt = Date.now();
  // Runs once, and must never take the job down with it.
  try {
    await job.onComplete?.(job);
  } catch (err) {
    console.error("[searchJobs] onComplete threw:", err);
  }
}

export function getMultiSearch(id: string): MultiSearchJob | null {
  return multiJobs.get(id) ?? null;
}

/** Everything found so far, across settled slots. */
export function productsSoFar(job: MultiSearchJob): ScrapedProduct[] {
  return [...job.slots.values()].flatMap((s) => s.products);
}

function sweepExpiredMulti() {
  const now = Date.now();
  for (const [id, job] of multiJobs) {
    const age = now - job.startedAt;
    if (job.finishedAt && now - job.finishedAt > JOB_TTL_MS) multiJobs.delete(id);
    else if (!job.finishedAt && age > SLOT_TIMEOUT_MS + 60_000) multiJobs.delete(id);
  }
}
