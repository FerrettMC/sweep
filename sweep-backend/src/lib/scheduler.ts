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
import { recordDeal } from "./deals.js";
import { notifyPriceDrop, notifyRadarMatch } from "./push.js";
import { runRadar } from "./dealRadar.js";
import { prisma } from "./prisma.js";
import { effectiveIntervalMinutes } from "./backoff.js";
import { TIER_LIMITS, limitsFor } from "./tiers.js";
import { verifyDrop } from "./verifyDrop.js";
import { awardDealFound } from "./xp.js";

/** Guard against a slow batch overlapping the next tick. */
let priceCheckRunning = false;

export function startScheduler() {
  if (process.env.SCHEDULER_ENABLED === "false") {
    console.log("[scheduler] disabled via SCHEDULER_ENABLED=false");
    return;
  }

  // Every 5 minutes. This is the *sweep* interval, not the check interval — it
  // wakes up, asks which products are actually due, and checks only those.
  //
  // It has to be well below the finest scheduling granularity we offer, or a
  // user who asks for checks at :35 gets them at "somewhere in the following
  // quarter hour", which makes the setting a lie.
  cron.schedule("*/5 * * * *", runPriceChecks);

  // Radars run on their own sweep. Deliberately offset from the price checks
  // so the two most expensive jobs in the app don't fire in the same minute.
  cron.schedule("2-59/10 * * * *", runRadarChecks);

  // Health sweep runs on its own cadence, half an hour offset from the price
  // checks so it reports on a window that has actually filled up.
  cron.schedule("30 * * * *", async () => {
    try {
      const report = await runHealthCheck();
      const unhealthy = report.filter((r) => !r.healthy);
      if (unhealthy.length > 0) {
        console.warn(
          "[scheduler] unhealthy retailers:",
          unhealthy.map((r) => `${r.retailer} ${Math.round(r.failureRate * 100)}%`).join(", "),
        );
      }
    } catch (err) {
      console.error("[scheduler] health check threw:", err);
    }
  });

  console.log(
    "[scheduler] started — price checks every 5m, radars every 10m, health sweep hourly",
  );
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
    if (due.length === 0) return;

    console.log(`[scheduler] checking ${due.length} products`);
    const outcomes = await checkProducts(due);

    const succeeded = outcomes.filter((o) => o.status === "success").length;
    const changed = outcomes.filter(
      (o) => o.status === "success" && o.newPrice !== o.previousPrice,
    );

    console.log(
      `[scheduler] ${succeeded}/${outcomes.length} ok, ${changed.length} price changes, ${Date.now() - started}ms`,
    );

    // Price drops fan out to push notifications here. XP awards and the
    // "Best Deals Found" feed hook in at the same point, next pass.
    for (const drop of changed) {
      if (
        drop.newPrice === null ||
        drop.previousPrice === null ||
        drop.newPrice >= drop.previousPrice
      ) {
        continue;
      }

      console.log(
        `[scheduler] DROP ${drop.productId}: ${drop.previousPrice} → ${drop.newPrice}`,
      );

      try {
        // A drop this steep is usually a parse error, not a deal. Confirm it
        // before it becomes XP, a public feed post, and a push notification —
        // all three are hard to walk back once sent.
        const verdict = await verifyDrop({
          productId: drop.productId,
          previousPrice: drop.previousPrice,
          newPrice: drop.newPrice,
        });
        if (!verdict.believable) {
          console.warn(
            `[scheduler] SUPPRESSED implausible drop ${drop.productId}: ${verdict.reason} (${verdict.detail})`,
          );
          continue;
        }
        if (verdict.reason === "confirmed-by-recheck") {
          console.log(`[scheduler] steep drop confirmed by re-check ${drop.productId}`);
        }

        // XP first: it's computed from our own price history and is the thing
        // the leaderboard depends on, so it shouldn't be skipped if push
        // happens to fail.
        const awards = await awardDealFound({
          productId: drop.productId,
          newPrice: drop.newPrice,
        });
        if (awards.length > 0) {
          console.log(
            `[scheduler] XP: ${awards.length} user(s) earned ${awards[0].award.xp} — ${awards[0].award.detail}`,
          );
        }

        // Same drop, same data — record it on the public feed if it clears
        // the (higher) bar for being worth showing strangers.
        const deal = await recordDeal({
          productId: drop.productId,
          previousPrice: drop.previousPrice,
          newPrice: drop.newPrice,
        });
        if (deal) {
          console.log(
            `[scheduler] FEED: ${deal.percentBelowAverage}% below average`,
          );
        }

        const sent = await notifyPriceDrop({
          productId: drop.productId,
          previousPrice: drop.previousPrice,
          newPrice: drop.newPrice,
        });
        if (sent > 0) console.log(`[scheduler] notified ${sent} device(s)`);
      } catch (err) {
        // A push failure must not abort the rest of the batch — the price is
        // already saved, and that's the part that matters.
        console.error(`[scheduler] push failed for ${drop.productId}:`, err);
      }
    }
  } catch (err) {
    console.error("[scheduler] price check threw:", err);
  } finally {
    priceCheckRunning = false;
  }
}


