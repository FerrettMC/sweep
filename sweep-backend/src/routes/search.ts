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
import { optionalAuth, requireAuth } from "../lib/auth.js";
import { recordCheck } from "../lib/health.js";
import { prisma } from "../lib/prisma.js";
import {
  consumeGuestSearch,
  consumeUserSearch,
  getGuestQuota,
  getUserQuota,
  grantRewardedSearch,
} from "../lib/quota.js";
import { searchAllRetailers } from "../lib/scrapers/index.js";
import { getSearchJob, startAmazonSearch } from "../lib/searchJobs.js";
import {
  RETAILERS,
  RETAILER_LABELS,
  type Retailer,
  isRetailer,
} from "../lib/scrapers/types.js";
import { effectiveTier } from "../lib/tiers.js";

const MAX_KEYWORD_LENGTH = 120;
const RESULTS_PER_RETAILER = 4;

export async function searchRoutes(app: FastifyInstance) {
  // ---- compiled search ----
  app.get("/search", { preHandler: optionalAuth }, async (request, reply) => {
    const query = (request.query ?? {}) as { q?: string; retailers?: string };

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

    // Amazon is split out of the synchronous path: Bright Data's free tier can
    // take up to ~3 minutes, and making the user stare at a spinner that long
    // for four retailers that answered in 3 seconds is the wrong trade.
    const requested = only ?? [...RETAILERS];
    const fastRetailers = requested.filter((r) => r !== "amazon");
    const wantsAmazon = requested.includes("amazon");

    const amazonJobId = wantsAmazon
      ? startAmazonSearch(keyword, RESULTS_PER_RETAILER)
      : null;

    const outcomes = await searchAllRetailers(
      keyword,
      RESULTS_PER_RETAILER,
      fastRetailers,
    );

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

    return {
      keyword,
      quota,
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
          outcome.status === "success" ? null : friendlyMessage(outcome.status),
        products: outcome.products,
      })),
    };
  });

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
        message: job.status === "pending" || job.status === "success"
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
        };
      }

      if (deviceId) {
        return {
          quota: await getGuestQuota(deviceId),
          isGuest: true,
          tier: "free",
        };
      }

      return reply.status(401).send({
        error: "Sign in or send a device id.",
        code: "IDENTIFY_REQUIRED",
      });
    },
  );

  // ---- rewarded ad → one extra search ----
  //
  // SECURITY: this currently trusts the client's claim that an ad played.
  // That is fine for development and NOT fine at launch — it lets anyone mint
  // free searches by calling this endpoint directly. Wire AdMob server-side
  // verification before shipping; see docs/INTEGRATIONS.md.
  app.post(
    "/search/rewarded",
    { preHandler: requireAuth },
    async (request, reply) => {
      const quota = await grantRewardedSearch(request.userId!);

      if (!quota) {
        return reply.status(403).send({
          error: "No more ad-unlocked searches available today.",
          code: "REWARD_LIMIT_REACHED",
        });
      }

      return { quota };
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
      retailers: RETAILERS.map((retailer) => {
        const rows = grouped.filter((g) => g.retailer === retailer);
        const total = rows.reduce((sum, r) => sum + r._count._all, 0);
        const ok = rows.find((r) => r.status === "success")?._count._all ?? 0;

        return {
          retailer,
          label: RETAILER_LABELS[retailer],
          // No data is not the same as broken — a quiet hour shouldn't grey
          // out a healthy retailer.
          available: total === 0 || ok > 0,
          successRate: total === 0 ? null : ok / total,
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
