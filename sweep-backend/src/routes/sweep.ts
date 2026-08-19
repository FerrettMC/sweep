// routes/sweep.ts
//
// Backwards compatibility only. Nothing new should call this.
//
// "Sweep this deal" was replaced by product lookup, but builds already on
// people's phones still POST here and still expect the old SweepResult shape.
// They can't be updated, so this translates a lookup into that shape.
//
// The one thing that must not happen is a quiet lie. A sweep fanned out to
// every other retailer to answer "is it cheaper elsewhere?"; a lookup does
// not, so `cheaperElsewhere` is empty here — and an empty list in the old UI
// renders as "nothing cheaper anywhere", which would be a claim we did not
// check. The fix is `unreachable`: the old client already says "nothing
// cheaper on the stores we could reach" whenever that list is non-empty, so
// naming the stores we didn't ask keeps the old screen truthful.
//
// New clients use /lookup, which says all of this directly.

import type { FastifyInstance } from "fastify";
import { requireAuth } from "../lib/auth.js";
import { SCRAPE_LIMIT } from "../lib/rateLimit.js";
import { prisma } from "../lib/prisma.js";
import { consumeLookup, getLookupQuota, refundUserLookup } from "../lib/quota.js";
import { lookupProduct } from "../lib/lookup.js";
import { resolveProduct } from "../lib/resolveProduct.js";
import { judgeSale, type SaleAssessment } from "../lib/saleVerdict.js";
import { TIER_LIMITS, effectiveTier } from "../lib/tiers.js";
import { isRetailerEnabled } from "../lib/scrapers/index.js";
import { RETAILERS, RETAILER_LABELS, type Retailer } from "../lib/scrapers/types.js";

/**
 * The response shape old builds parse.
 *
 * Declared here rather than in a shared lib because this route is the only
 * thing left that speaks it. Keeping it next to the code that fabricates it
 * makes it obvious that it describes a wire format we maintain for
 * compatibility, not a thing the app still computes.
 */
interface LegacySweepResult {
  product: {
    id: string;
    title: string;
    retailer: string;
    retailerLabel: string;
    url: string;
    imageUrl: string | null;
    price: number;
    listPrice: number | null;
  };
  sale: SaleAssessment;
  history: {
    points: number;
    low: number | null;
    high: number | null;
    average: number | null;
    firstSeen: Date | null;
  };
  /** Always empty now: a lookup asks one store, so nothing is compared. */
  cheaperElsewhere: never[];
  similar: never[];
  /** Every store we did NOT ask, which is what keeps the old screen honest. */
  unreachable: string[];
  bestSaving: number;
  headline: string;
}

export async function sweepRoutes(app: FastifyInstance) {
  app.get("/sweep/quota", { preHandler: requireAuth }, async (request, reply) => {
    const quota = await getLookupQuota(request.userId!);
    if (!quota) return reply.status(404).send({ error: "No wallet for user" });

    const wallet = await prisma.wallet.findUnique({
      where: { userId: request.userId! },
    });
    return { quota, tier: wallet ? effectiveTier(wallet) : "free" };
  });

  app.post(
    "/sweep",
    { preHandler: requireAuth, config: { rateLimit: SCRAPE_LIMIT } },
    async (request, reply) => {
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

      // No tier check any more: lookups are on every tier, so an old free-tier
      // build that used to be refused here now works. Gaining a feature is a
      // safe direction for a client we can't update.
      const quota = await getLookupQuota(userId);
      if (!quota || quota.remaining <= 0) {
        return reply.status(429).send({
          error: "You've used all your product lookups today.",
          code: "SWEEP_QUOTA_EXHAUSTED",
          quota,
          tier,
        });
      }

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

      const spent = await consumeLookup(userId);
      if (!spent) {
        return reply.status(429).send({
          error: "You've used all your product lookups today.",
          code: "SWEEP_QUOTA_EXHAUSTED",
          quota,
          tier,
        });
      }

      const lookup = await lookupProduct(productId, {
        userId,
        historyDays: TIER_LIMITS[tier].historyDays,
      });

      // The old client can't render a product with no price — its result type
      // declares price as non-null — so this stays a failure rather than
      // sending a shape it will crash on.
      if (!lookup || lookup.detail.price === null) {
        await refundUserLookup(userId, spent.resetsAt);
        return reply.status(502).send({
          error: "Couldn't sweep that item. Try again in a moment.",
          code: "SWEEP_FAILED",
        });
      }

      return { result: toSweepShape(lookup, productId), quota: spent, tier };
    },
  );
}

/** A lookup, dressed as the SweepResult old builds parse. */
function toSweepShape(
  lookup: NonNullable<Awaited<ReturnType<typeof lookupProduct>>>,
  productId: string,
): LegacySweepResult {
  const detail = lookup.detail;
  const price = detail.price!;
  const prices = lookup.history.map((point) => point.price);

  const low = prices.length ? Math.min(...prices) : null;
  const high = prices.length ? Math.max(...prices) : null;
  const average = prices.length
    ? Math.round(prices.reduce((sum, p) => sum + p, 0) / prices.length)
    : null;

  const claimedPercentOff =
    detail.listPrice !== null && detail.listPrice > price
      ? Math.round(((detail.listPrice - price) / detail.listPrice) * 100)
      : null;

  const sale = judgeSale({
    price,
    listPrice: detail.listPrice,
    low,
    average,
    points: prices.length,
    claimedPercentOff,
  });

  // Every store we did NOT ask. This is the whole reason the old screen stays
  // honest: it turns an empty "cheaper elsewhere" list from a claim into an
  // admission.
  // Only stores that are actually switched on. Naming a disabled retailer as
  // "couldn't reach" would invent an outage that doesn't exist.
  const unreachable = RETAILERS.filter(
    (retailer): retailer is Retailer =>
      retailer !== detail.retailer && isRetailerEnabled(retailer),
  ).map((retailer) => RETAILER_LABELS[retailer]);

  return {
    product: {
      id: productId,
      title: detail.title,
      retailer: detail.retailer,
      retailerLabel: RETAILER_LABELS[detail.retailer],
      url: detail.url,
      imageUrl: detail.images[0] ?? null,
      price,
      listPrice: detail.listPrice,
    },
    sale,
    history: {
      points: prices.length,
      low,
      high,
      average,
      firstSeen: lookup.history[0] ? new Date(lookup.history[0].checkedAt) : null,
    },
    cheaperElsewhere: [],
    similar: [],
    unreachable,
    bestSaving: 0,
    headline: sale.headline,
  };
}
