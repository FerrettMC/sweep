// routes/radar.ts
//
// Deal Radar — standing searches that watch every store for something you
// haven't found yet.
//
// The tier split here is about labour, not capability: every tier searches the
// same six stores with the same target price. Paid tiers have Sweep re-run
// them on a schedule; free runs them by hand, twice a day. That's deliberate —
// a free radar that couldn't set a target price would be a feature that exists
// and does nothing, which is worse than not shipping it.
//
// Manual refresh is metered separately from search because it fans out to
// every retailer and a user could otherwise drain their whole search allowance
// on one tap without realising.

import type { FastifyInstance } from "fastify";
import { requireAuth } from "../lib/auth.js";
import { effectiveIntervalMinutes } from "../lib/backoff.js";
import { runRadar } from "../lib/dealRadar.js";
import { prisma } from "../lib/prisma.js";
import { consumeRadarRefresh, getRadarRefreshState } from "../lib/quota.js";
import { effectiveTier, limitsFor } from "../lib/tiers.js";

const MAX_KEYWORD_LENGTH = 80;
/** $100k. Catches a typo without ever refusing a real target. */
const MAX_TARGET_CENTS = 10_000_000;

export async function radarRoutes(app: FastifyInstance) {
  // ---- list ----
  app.get("/radar", { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.userId!;

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) return reply.status(404).send({ error: "No wallet for user" });

    const limits = limitsFor(wallet);
    const [searches, refreshes] = await Promise.all([
      prisma.savedSearch.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
      getRadarRefreshState(userId),
    ]);

    return {
      searches: searches.map(serialize),
      limits: {
        maxSavedSearches: limits.maxSavedSearches,
        used: searches.length,
        // 0 is the honest signal for "we don't check this for you".
        intervalMinutes: limits.savedSearchIntervalMinutes,
        autoChecks: limits.savedSearchIntervalMinutes > 0,
      },
      refreshes,
      tier: effectiveTier(wallet),
    };
  });

  // ---- create ----
  app.post("/radar", { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.userId!;
    const { keyword, targetPrice } = (request.body ?? {}) as {
      keyword?: unknown;
      targetPrice?: unknown;
    };

    if (typeof keyword !== "string" || keyword.trim().length < 2) {
      return reply
        .status(400)
        .send({ error: "What should Sweep watch for?", code: "INVALID_KEYWORD" });
    }

    const target = normalizeTarget(targetPrice);
    if (target === "invalid") {
      return reply
        .status(400)
        .send({ error: "That target price doesn't look right.", code: "INVALID_TARGET" });
    }

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) return reply.status(404).send({ error: "No wallet for user" });

    const limits = limitsFor(wallet);
    const count = await prisma.savedSearch.count({ where: { userId } });
    if (count >= limits.maxSavedSearches) {
      return reply.status(403).send({
        error: `Your plan watches ${limits.maxSavedSearches} ${
          limits.maxSavedSearches === 1 ? "search" : "searches"
        } at a time.`,
        code: "RADAR_LIMIT_REACHED",
        limit: limits.maxSavedSearches,
        tier: effectiveTier(wallet),
      });
    }

    const saved = await prisma.savedSearch.create({
      data: {
        userId,
        keyword: keyword.trim().slice(0, MAX_KEYWORD_LENGTH),
        targetPrice: target,
        // Tiers without scheduled checks get a far-future date rather than a
        // null, so the scheduler's query stays a simple "what's due".
        nextCheckAt:
          limits.savedSearchIntervalMinutes > 0
            ? new Date(Date.now() + limits.savedSearchIntervalMinutes * 60_000)
            : new Date("2999-01-01"),
      },
    });

    return reply.status(201).send({ search: serialize(saved) });
  });

  // ---- edit ----
  app.patch<{ Params: { id: string } }>(
    "/radar/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { keyword, targetPrice } = (request.body ?? {}) as {
        keyword?: unknown;
        targetPrice?: unknown;
      };

      const data: { keyword?: string; targetPrice?: number | null; lastBestPrice?: null } = {};

      if (keyword !== undefined) {
        if (typeof keyword !== "string" || keyword.trim().length < 2) {
          return reply
            .status(400)
            .send({ error: "What should Sweep watch for?", code: "INVALID_KEYWORD" });
        }
        data.keyword = keyword.trim().slice(0, MAX_KEYWORD_LENGTH);
        // A different search is a different question — forget what we'd already
        // reported, or the new one starts out silently muted.
        data.lastBestPrice = null;
      }

      if (targetPrice !== undefined) {
        const target = normalizeTarget(targetPrice);
        if (target === "invalid") {
          return reply
            .status(400)
            .send({ error: "That target price doesn't look right.", code: "INVALID_TARGET" });
        }
        data.targetPrice = target;
      }

      const updated = await prisma.savedSearch.updateMany({
        where: { id: request.params.id, userId: request.userId! },
        data,
      });
      if (updated.count === 0) return reply.status(404).send({ error: "Radar not found" });

      return { ok: true };
    },
  );

  // ---- delete ----
  app.delete<{ Params: { id: string } }>(
    "/radar/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const deleted = await prisma.savedSearch.deleteMany({
        where: { id: request.params.id, userId: request.userId! },
      });
      if (deleted.count === 0) return reply.status(404).send({ error: "Radar not found" });
      return { ok: true };
    },
  );

  // ---- run one now ----
  app.post<{ Params: { id: string } }>(
    "/radar/:id/refresh",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.userId!;

      const saved = await prisma.savedSearch.findFirst({
        where: { id: request.params.id, userId },
      });
      if (!saved) return reply.status(404).send({ error: "Radar not found" });

      const wallet = await prisma.wallet.findUnique({ where: { userId } });
      if (!wallet) return reply.status(404).send({ error: "No wallet for user" });

      // Checked before the work, so nobody waits 30 seconds to be refused.
      const state = await getRadarRefreshState(userId);
      if (state && state.remaining !== null && state.remaining <= 0) {
        return reply.status(429).send({
          error: `That's your ${state.limit} refreshes for today.`,
          code: "RADAR_REFRESH_EXHAUSTED",
          refreshes: state,
          tier: effectiveTier(wallet),
        });
      }

      const run = await runRadar(saved);

      const limits = limitsFor(wallet);
      await prisma.savedSearch.update({
        where: { id: saved.id },
        data: {
          lastCheckedAt: new Date(),
          ...(run.best
            ? {
                lastMatchAt: new Date(),
                // Only ratchet downward: the point is "cheapest we've seen".
                lastBestPrice:
                  saved.lastBestPrice === null
                    ? run.best.price
                    : Math.min(saved.lastBestPrice, run.best.price),
              }
            : {}),
          ...(limits.savedSearchIntervalMinutes > 0
            ? {
                nextCheckAt: new Date(
                  Date.now() + limits.savedSearchIntervalMinutes * 60_000,
                ),
              }
            : {}),
        },
      });

      const spent = await consumeRadarRefresh(userId);

      return {
        matches: run.matches,
        best: run.best,
        unreachable: run.unreachable,
        isNewBest: run.isNewBest,
        refreshes: spent ?? state,
      };
    },
  );
}

// ---- helpers ---------------------------------------------------------------

function normalizeTarget(value: unknown): number | null | "invalid" {
  if (value === undefined || value === null || value === "") return null;
  const cents = typeof value === "number" ? Math.round(value) : Number(value);
  if (!Number.isFinite(cents) || cents <= 0 || cents > MAX_TARGET_CENTS) return "invalid";
  return cents;
}

function serialize(saved: {
  id: string;
  keyword: string;
  targetPrice: number | null;
  createdAt: Date;
  lastCheckedAt: Date | null;
  nextCheckAt: Date;
  unchangedChecks: number;
  lastBestPrice: number | null;
  lastMatchAt: Date | null;
}) {
  return {
    id: saved.id,
    keyword: saved.keyword,
    targetPrice: saved.targetPrice,
    createdAt: saved.createdAt,
    lastCheckedAt: saved.lastCheckedAt,
    lastBestPrice: saved.lastBestPrice,
    lastMatchAt: saved.lastMatchAt,
    // Only meaningful on tiers with scheduled checks; the app hides it otherwise.
    nextCheckAt: saved.nextCheckAt,
    unchangedChecks: saved.unchangedChecks,
  };
}
