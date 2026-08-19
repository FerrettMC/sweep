// routes/lookup.ts
//
// Product lookup — the page people open the app for.
//
// Replaced "Sweep this deal" in place, including its daily counter, so nobody
// gained or lost allowance in the swap. The limits moved a long way (1/day to
// 12 on free) because the work did: a sweep asked every store about one item,
// a lookup asks one store, deeply.
//
// Order of operations matters and is deliberate: identify the product, then
// check the allowance, then do the work, then charge. Charging for a product
// we couldn't even identify would be taking someone's allowance for our own
// failure.

import type { FastifyInstance } from "fastify";
import { optionalAuth, requireAuth } from "../lib/auth.js";
import { SCRAPE_LIMIT } from "../lib/rateLimit.js";
import { prisma } from "../lib/prisma.js";
import {
  consumeGuestLookup,
  consumeLookup,
  getGuestLookupQuota,
  getLookupQuota,
  refundGuestLookup,
  refundUserLookup,
} from "../lib/quota.js";
import { lookupProduct } from "../lib/lookup.js";
import { resolveProduct } from "../lib/resolveProduct.js";
import { TIER_LIMITS, effectiveTier } from "../lib/tiers.js";

export async function lookupRoutes(app: FastifyInstance) {
  // What's left, so the page can render its state without spending one to
  // find out.
  app.get("/lookup/quota", { preHandler: optionalAuth }, async (request, reply) => {
    if (request.userId) {
      const quota = await getLookupQuota(request.userId);
      const wallet = await prisma.wallet.findUnique({
        where: { userId: request.userId },
      });
      return { quota, tier: wallet ? effectiveTier(wallet) : "free", guest: false };
    }

    const deviceId = request.guestDeviceId;
    if (!deviceId) {
      return reply
        .status(400)
        .send({ error: "Missing device id", code: "NO_DEVICE_ID" });
    }
    return {
      quota: await getGuestLookupQuota(deviceId),
      tier: "free" as const,
      guest: true,
    };
  });

  app.post(
    "/lookup",
    { preHandler: optionalAuth, config: { rateLimit: SCRAPE_LIMIT } },
    async (request, reply) => {
      const body = (request.body ?? {}) as {
        productId?: string;
        url?: string;
        retailer?: string;
        retailerId?: string;
      };

      const userId = request.userId ?? null;
      const deviceId = userId ? null : (request.guestDeviceId ?? null);
      if (!userId && !deviceId) {
        return reply
          .status(400)
          .send({ error: "Missing device id", code: "NO_DEVICE_ID" });
      }

      const wallet = userId
        ? await prisma.wallet.findUnique({ where: { userId } })
        : null;
      if (userId && !wallet) {
        return reply.status(404).send({ error: "No wallet for user" });
      }
      const tier = wallet ? effectiveTier(wallet) : ("free" as const);

      // Read the allowance before doing anything expensive, so an exhausted
      // user is refused instantly rather than after a slow store call.
      const quota = userId
        ? await getLookupQuota(userId)
        : await getGuestLookupQuota(deviceId!);

      if (!quota || quota.remaining <= 0) {
        return reply.status(429).send({
          error: userId
            ? "You've used all your product lookups today."
            : "Create a free account for more product lookups.",
          code: "LOOKUP_QUOTA_EXHAUSTED",
          quota,
          tier,
        });
      }

      // Identify first. No allowance is touched until we know there's a real
      // product behind the request.
      let productId = body.productId;
      if (!productId) {
        const resolved = await resolveProduct(body);
        if (!resolved.ok) {
          return reply
            .status(resolved.status)
            .send({ error: resolved.error, code: resolved.code });
        }
        productId = resolved.product.id;
      }

      // Charged before the store call, not after: two requests arriving
      // together must not both pass the check above. The refund below is what
      // makes that fair when the work then produces nothing.
      const spent = userId
        ? await consumeLookup(userId)
        : await consumeGuestLookup(deviceId!);

      if (!spent) {
        // Lost the race — someone spent the last one between our read and our
        // write.
        return reply.status(429).send({
          error: "You've used all your product lookups today.",
          code: "LOOKUP_QUOTA_EXHAUSTED",
          quota,
          tier,
        });
      }

      const result = await lookupProduct(productId, {
        userId: userId ?? undefined,
        historyDays: TIER_LIMITS[tier].historyDays,
      });

      if (!result) {
        // Nothing to show at all. Give the allowance back — the daily limit is
        // meant to bound work we did, not to charge for our own failure.
        if (userId) await refundUserLookup(userId, spent.resetsAt);
        else await refundGuestLookup(deviceId!, spent.resetsAt);

        return reply.status(404).send({
          error: "Product not found",
          code: "PRODUCT_NOT_FOUND",
        });
      }

      // A cached fallback is a real page and is not refunded — except when we
      // have nothing to show but a title, which is not what anyone spent a
      // lookup for.
      const worthless =
        !result.fresh && result.detail.price === null && result.history.length === 0;
      if (worthless) {
        if (userId) await refundUserLookup(userId, spent.resetsAt);
        else await refundGuestLookup(deviceId!, spent.resetsAt);

        return reply.status(502).send({
          error:
            result.staleReason === "blocked"
              ? "That store isn't answering right now. Try again in a few minutes."
              : "Couldn't read that product. Try again in a moment.",
          code: "LOOKUP_FAILED",
          retailer: result.detail.retailer,
        });
      }

      return {
        ...result,
        quota: worthless ? quota : spent,
        tier,
      };
    },
  );
}
