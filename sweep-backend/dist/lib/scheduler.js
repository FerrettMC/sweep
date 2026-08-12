// lib/scheduler.ts
//
// Background jobs, running in-process alongside the Fastify server. That's the
// right call at this size — one Railway/Render service, no queue infra to run.
//
// The tradeoff to know about: if you ever scale to more than one instance,
// every instance runs these jobs and products get checked N times. Set
// SCHEDULER_ENABLED=false on all but one instance when that day comes.
import cron from "node-cron";
import { runHealthCheck } from "./health.js";
import { checkProducts, findDueProducts } from "./priceChecker.js";
import { notifyPriceDrop } from "./push.js";
/** Guard against a slow batch overlapping the next tick. */
let priceCheckRunning = false;
export function startScheduler() {
    if (process.env.SCHEDULER_ENABLED === "false") {
        console.log("[scheduler] disabled via SCHEDULER_ENABLED=false");
        return;
    }
    // Every 15 minutes. This is the *sweep* interval, not the check interval —
    // it wakes up, asks which products are actually due based on the tiers
    // tracking them, and checks only those. Ultimate's 30-minute promise needs a
    // sweep at least twice that often to be honoured on time.
    cron.schedule("*/15 * * * *", runPriceChecks);
    // Health sweep runs on its own cadence, half an hour offset from the price
    // checks so it reports on a window that has actually filled up.
    cron.schedule("30 * * * *", async () => {
        try {
            const report = await runHealthCheck();
            const unhealthy = report.filter((r) => !r.healthy);
            if (unhealthy.length > 0) {
                console.warn("[scheduler] unhealthy retailers:", unhealthy.map((r) => `${r.retailer} ${Math.round(r.failureRate * 100)}%`).join(", "));
            }
        }
        catch (err) {
            console.error("[scheduler] health check threw:", err);
        }
    });
    console.log("[scheduler] started — price checks every 15m, health sweep hourly");
}
export async function runPriceChecks() {
    if (priceCheckRunning) {
        console.warn("[scheduler] previous price check still running, skipping tick");
        return;
    }
    priceCheckRunning = true;
    const started = Date.now();
    try {
        const due = await findDueProducts();
        if (due.length === 0)
            return;
        console.log(`[scheduler] checking ${due.length} products`);
        const outcomes = await checkProducts(due);
        const succeeded = outcomes.filter((o) => o.status === "success").length;
        const changed = outcomes.filter((o) => o.status === "success" && o.newPrice !== o.previousPrice);
        console.log(`[scheduler] ${succeeded}/${outcomes.length} ok, ${changed.length} price changes, ${Date.now() - started}ms`);
        // Price drops fan out to push notifications here. XP awards and the
        // "Best Deals Found" feed hook in at the same point, next pass.
        for (const drop of changed) {
            if (drop.newPrice === null ||
                drop.previousPrice === null ||
                drop.newPrice >= drop.previousPrice) {
                continue;
            }
            console.log(`[scheduler] DROP ${drop.productId}: ${drop.previousPrice} → ${drop.newPrice}`);
            try {
                const sent = await notifyPriceDrop({
                    productId: drop.productId,
                    previousPrice: drop.previousPrice,
                    newPrice: drop.newPrice,
                });
                if (sent > 0)
                    console.log(`[scheduler] notified ${sent} device(s)`);
            }
            catch (err) {
                // A push failure must not abort the rest of the batch — the price is
                // already saved, and that's the part that matters.
                console.error(`[scheduler] push failed for ${drop.productId}:`, err);
            }
        }
    }
    catch (err) {
        console.error("[scheduler] price check threw:", err);
    }
    finally {
        priceCheckRunning = false;
    }
}
