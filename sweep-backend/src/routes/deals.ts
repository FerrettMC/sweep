// routes/deals.ts
//
// The public deals feed. Guests can browse it — it's the one part of the app
// that shows its value before signing up, so gating it would waste the best
// argument for creating an account.

import type { FastifyInstance } from "fastify";
import { optionalAuth } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";
import { displayName } from "../lib/xp.js";

const PAGE_SIZE = 30;
/** Deals older than this stop being useful — the price has probably moved. */
const MAX_AGE_HOURS = 72;

export async function dealRoutes(app: FastifyInstance) {
  app.get("/deals", { preHandler: optionalAuth }, async (request) => {
    const userId = request.userId;
    const since = new Date(Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000);

    const deals = await prisma.deal.findMany({
      where: { createdAt: { gte: since } },
      orderBy: [{ percentBelowAverage: "desc" }, { createdAt: "desc" }],
      take: PAGE_SIZE,
      include: {
        product: true,
        finder: { select: { id: true, username: true } },
      },
    });

    // Which of these the viewer already tracks, so the UI can say "tracking"
    // instead of offering to add something twice.
    const tracked = userId
      ? new Set(
          (
            await prisma.trackedProduct.findMany({
              where: {
                userId,
                productId: { in: deals.map((d) => d.productId) },
              },
              select: { productId: true },
            })
          ).map((t) => t.productId),
        )
      : new Set<string>();

    return {
      deals: deals.map((deal) => ({
        id: deal.id,
        percentBelowAverage: deal.percentBelowAverage,
        previousPrice: deal.previousPrice,
        newPrice: deal.newPrice,
        averagePrice: deal.averagePrice,
        foundAt: deal.createdAt,
        // Never the email — same rule as the leaderboard.
        finder: deal.finder ? displayName(deal.finder) : null,
        foundByMe: Boolean(userId && deal.finderUserId === userId),
        isTracking: tracked.has(deal.productId),
        product: {
          id: deal.product.id,
          retailer: deal.product.retailer,
          retailerId: deal.product.retailerId,
          title: deal.product.title,
          imageUrl: deal.product.imageUrl,
          url: deal.product.url,
          // Live price, which may have moved since the deal was recorded —
          // shown alongside so nobody chases a price that's already gone.
          currentPrice: deal.product.currentPrice,
        },
      })),
      isGuest: !userId,
    };
  });
}
