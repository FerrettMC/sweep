// routes/promo.ts
//
// "I have a code" — the user-facing half of promo codes.
//
// Creating codes is an admin job and lives in routes/admin.ts. This file only
// spends them, and it's deliberately thin: every rule about what a code does
// lives in lib/promo.ts, so there's one place to look when a redemption does
// something surprising.
//
// Rate limited hard. A code is short, a hit is worth money, and guessing is the
// obvious attack — see REDEEM_LIMIT.

import type { FastifyInstance } from "fastify";
import { requireAuth } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";
import { REDEEM_LIMIT } from "../lib/rateLimit.js";
import { redeemPromoCode } from "../lib/promo.js";
import { effectiveTier } from "../lib/tiers.js";

export async function promoRoutes(app: FastifyInstance) {
  app.post(
    "/promo/redeem",
    { preHandler: requireAuth, config: { rateLimit: REDEEM_LIMIT } },
    async (request, reply) => {
      const { code } = (request.body ?? {}) as { code?: string };
      if (typeof code !== "string" || !code.trim()) {
        return reply.status(400).send({ error: "Enter a code to redeem." });
      }

      const result = await redeemPromoCode(request.userId!, code);

      if (!result.ok) {
        // 200, not 4xx. Every failure here is an expected outcome with a
        // message written for the user, and the app renders `message` either
        // way — an error status would push it into a generic network-failure
        // path that says something less useful.
        return { ok: false as const, reason: result.reason, message: result.message };
      }

      request.log.info(
        { userId: request.userId, tier: result.grantedTier, days: result.days },
        "promo code redeemed",
      );

      return {
        ok: true as const,
        tier: result.grantedTier,
        expiresAt: result.grantExpiresAt.toISOString(),
        days: result.days,
        effectiveTier: result.effectiveTier,
        overshadowed: result.overshadowed,
        message: result.overshadowed
          ? `Saved. You're already on ${titled(result.effectiveTier)}, so this ${titled(result.grantedTier)} time starts if that ever ends.`
          : `${result.days} days of ${titled(result.grantedTier)} unlocked.`,
      };
    },
  );

  /**
   * What the user currently has, so Settings can show a granted tier without
   * pretending it's a subscription they're paying for.
   */
  app.get("/promo/status", { preHandler: requireAuth }, async (request) => {
    const wallet = await prisma.wallet.findUnique({
      where: { userId: request.userId! },
    });
    if (!wallet) return { grant: null, effectiveTier: "free" as const };

    const active =
      wallet.promoTier &&
      wallet.promoExpiresAt &&
      wallet.promoExpiresAt.getTime() > Date.now();

    return {
      grant: active
        ? {
            tier: wallet.promoTier,
            expiresAt: wallet.promoExpiresAt!.toISOString(),
            daysLeft: Math.ceil(
              (wallet.promoExpiresAt!.getTime() - Date.now()) / 86_400_000,
            ),
          }
        : null,
      effectiveTier: effectiveTier(wallet),
    };
  });
}

function titled(tier: string): string {
  return tier === "ultimate" ? "Ultimate" : tier === "pro" ? "Pro" : "Free";
}