// ---- deal radar ------------------------------------------------------------

let radarCheckRunning = false;

/**
 * Re-run the standing searches that are due, and notify on genuinely new bests.
 *
 * Only tiers with a scheduled interval appear here at all — free radars carry a
 * far-future nextCheckAt and are run by hand, which is what keeps their cost
 * from scaling with signups.
 *
 * Uses the same adaptive backoff as tracked products: a search that keeps
 * turning up nothing new gets slower, and snaps back to full rate the moment it
 * finds something. Most radars watch for a price that isn't coming this week.
 */
export async function runRadarChecks() {
  if (radarCheckRunning) {
    console.log("[radar] previous sweep still running, skipping");
    return;
  }
  radarCheckRunning = true;
  const started = Date.now();

  try {
    const due = await prisma.savedSearch.findMany({
      where: { nextCheckAt: { lte: new Date() } },
      include: { user: { include: { wallet: true } } },
      take: 50,
    });
    if (due.length === 0) return;

    console.log(`[radar] running ${due.length} saved search(es)`);

    for (const saved of due) {
      try {
        const limits = saved.user.wallet
          ? limitsFor(saved.user.wallet)
          : TIER_LIMITS.free;

        // Tier may have lapsed since the radar was created. Park it rather than
        // deleting — downgrades shouldn't destroy what someone set up.
        if (limits.savedSearchIntervalMinutes === 0) {
          await prisma.savedSearch.update({
            where: { id: saved.id },
            data: { nextCheckAt: new Date("2999-01-01") },
          });
          continue;
        }

        const run = await runRadar(saved);

        const foundSomethingNew = run.isNewBest;
        const gap = effectiveIntervalMinutes(
          limits.savedSearchIntervalMinutes,
          foundSomethingNew ? 0 : saved.unchangedChecks + 1,
        );

        await prisma.savedSearch.update({
          where: { id: saved.id },
          data: {
            lastCheckedAt: new Date(),
            nextCheckAt: new Date(Date.now() + gap * 60_000),
            unchangedChecks: foundSomethingNew ? 0 : saved.unchangedChecks + 1,
            ...(run.best
              ? {
                  lastMatchAt: new Date(),
                  lastBestPrice:
                    saved.lastBestPrice === null
                      ? run.best.price
                      : Math.min(saved.lastBestPrice, run.best.price),
                }
              : {}),
          },
        });

        if (foundSomethingNew && run.best) {
          const sent = await notifyRadarMatch({
            userId: saved.userId,
            keyword: saved.keyword,
            price: run.best.price,
            retailerLabel: run.best.retailerLabel,
            title: run.best.title,
            searchId: saved.id,
            targetPrice: saved.targetPrice,
          });
          if (sent > 0) {
            await prisma.savedSearch.update({
              where: { id: saved.id },
              data: { lastNotifiedAt: new Date() },
            });
            console.log(
              `[radar] "${saved.keyword}" → ${run.best.price} at ${run.best.retailerLabel}, notified ${sent}`,
            );
          }
        }
      } catch (err) {
        // One bad search must not stall the rest of the sweep.
        console.error(`[radar] "${saved.keyword}" threw:`, err);
      }
    }

    console.log(`[radar] sweep done in ${Date.now() - started}ms`);
  } catch (err) {
    console.error("[radar] sweep threw:", err);
  } finally {
    radarCheckRunning = false;
  }
}
