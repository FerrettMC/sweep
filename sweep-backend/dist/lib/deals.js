// lib/deals.ts
//
// The "Best Deals Found" feed — genuinely good drops, surfaced to everyone.
//
// It costs nothing extra to produce: the scheduler is already checking these
// prices and already knows each product's history, so a deal is just that same
// data written down when it clears a bar.
//
// Attribution goes to whoever tracked the product FIRST. With the shared cache
// many people watch the same item, and the one who spotted it before everyone
// else is the one worth crediting — that's what makes the feed social rather
// than a bare list of discounts.
import { prisma } from "./prisma.js";
/**
 * Bar for the public feed, deliberately higher than the 10% that earns XP.
 * XP rewards noticing a decent drop; the feed is for things worth interrupting
 * strangers about.
 */
export const FEED_MIN_PERCENT = 20;
/** One entry per product per this window, so an oscillating price can't spam. */
const DEAL_COOLDOWN_HOURS = 24;
/**
 * Record a drop on the public feed if it's good enough and recent enough.
 * Returns null when it doesn't qualify — which is the common case.
 */
export async function recordDeal(params) {
    const { productId, previousPrice, newPrice } = params;
    const history = await prisma.priceHistory.findMany({
        where: { productId },
        select: { price: true },
    });
    // Same reasoning as XP: without a few points there's no "normal" to be below.
    if (history.length < 3)
        return null;
    const averagePrice = Math.round(history.reduce((sum, point) => sum + point.price, 0) / history.length);
    if (averagePrice <= 0)
        return null;
    const percentBelowAverage = Math.round(((averagePrice - newPrice) / averagePrice) * 100);
    if (percentBelowAverage < FEED_MIN_PERCENT)
        return null;
    const cutoff = new Date(Date.now() - DEAL_COOLDOWN_HOURS * 60 * 60 * 1000);
    const recent = await prisma.deal.findFirst({
        where: { productId, createdAt: { gte: cutoff } },
        select: { id: true },
    });
    if (recent)
        return null;
    // Earliest tracker = the finder.
    const firstTracker = await prisma.trackedProduct.findFirst({
        where: { productId },
        orderBy: { addedAt: "asc" },
        select: { userId: true },
    });
    const deal = await prisma.deal.create({
        data: {
            productId,
            previousPrice,
            newPrice,
            percentBelowAverage,
            averagePrice,
            finderUserId: firstTracker?.userId ?? null,
        },
        select: { id: true, percentBelowAverage: true, finderUserId: true },
    });
    return deal;
}
