// routes/search.ts
//
// Compiled multi-site search — the core onboarding flow. One query, results
// from all five retailers side by side, tap to track.
//
// This is the most expensive endpoint in the app (five scrapes, one of them
// metered), so the quota check happens before any work starts, and it is
// spent even if some retailers fail — otherwise a partial outage would make
// searches free.

import type { FastifyInstance } from "fastify";
import { verifySsvCallback } from "../lib/admobSsv.js";
import { optionalAuth, requireAuth } from "../lib/auth.js";
import { cooldownRemaining } from "../lib/scrapers/cooldown.js";
import { recordCheck } from "../lib/health.js";
import { pickHighlights } from "../lib/highlights.js";
import { cacheSearchResults } from "../lib/priceChecker.js";
import { refundGuestSearch, refundUserSearch } from "../lib/quota.js";
import { SCRAPE_LIMIT, SENSITIVE_LIMIT } from "../lib/rateLimit.js";
import { prisma } from "../lib/prisma.js";
import {
  consumeGuestIpSearch,
  consumeGuestSearch,
  consumeUserSearch,
  getGuestQuota,
  getUserQuota,
  grantRewardedSearch,
} from "../lib/quota.js";
import {
  isRetailerEnabled,
  routeQuery,
  searchAllRetailers,
} from "../lib/scrapers/index.js";
import {
  RETAILERS,
  RETAILER_LABELS,
  type Retailer,
  isRetailer,
} from "../lib/scrapers/types.js";
import { getSearchJob, startAmazonSearch } from "../lib/searchJobs.js";
import { TIER_LIMITS, effectiveTier, limitsFor } from "../lib/tiers.js";

const MAX_KEYWORD_LENGTH = 120;
/** Fallback for callers with no wallet (guests). */
const RESULTS_PER_RETAILER = 4;

/**
 * How many results this search should return per store.
 *
 * Clamped to the tier's range server-side. The client sends a preference, not
 * an instruction — a request for 20 results from a free account would be a
 * request to spend someone else's money, since Bright Data bills per Amazon
 * result.
 */
function resolveResultCount(
  requested: unknown,
  limits: { resultsPerRetailer: { min: number; max: number; default: number } },
): number {
  const range = limits.resultsPerRetailer;
  const asked = Number(requested);
  if (!Number.isFinite(asked)) return range.default;
  return Math.min(range.max, Math.max(range.min, Math.round(asked)));
}

