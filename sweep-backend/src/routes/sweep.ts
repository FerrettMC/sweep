// routes/sweep.ts
//
// "Sweep this deal" — the paid verdict on whether to actually buy something.
//
// Two things are enforced here rather than trusted to the client: whether the
// tier includes the feature at all, and the daily allowance. Both matter more
// than usual because this is the most expensive action in the app — a full
// retailer fan-out for a single product.
//
// The quota is spent only once the work is known to be doable. Refusing after
// taking someone's allowance would be the worst of both.

import type { FastifyInstance } from "fastify";
import { requireAuth } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";
import { consumeSweep, getSweepQuota } from "../lib/quota.js";
import { resolveProduct } from "../lib/resolveProduct.js";
import { sweepProduct } from "../lib/sweep.js";
import { effectiveTier, limitsFor } from "../lib/tiers.js";

export async function sweepRoutes(app: FastifyInstance) {
  // How many sweeps are left, so the button can render its state without
  // spending one to find out.
  app.get("/sweep/quota", { preHandler: requireAuth }, async (request, reply) => {
    const quota = await getSweepQuota(request.userId!);
    if (!quota) return reply.status(404).send({ error: "No wallet for user" });

    const wallet = await prisma.wallet.findUnique({ where: { userId: request.userId! } });
    return { quota, tier: wallet ? effectiveTier(wallet) : "free" };
  });

  app.post("/sweep", { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.userId!;
    const body = (request.body ?? {}) as {
      productId?: string;
      url?: string;
      retailer?: string;
      retailerId?: string;
    };

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) return reply.status(404).send({ error: "No wallet for user" });

    const tier = effectiveTier(wallet);
    if (limitsFor(wallet).sweepsPerDay === 0) {
      return reply.status(403).send({
        error: "Sweep this deal is a Pro and Ultimate feature.",
        code: "SWEEP_REQUIRES_TIER",
        tier,
      });
    }

    const quota = await getSweepQuota(userId);
    if (!quota || quota.remaining <= 0) {
      return reply.status(429).send({
        error:
          quota && quota.limit === 1
            ? "That's your sweep for today. Ultimate gets three."
            : "You've used all your sweeps today.",
        code: "SWEEP_QUOTA_EXHAUSTED",
        quota,
        tier,
      });
    }

    // Resolve first. If we can't even identify the product there's nothing to
    // sweep, and the user shouldn't be charged for our failure to find it.
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

    const exists = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, currentPrice: true },
    });
    if (!exists) {
      return reply.status(404).send({ error: "Product not found" });
    }
    if (exists.currentPrice === null) {
      return reply.status(409).send({
        error: "That item has no price right now, so there's nothing to compare.",
        code: "NO_PRICE",
      });
    }

    const result = await sweepProduct(productId);
    if (!result) {
      return reply.status(502).send({
        error: "Couldn't sweep that item. Try again in a moment.",
        code: "SWEEP_FAILED",
      });
    }

    // Charged only now that there's a real result to hand back.
    const spent = await consumeSweep(userId);

    return { result, quota: spent ?? quota, tier };
  });
}
