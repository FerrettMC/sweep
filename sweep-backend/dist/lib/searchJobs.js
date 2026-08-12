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
import { adapters } from "./scrapers/index.js";
/** Bright Data's own polling gives up around 200s; leave room past that. */
const JOB_TIMEOUT_MS = 240_000;
/** How long a finished job stays readable, so a slow client can still collect it. */
const JOB_TTL_MS = 10 * 60 * 1000;
const jobs = new Map();
/**
 * Kick off an Amazon search in the background and return its job id
 * immediately. Never throws — a failed job is a status, not an exception.
 */
export function startAmazonSearch(keyword, limit) {
    const id = crypto.randomUUID();
    const job = {
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
async function run(job, limit) {
    try {
        const result = await withTimeout(adapters.amazon.search(job.keyword, limit), JOB_TIMEOUT_MS);
        if (result.status === "success") {
            job.status = "success";
            job.products = result.data;
        }
        else {
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
    }
    catch (err) {
        job.status = "failed";
        job.detail = err instanceof Error ? err.message : String(err);
        await recordCheck({
            retailer: "amazon",
            status: "failed",
            detail: job.detail,
            durationMs: Date.now() - job.startedAt,
        });
    }
    finally {
        job.finishedAt = Date.now();
    }
}
export function getSearchJob(id) {
    return jobs.get(id) ?? null;
}
function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Amazon search timed out after ${ms / 1000}s`)), ms)),
    ]);
}
/** Drop finished jobs past their TTL, and abandon pending ones past the timeout. */
function sweepExpired() {
    const now = Date.now();
    for (const [id, job] of jobs) {
        const age = now - job.startedAt;
        if (job.finishedAt && now - job.finishedAt > JOB_TTL_MS)
            jobs.delete(id);
        else if (!job.finishedAt && age > JOB_TIMEOUT_MS + 30_000)
            jobs.delete(id);
    }
}