export async function searchRoutes(app: FastifyInstance) {
  // ---- compiled search ----
  app.get(
    "/search",
    {
      preHandler: optionalAuth,
      config: { rateLimit: SCRAPE_LIMIT },
    },
    async (request, reply) => {
      const query = (request.query ?? {}) as {
        q?: string;
        retailers?: string;
        results?: string;
      };

      const keyword = (query.q ?? "").trim();
      if (!keyword) {
        return reply.status(400).send({ error: "Missing search term" });
      }
      if (keyword.length > MAX_KEYWORD_LENGTH) {
        return reply.status(400).send({
          error: `Search term must be ${MAX_KEYWORD_LENGTH} characters or fewer`,
        });
      }

      // Optional retailer filter, so a client can re-run just the tile that
      // failed without spending a fresh search on all five.
      const only = parseRetailers(query.retailers);
      if (only === "invalid") {
        return reply.status(400).send({ error: "Unknown retailer in filter" });
      }

      const userId = request.userId;
      const deviceId = request.guestDeviceId;

      if (!userId && !deviceId) {
        return reply.status(401).send({
          error: "Sign in or send a device id to search.",
          code: "IDENTIFY_REQUIRED",
        });
      }

      // Guests are also counted per network, because the device id above is
      // just a header they chose. Without this, rotating it mints unlimited
      // search quota and every search costs an Amazon credit.
      if (!userId) {
        const network = await consumeGuestIpSearch(request.ip);
        if (!network.allowed) {
          return reply.status(429).send({
            error:
              "This network has used its guest searches for today. Sign up for your own allowance.",
            code: "NETWORK_LIMIT_REACHED",
          });
        }
      }

      // Spend the quota first. If this returns null the user is out of budget
      // and no scraping happens at all.
      const quota = userId
        ? await consumeUserSearch(userId)
        : await consumeGuestSearch(deviceId!);

      if (!quota) {
        const current = userId
          ? await getUserQuota(userId)
          : await getGuestQuota(deviceId!);

        return reply.status(429).send({
          error: userId
            ? "You've used all your searches for today."
            : "Guests get one search a day. Sign up for more.",
          code: "SEARCH_LIMIT_REACHED",
          quota: current,
          canWatchAd: current?.canWatchAd ?? false,
          isGuest: !userId,
        });
      }

      // Skip retailers that plainly don't sell what's being searched for — no
      // point asking a clothing site about earbuds. General stores are always
      // included, and an unclassifiable query includes everyone.
      const routing = routeQuery(keyword, only);

      // Amazon is split out of the synchronous path: Bright Data's free tier can
      // take up to ~3 minutes, and making the user stare at a spinner that long
      // for four retailers that answered in 3 seconds is the wrong trade.
      const requested = routing.retailers;
      const fastRetailers = requested.filter((r) => r !== "amazon");
      const wantsAmazon = requested.includes("amazon");

      // Guests have no wallet and no choice; the fallback is the free count.
      const searchWallet = userId
        ? await prisma.wallet.findUnique({ where: { userId } })
        : null;
      const perRetailer = searchWallet
        ? resolveResultCount(query.results, limitsFor(searchWallet))
        : RESULTS_PER_RETAILER;

      const amazonJobId = wantsAmazon
        ? startAmazonSearch(keyword, perRetailer)
        : null;

      const outcomes = await searchAllRetailers(keyword, perRetailer, fastRetailers);

      // Search results are real scrape outcomes, so they feed health monitoring
      // exactly like scheduled checks do. Without this, a retailer that only
      // breaks on search would stay invisible.
      await Promise.all(
        outcomes.map((o) =>
          recordCheck({
            retailer: o.retailer,
            status: o.status,
            detail: o.detail,
            durationMs: o.durationMs,
          }),
        ),
      );

      // Keep what we just scraped. Adding one of these to a list or tracking it
      // then needs no scrape at all — see cacheSearchResults.
      await cacheSearchResults(outcomes.flatMap((o) => o.products));

      // Nothing came back at all: give the search back. The allowance exists to
      // bound work we do on someone's behalf, not to charge them when every
      // store refused us. Amazon still running is not "nothing" — it may yet
      // return, so a pending job counts as a search that happened.
      const foundAnything = outcomes.some((o) => o.products.length > 0);
      if (!foundAnything && !amazonJobId) {
        if (userId) await refundUserSearch(userId, quota.resetsAt);
        else if (deviceId) await refundGuestSearch(deviceId, quota.resetsAt);
        quota.used = Math.max(0, quota.used - 1);
        quota.remaining = quota.remaining + 1;
      }

      return {
        keyword,
        quota,
        // The few results worth showing above the per-store columns. Computed
        // here so "cheapest" means the same thing everywhere, and so Amazon
        // arriving late can be folded into the same ranking client-side.
        highlights: pickHighlights(outcomes.flatMap((o) => o.products)),
        // What we decided the query was about, and who we skipped because of it.
        // Sent so the UI can explain an absent store rather than leaving a hole.
        categories: routing.categories,
        skipped: routing.skipped.map((retailer) => ({
          retailer,
          label: RETAILER_LABELS[retailer],
        })),
        // Present when Amazon is still running. The client polls
        // /search/amazon/:id and slots the results in when they arrive.
        amazonJobId,
        results: outcomes.map((outcome) => ({
          retailer: outcome.retailer,
          label: RETAILER_LABELS[outcome.retailer],
          status: outcome.status,
          // Deliberately user-facing text, not the raw error — the raw detail
          // goes to the health log, which is where debugging belongs.
          message:
            outcome.status === "success"
              ? null
              : friendlyMessage(outcome.status),
          products: outcome.products,
        })),
      };
    },
  );

  // ---- poll the Amazon leg of a search ----
  //
  // Cheap and unmetered — the Bright Data call is already in flight, this just
  // reads its state. Safe to poll every few seconds.
  app.get<{ Params: { id: string } }>(
    "/search/amazon/:id",
    { preHandler: optionalAuth },
    async (request, reply) => {
      const job = getSearchJob(request.params.id);

      if (!job) {
        // Expired, or the server restarted. Not an error the user can act on,
        // so say so plainly rather than 500ing.
        return reply.status(404).send({
          error: "That Amazon search expired. Run the search again.",
          code: "SEARCH_JOB_NOT_FOUND",
        });
      }

      return {
        status: job.status,
        retailer: "amazon",
        label: RETAILER_LABELS.amazon,
        products: job.products,
        message:
          job.status === "pending" || job.status === "success"
            ? null
            : friendlyMessage(job.status),
        elapsedMs: (job.finishedAt ?? Date.now()) - job.startedAt,
      };
    },
  );

  // ---- how many searches do I have left? ----
  // Cheap, unmetered, and safe to poll — the Search screen calls this on focus
  // so the counter is right without spending anything.
  app.get(
    "/search/quota",
    { preHandler: optionalAuth },
    async (request, reply) => {
      const userId = request.userId;
      const deviceId = request.guestDeviceId;

      if (userId) {
        const quota = await getUserQuota(userId);
        if (!quota)
          return reply.status(404).send({ error: "No wallet for user" });

        const wallet = await prisma.wallet.findUnique({ where: { userId } });
        return {
          quota,
          isGuest: false,
          tier: wallet ? effectiveTier(wallet) : "free",
          // Sent here as well as on the search response so the picker can be
          // shown BEFORE a search. Choosing how many results you want after
          // paying for the search is the wrong way round.
          resultsRange: wallet
            ? limitsFor(wallet).resultsPerRetailer
            : TIER_LIMITS.free.resultsPerRetailer,
        };
      }

      if (deviceId) {
        return {
          quota: await getGuestQuota(deviceId),
          isGuest: true,
          tier: "free",
          resultsRange: TIER_LIMITS.free.resultsPerRetailer,
        };
      }

      return reply.status(401).send({
        error: "Sign in or send a device id.",
        code: "IDENTIFY_REQUIRED",
      });
    },
  );

  // ---- AdMob server-side verification callback ----
  //
  // Google calls this when a rewarded ad completes. This is the ONLY path that
  // grants a bonus search in production — the client saying "I watched an ad"
  // is not evidence, and a search costs real money on the Amazon leg.
  //
  // Register the URL in the AdMob console against the rewarded ad unit:
  //   https://<your-backend>/ads/admob/ssv
  app.get("/ads/admob/ssv", async (request, reply) => {
    // Verify against the RAW query string. Rebuilding it from parsed params can
    // reorder or re-encode values, and the signature covers the exact bytes.
    const rawQuery = request.raw.url?.split("?")[1] ?? "";
    const result = await verifySsvCallback(rawQuery);

    if (!result.valid) {
      request.log.warn(
        { reason: result.reason },
        "rejected AdMob SSV callback",
      );
      // 200 regardless: a non-2xx makes Google retry a callback that will
      // never verify. The rejection is logged, which is what we actually need.
      return reply.status(200).send({ ok: false });
    }

    // AdMob retries callbacks, so the same completion can arrive twice. The
    // unique constraint is what makes granting idempotent.
    try {
      await prisma.adReward.create({
        data: {
          transactionId: result.transactionId,
          userId: result.userId,
          amount: result.amount,
        },
      });
    } catch {
      request.log.info(
        { transactionId: result.transactionId },
        "duplicate SSV callback ignored",
      );
      return reply.status(200).send({ ok: true, duplicate: true });
    }

    const quota = await grantRewardedSearch(result.userId);
    request.log.info(
      { userId: result.userId, granted: Boolean(quota) },
      "AdMob reward verified",
    );

    return reply.status(200).send({ ok: true });
  });

  // ---- development-only reward shortcut ----
  //
  // Lets the reward flow be exercised without a real ad and without AdMob
  // configured. Refuses to run in production, because it is exactly the hole
  // the SSV callback above exists to close.
  app.post(
    "/search/rewarded",
    {
      preHandler: requireAuth,
      config: { rateLimit: SENSITIVE_LIMIT },
    },
    async (request, reply) => {
      if (process.env.NODE_ENV === "production") {
        return reply.status(403).send({
          error:
            "Rewards are granted by AdMob verification, not by the client.",
          code: "SSV_REQUIRED",
        });
      }

      const quota = await grantRewardedSearch(request.userId!);

      if (!quota) {
        return reply.status(403).send({
          error: "No more ad-unlocked searches available today.",
          code: "REWARD_LIMIT_REACHED",
        });
      }

      return { quota, devOnly: true };
    },
  );

  // ---- which retailers are working right now? ----
  // Lets the client grey out a tile it knows is down instead of showing an
  // empty column with no explanation.
  app.get("/search/retailers", async () => {
    const since = new Date(Date.now() - 60 * 60 * 1000);

    const grouped = await prisma.scrapeCheck.groupBy({
      by: ["retailer", "status"],
      where: { checkedAt: { gte: since } },
      _count: { _all: true },
    });

    return {
      // A store switched off by configuration is reported as unavailable with
      // no success rate. Leaving it out entirely would make the app look like
      // it had silently lost a feature; claiming it works would be a lie.
      retailers: RETAILERS.map((retailer) => {
        const rows = grouped.filter((g) => g.retailer === retailer);
        const total = rows.reduce((sum, r) => sum + r._count._all, 0);
        const ok = rows.find((r) => r.status === "success")?._count._all ?? 0;
        const enabled = isRetailerEnabled(retailer);
        // A retailer in cooldown is unavailable right now regardless of what
        // the last hour's success rate says — we are deliberately not calling
        // it, so reporting it as working would be wrong.
        const cooling = cooldownRemaining(retailer);

        return {
          retailer,
          label: RETAILER_LABELS[retailer],
          // No data is not the same as broken — a quiet hour shouldn't grey
          // out a healthy retailer.
          available: enabled && cooling === 0 && (total === 0 || ok > 0),
          /** Seconds until we'll try this retailer again, when paused. */
          cooldownSeconds: cooling > 0 ? Math.ceil(cooling / 1000) : null,
          successRate: !enabled ? null : total === 0 ? null : ok / total,
          enabled,
        };
      }),
    };
  });
}

function parseRetailers(raw?: string): Retailer[] | undefined | "invalid" {
  if (!raw) return undefined;
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  if (!parts.every(isRetailer)) return "invalid";
  return parts as Retailer[];
}

function friendlyMessage(status: "failed" | "blocked") {
  return status === "blocked"
    ? "This store is blocking us right now."
    : "Couldn't reach this store.";
}
