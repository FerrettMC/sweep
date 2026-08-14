// routes/leaderboard.ts
//
// Public standings, plus the user's own XP breakdown.
//
// Two things this is careful about:
//   - It never exposes an email. Users appear as their chosen username, or as
//     an anonymous "Sweeper #A1B2" until they pick one.
//   - Rank is computed by the database, not by scanning users in Node, so it
//     stays correct and cheap as the table grows.

import type { FastifyInstance } from "fastify";
import { optionalAuth, requireAuth } from "../lib/auth.js";
import { FEATURE_GROUP_LABELS, getPlans } from "../lib/plans.js";
import { effectiveTier } from "../lib/tiers.js";
import { SENSITIVE_LIMIT } from "../lib/rateLimit.js";
import { prisma } from "../lib/prisma.js";
import { badgesFor, collectBadgeStats } from "../lib/badges.js";
import { displayName, levelFromXp, levelTitle } from "../lib/xp.js";

const MAX_LEADERBOARD_SIZE = 50;
const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,16}$/;

export async function leaderboardRoutes(app: FastifyInstance) {
  // ---- plans ----
  //
  // Served rather than hardcoded in the app so pricing and perks can't drift
  // apart from what the API actually enforces. Public: someone deciding
  // whether to sign up should be able to read it.
  app.get("/plans", { preHandler: optionalAuth }, async (request) => {
    const userId = request.userId;
    const wallet = userId
      ? await prisma.wallet.findUnique({ where: { userId } })
      : null;

    return {
      plans: getPlans(),
      groupLabels: FEATURE_GROUP_LABELS,
      currentTier: wallet ? effectiveTier(wallet) : null,
    };
  });

  // ---- standings ----
  app.get("/leaderboard", { preHandler: requireAuth }, async (request) => {
    const userId = request.userId!;

    const top = await prisma.wallet.findMany({
      where: { xp: { gt: 0 } },
      orderBy: [{ xp: "desc" }, { updatedAt: "asc" }],
      take: MAX_LEADERBOARD_SIZE,
      select: {
        xp: true,
        userId: true,
        user: { select: { id: true, username: true } },
      },
    });

    const me = await prisma.wallet.findUnique({
      where: { userId },
      select: { xp: true, user: { select: { id: true, username: true } } },
    });

    // Rank = how many people are strictly ahead, + 1. Done as a count so we
    // never have to load the whole table to find one person's position.
    const ahead = me
      ? await prisma.wallet.count({ where: { xp: { gt: me.xp } } })
      : 0;

    return {
      entries: top.map((row, index) => ({
        rank: index + 1,
        name: displayName(row.user),
        xp: row.xp,
        level: levelFromXp(row.xp).level,
        title: levelTitle(levelFromXp(row.xp).level),
        isMe: row.userId === userId,
      })),
      me: me
        ? {
            rank: ahead + 1,
            name: displayName(me.user),
            xp: me.xp,
            hasUsername: Boolean(me.user.username),
            // True when the user isn't in the returned page, so the UI can
            // pin their row rather than leaving them unable to find it.
            offList: ahead + 1 > MAX_LEADERBOARD_SIZE,
            ...levelFromXp(me.xp),
            title: levelTitle(levelFromXp(me.xp).level),
          }
        : null,
    };
  });

  // ---- my XP, and where it came from ----
  app.get("/me/xp", { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.userId!;

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) return reply.status(404).send({ error: "No wallet for user" });

    const history = await prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        xpChange: true,
        reason: true,
        detail: true,
        createdAt: true,
        productId: true,
      },
    });

    // Attach titles so the feed reads as "AirPods 4 — 32% below average"
    // rather than as a row of opaque ids.
    const productIds = [
      ...new Set(history.map((h) => h.productId).filter(Boolean)),
    ] as string[];
    const products = productIds.length
      ? await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, title: true },
        })
      : [];
    const titleById = new Map(products.map((p) => [p.id, p.title]));

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true },
    });

    const level = levelFromXp(wallet.xp);

    const badges = badgesFor(await collectBadgeStats(userId));

    return {
      // Badges are cosmetic and derived, never stored — adding a new one
      // retroactively awards it to everyone who already qualifies.
      badges,
      // Both forms: the raw username (null until chosen) so the UI can offer to
      // set one, and the resolved display name so nothing has to re-implement
      // the anonymous fallback.
      username: user?.username ?? null,
      name: user ? displayName(user) : "Sweeper",
      xp: wallet.xp,
      ...level,
      title: levelTitle(level.level),
      history: history.map((entry) => ({
        id: entry.id,
        xp: entry.xpChange,
        reason: entry.reason,
        detail: entry.detail,
        productTitle: entry.productId
          ? (titleById.get(entry.productId) ?? null)
          : null,
        at: entry.createdAt,
      })),
    };
  });

  // ---- choose a public name ----
  app.put(
    "/me/username",
    {
      preHandler: requireAuth,
      config: { rateLimit: SENSITIVE_LIMIT },
    },
    async (request, reply) => {
      const userId = request.userId!;
      const { username } = (request.body ?? {}) as { username?: unknown };

      if (typeof username !== "string" || !USERNAME_PATTERN.test(username)) {
        return reply.status(400).send({
          error:
            "Usernames are 3–16 characters, letters, numbers and underscores only.",
          code: "INVALID_USERNAME",
        });
      }

      // Case-insensitive uniqueness, so "Ferret" and "ferret" can't both exist
      // and be mistaken for each other on a public board.
      const taken = await prisma.user.findFirst({
        where: {
          username: { equals: username, mode: "insensitive" },
          id: { not: userId },
        },
        select: { id: true },
      });
      if (taken) {
        return reply.status(409).send({
          error: "That username is taken.",
          code: "USERNAME_TAKEN",
        });
      }

      await prisma.user.update({ where: { id: userId }, data: { username } });
      return { username };
    },
  );
}
