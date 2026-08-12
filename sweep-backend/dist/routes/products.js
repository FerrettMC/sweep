// routes/products.ts
//
// Tracking endpoints. Every one of these is behind requireAuth — tracking
// requires an account, guests only get search and the deals feed.
//
// Tier caps are checked here against the wallet in the database, never against
// anything the client sends.
import { requireAuth } from "../lib/auth.js";
import { recordCheck } from "../lib/health.js";
import { prisma } from "../lib/prisma.js";
import { consumeManualCheck, getManualCheckState } from "../lib/quota.js";
import { checkProduct, upsertScrapedProduct } from "../lib/priceChecker.js";
import { adapters } from "../lib/scrapers/index.js";
import { normalizeProductUrl } from "../lib/scrapers/url.js";
import { isValidTimezone, nextCheckAt, normalizeCheckHours, } from "../lib/schedule.js";
import { RETAILER_LABELS, isRetailer } from "../lib/scrapers/types.js";
import { effectiveTier, historyCutoff, limitsFor } from "../lib/tiers.js";
export async function productRoutes(app) {
    // ---- list everything the user tracks ----
    app.get("/products", { preHandler: requireAuth }, async (request, reply) => {
        const userId = request.userId;
        const wallet = await prisma.wallet.findUnique({ where: { userId } });
        if (!wallet)
            return reply.status(404).send({ error: "No wallet for user" });
        const tracked = await prisma.trackedProduct.findMany({
            where: { userId },
            orderBy: { addedAt: "desc" },
            include: { product: true },
        });
        const limits = limitsFor(wallet);
        return {
            tracked: tracked.map((t) => ({
                id: t.id,
                addedAt: t.addedAt,
                customThreshold: t.customThreshold,
                lastNotifiedAt: t.lastNotifiedAt,
                product: serializeProduct(t.product),
            })),
            limits: {
                maxTrackedProducts: limits.maxTrackedProducts,
                used: tracked.length,
            },
            tier: effectiveTier(wallet),
        };
    });
    // ---- start tracking ----
    // Accepts either a pasted product url, or a retailer + retailerId pair as
    // returned by compiled search.
    app.post("/products/track", { preHandler: requireAuth }, async (request, reply) => {
        const userId = request.userId;
        const body = (request.body ?? {});
        const wallet = await prisma.wallet.findUnique({ where: { userId } });
        if (!wallet)
            return reply.status(404).send({ error: "No wallet for user" });
        const limits = limitsFor(wallet);
        // Cap check happens before any scraping — no point spending a call the
        // user isn't allowed to use.
        const trackedCount = await prisma.trackedProduct.count({ where: { userId } });
        if (trackedCount >= limits.maxTrackedProducts) {
            return reply.status(403).send({
                error: `Your plan tracks up to ${limits.maxTrackedProducts} products.`,
                code: "TRACK_LIMIT_REACHED",
                limit: limits.maxTrackedProducts,
                tier: effectiveTier(wallet),
            });
        }
        // Resolve what we're being asked to track.
        let url;
        let retailer;
        if (body.url) {
            // Handles missing schemes, share/short links, and tracking params — see
            // lib/scrapers/url.ts for why each of those matters.
            const normalized = await normalizeProductUrl(String(body.url));
            if (!normalized.ok) {
                return reply.status(400).send(normalized.reason === "unsupported"
                    ? {
                        error: `Sweep doesn't support ${normalized.detail} yet. Try Amazon, Walmart, Best Buy, Target or eBay.`,
                        code: "UNSUPPORTED_RETAILER",
                        host: normalized.detail,
                    }
                    : {
                        error: "That doesn't look like a product link.",
                        code: "INVALID_URL",
                        detail: normalized.detail,
                    });
            }
            url = normalized.value.url;
            retailer = normalized.value.retailer;
        }
        else if (body.retailer && body.retailerId) {
            if (!isRetailer(body.retailer)) {
                return reply.status(400).send({ error: `Unknown retailer: ${body.retailer}` });
            }
            retailer = body.retailer;
            url = adapters[body.retailer].productUrl(String(body.retailerId));
        }
        else {
            return reply
                .status(400)
                .send({ error: "Provide either a url, or a retailer and retailerId" });
        }
        if (!isRetailer(retailer)) {
            return reply.status(400).send({ error: `Unknown retailer: ${retailer}` });
        }
        // If this product is already in the shared cache and was checked recently,
        // reuse it rather than scraping again — that's the entire point of the
        // shared cache, and it makes tracking a popular item free.
        const existing = await prisma.product.findFirst({
            where: { retailer, url },
        });
        const isFresh = existing?.lastCheckedAt &&
            Date.now() - existing.lastCheckedAt.getTime() < 30 * 60 * 1000;
        let product = existing;
        if (!isFresh) {
            const result = await adapters[retailer].scrapeProduct(url);
            // Tracking is a real scrape, so it feeds health monitoring like any
            // other. Without this, a retailer that only fails on product pages
            // stays invisible — which is exactly how Best Buy's rate limiting
            // hid from the health board.
            await recordCheck({
                retailer,
                status: result.status,
                productId: existing?.id ?? null,
                detail: result.status === "success" ? null : result.detail,
                durationMs: result.durationMs,
            });
            if (result.status !== "success") {
                return reply.status(502).send({
                    error: result.status === "blocked"
                        ? `${RETAILER_LABELS[retailer]} is blocking price checks right now. Try again later.`
                        : `Couldn't read that ${RETAILER_LABELS[retailer]} page right now. Try again in a moment.`,
                    code: result.status === "blocked" ? "RETAILER_BLOCKED" : "SCRAPE_FAILED",
                    retailer,
                });
            }
            product = await upsertScrapedProduct(result.data);
        }
        if (!product) {
            return reply.status(502).send({ error: "Couldn't resolve that product" });
        }
        // Apply the schedule chosen in the confirm dialog, if one was sent.
        if (body.checkHours !== undefined && limits.fixedCheckTimes) {
            const normalized = normalizeCheckHours(body.checkHours, limits.checkTimesPerDay);
            if (!normalized.ok) {
                return reply
                    .status(400)
                    .send({ error: normalized.error, code: "INVALID_SCHEDULE" });
            }
            if (body.timezone !== undefined && !isValidTimezone(body.timezone)) {
                return reply
                    .status(400)
                    .send({ error: "Unrecognised timezone", code: "INVALID_TIMEZONE" });
            }
            await prisma.wallet.update({
                where: { userId },
                data: {
                    checkHours: normalized.hours,
                    ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
                },
            });
        }
        // Idempotent: tracking something twice is a no-op, not an error.
        const tracked = await prisma.trackedProduct.upsert({
            where: { userId_productId: { userId, productId: product.id } },
            create: { userId, productId: product.id },
            update: {},
            include: { product: true },
        });
        return reply.status(201).send({
            tracked: {
                id: tracked.id,
                addedAt: tracked.addedAt,
                customThreshold: tracked.customThreshold,
                product: serializeProduct(tracked.product),
            },
        });
    });
    // ---- preview a pasted link, without tracking it ----
    //
    // Scrapes the product and returns what we found so the user can confirm it's
    // the right item before committing a tracking slot to it. The result is
    // written into the shared Product cache regardless — we paid for the scrape,
    // and the next person to paste the same link gets it free.
    app.post("/products/preview", { preHandler: requireAuth }, async (request, reply) => {
        const userId = request.userId;
        const { url: rawUrl } = (request.body ?? {});
        if (!rawUrl) {
            return reply.status(400).send({ error: "Paste a product link first." });
        }
        const normalized = await normalizeProductUrl(String(rawUrl));
        if (!normalized.ok) {
            return reply.status(400).send(normalized.reason === "unsupported"
                ? {
                    error: `Sweep doesn't support ${normalized.detail} yet. Try Amazon, Walmart, Best Buy, Target or eBay.`,
                    code: "UNSUPPORTED_RETAILER",
                    host: normalized.detail,
                }
                : {
                    error: "That doesn't look like a product link.",
                    code: "INVALID_URL",
                });
        }
        const { url, retailer } = normalized.value;
        const existing = await prisma.product.findFirst({ where: { retailer, url } });
        const isFresh = existing?.lastCheckedAt &&
            Date.now() - existing.lastCheckedAt.getTime() < 30 * 60 * 1000;
        let product = existing;
        if (!isFresh) {
            const result = await adapters[retailer].scrapeProduct(url);
            await recordCheck({
                retailer,
                status: result.status,
                productId: existing?.id ?? null,
                detail: result.status === "success" ? null : result.detail,
                durationMs: result.durationMs,
            });
            if (result.status !== "success") {
                return reply.status(502).send({
                    error: result.status === "blocked"
                        ? `${RETAILER_LABELS[retailer]} is blocking price checks right now. Try again later.`
                        : `Couldn't read that ${RETAILER_LABELS[retailer]} page. Check the link and try again.`,
                    code: result.status === "blocked" ? "RETAILER_BLOCKED" : "SCRAPE_FAILED",
                    retailer,
                });
            }
            product = await upsertScrapedProduct(result.data);
        }
        if (!product) {
            return reply.status(502).send({ error: "Couldn't resolve that product" });
        }
        const wallet = await prisma.wallet.findUnique({ where: { userId } });
        if (!wallet)
            return reply.status(404).send({ error: "No wallet for user" });
        const limits = limitsFor(wallet);
        const trackedCount = await prisma.trackedProduct.count({ where: { userId } });
        const alreadyTracking = await prisma.trackedProduct.findUnique({
            where: { userId_productId: { userId, productId: product.id } },
        });
        return {
            product: serializeProduct(product),
            alreadyTracking: Boolean(alreadyTracking),
            // Everything the confirm dialog needs to decide what to show, so it
            // doesn't have to guess the plan's rules client-side.
            limits: {
                maxTrackedProducts: limits.maxTrackedProducts,
                used: trackedCount,
                canTrack: alreadyTracking !== null || trackedCount < limits.maxTrackedProducts,
                checkTimesPerDay: limits.checkTimesPerDay,
                fixedCheckTimes: limits.fixedCheckTimes,
                checkIntervalMinutes: limits.checkIntervalMinutes,
            },
            schedule: {
                checkHours: wallet.checkHours,
                timezone: wallet.timezone,
                nextCheckAt: limits.fixedCheckTimes
                    ? nextCheckAt(wallet.checkHours, wallet.timezone)
                    : null,
            },
            tier: effectiveTier(wallet),
        };
    });
    // ---- read / update the user's check schedule ----
    app.get("/me/schedule", { preHandler: requireAuth }, async (request, reply) => {
        const wallet = await prisma.wallet.findUnique({
            where: { userId: request.userId },
        });
        if (!wallet)
            return reply.status(404).send({ error: "No wallet for user" });
        const limits = limitsFor(wallet);
        return {
            checkHours: wallet.checkHours,
            timezone: wallet.timezone,
            maxCheckTimes: limits.checkTimesPerDay,
            fixedCheckTimes: limits.fixedCheckTimes,
            checkIntervalMinutes: limits.checkIntervalMinutes,
            nextCheckAt: limits.fixedCheckTimes
                ? nextCheckAt(wallet.checkHours, wallet.timezone)
                : null,
            tier: effectiveTier(wallet),
        };
    });
    app.put("/me/schedule", { preHandler: requireAuth }, async (request, reply) => {
        const userId = request.userId;
        const { checkHours, timezone } = (request.body ?? {});
        const wallet = await prisma.wallet.findUnique({ where: { userId } });
        if (!wallet)
            return reply.status(404).send({ error: "No wallet for user" });
        const limits = limitsFor(wallet);
        // Paid tiers run on a rolling interval, so there are no fixed times to set.
        if (!limits.fixedCheckTimes) {
            return reply.status(400).send({
                error: `Your plan checks every ${limits.checkIntervalMinutes} minutes automatically.`,
                code: "SCHEDULE_NOT_APPLICABLE",
            });
        }
        // The count cap is the load guarantee — enforced here, never client-side.
        const normalized = normalizeCheckHours(checkHours, limits.checkTimesPerDay);
        if (!normalized.ok) {
            return reply.status(400).send({ error: normalized.error, code: "INVALID_SCHEDULE" });
        }
        if (timezone !== undefined && !isValidTimezone(timezone)) {
            return reply.status(400).send({ error: "Unrecognised timezone", code: "INVALID_TIMEZONE" });
        }
        const updated = await prisma.wallet.update({
            where: { userId },
            data: {
                checkHours: normalized.hours,
                ...(timezone !== undefined ? { timezone: timezone } : {}),
            },
        });
        return {
            checkHours: updated.checkHours,
            timezone: updated.timezone,
            maxCheckTimes: limits.checkTimesPerDay,
            nextCheckAt: nextCheckAt(updated.checkHours, updated.timezone),
        };
    });
    // ---- stop tracking ----
    app.delete("/products/track/:id", { preHandler: requireAuth }, async (request, reply) => {
        const userId = request.userId;
        // Scoped by userId so one user can't untrack another's item by guessing
        // an id.
        const deleted = await prisma.trackedProduct.deleteMany({
            where: { userId, id: request.params.id },
        });
        if (deleted.count === 0) {
            return reply.status(404).send({ error: "Not tracking that product" });
        }
        return { ok: true };
    });
    // ---- product detail + price history ----
    app.get("/products/:id", { preHandler: requireAuth }, async (request, reply) => {
        const userId = request.userId;
        const wallet = await prisma.wallet.findUnique({ where: { userId } });
        if (!wallet)
            return reply.status(404).send({ error: "No wallet for user" });
        const product = await prisma.product.findUnique({
            where: { id: request.params.id },
        });
        if (!product)
            return reply.status(404).send({ error: "Product not found" });
        const tier = effectiveTier(wallet);
        const cutoff = historyCutoff(tier);
        const history = await prisma.priceHistory.findMany({
            where: {
                productId: product.id,
                ...(cutoff ? { checkedAt: { gte: cutoff } } : {}),
            },
            orderBy: { checkedAt: "asc" },
            select: { price: true, checkedAt: true },
        });
        const tracked = await prisma.trackedProduct.findUnique({
            where: { userId_productId: { userId, productId: product.id } },
        });
        // Total points ignoring the tier window, so the UI can honestly say
        // "42 more points on Pro" rather than pretending the data doesn't exist.
        const totalPoints = await prisma.priceHistory.count({
            where: { productId: product.id },
        });
        return {
            product: serializeProduct(product),
            history,
            stats: priceStats(history.map((h) => h.price), product.currentPrice),
            tracking: tracked
                ? { id: tracked.id, customThreshold: tracked.customThreshold }
                : null,
            historyWindow: {
                days: cutoff ? Math.round((Date.now() - cutoff.getTime()) / 86_400_000) : null,
                shown: history.length,
                total: totalPoints,
            },
        };
    });
    // ---- custom alert threshold (Ultimate) ----
    app.patch("/products/track/:id", { preHandler: requireAuth }, async (request, reply) => {
        const userId = request.userId;
        const { customThreshold } = (request.body ?? {});
        const wallet = await prisma.wallet.findUnique({ where: { userId } });
        if (!wallet)
            return reply.status(404).send({ error: "No wallet for user" });
        if (!limitsFor(wallet).customThresholds) {
            return reply.status(403).send({
                error: "Custom alert thresholds are an Ultimate feature.",
                code: "TIER_REQUIRED",
                requiredTier: "ultimate",
            });
        }
        // Clearing the threshold is legitimate; anything else must be a sane
        // positive amount in cents. Type-checked, not just range-checked.
        let value = null;
        if (customThreshold !== null && customThreshold !== undefined) {
            if (typeof customThreshold !== "number" ||
                !Number.isInteger(customThreshold) ||
                customThreshold <= 0 ||
                customThreshold > 100_000_000 // $1M ceiling — a typo guard, not a real limit
            ) {
                return reply.status(400).send({
                    error: "customThreshold must be a positive integer number of cents, or null",
                });
            }
            value = customThreshold;
        }
        const updated = await prisma.trackedProduct.updateMany({
            where: { userId, id: request.params.id },
            data: { customThreshold: value },
        });
        if (updated.count === 0) {
            return reply.status(404).send({ error: "Not tracking that product" });
        }
        return { ok: true, customThreshold: value };
    });
    // ---- force a re-check ----
    //
    // "Check price now" in the app. Budget is per tier and enforced here:
    //   free     — 10 a day
    //   pro      — unlimited count, one every 30 minutes
    //   ultimate — unlimited
    app.post("/products/:id/refresh", { preHandler: requireAuth }, async (request, reply) => {
        const userId = request.userId;
        const tracked = await prisma.trackedProduct.findFirst({
            where: { userId, productId: request.params.id },
            include: { product: true },
        });
        if (!tracked) {
            return reply.status(404).send({ error: "Not tracking that product" });
        }
        // If something already checked this product seconds ago — the scheduler,
        // or another user tracking the same item — serve that instead of
        // scraping again. Costs the user nothing from their budget, because they
        // still get a fresh answer.
        const lastChecked = tracked.product.lastCheckedAt;
        if (lastChecked && Date.now() - lastChecked.getTime() < 60_000) {
            return {
                status: "fresh",
                product: serializeProduct(tracked.product),
                manualChecks: await getManualCheckState(userId),
            };
        }
        const outcome = await consumeManualCheck(userId);
        if (!outcome) {
            return reply.status(404).send({ error: "No wallet for user" });
        }
        if (!outcome.ok) {
            const { state } = outcome;
            return reply.status(429).send(outcome.reason === "limit"
                ? {
                    error: `You've used all ${state.limit} manual checks for today. They reset at midnight UTC.`,
                    code: "MANUAL_CHECK_LIMIT_REACHED",
                    manualChecks: state,
                }
                : {
                    error: `Your plan allows one manual check every ${state.cooldownMinutes} minutes.`,
                    code: "MANUAL_CHECK_COOLDOWN",
                    manualChecks: state,
                });
        }
        const result = await checkProduct(tracked.productId);
        const product = await prisma.product.findUnique({
            where: { id: tracked.productId },
        });
        return {
            status: result.status,
            product: product ? serializeProduct(product) : null,
            manualChecks: outcome.state,
        };
    });
    // ---- how many manual checks do I have left? ----
    app.get("/products/manual-checks", { preHandler: requireAuth }, async (request, reply) => {
        const state = await getManualCheckState(request.userId);
        if (!state)
            return reply.status(404).send({ error: "No wallet for user" });
        return { manualChecks: state };
    });
}
// ---- helpers ---------------------------------------------------------------
function serializeProduct(product) {
    return {
        id: product.id,
        retailer: product.retailer,
        retailerId: product.retailerId,
        url: product.url,
        title: product.title,
        imageUrl: product.imageUrl,
        price: product.currentPrice,
        listPrice: product.listPrice,
        currency: product.currency,
        availability: product.availability,
        rating: product.rating,
        ratingCount: product.ratingCount,
        lastCheckedAt: product.lastCheckedAt,
        lastStatus: product.lastStatus,
    };
}
/**
 * The numbers the detail screen shows, and the same basis XP will use in pass
 * 2 ("% below historical average"). Computed from the points the caller is
 * allowed to see, so a free user's "average" reflects their 30-day window.
 */
function priceStats(prices, currentPrice) {
    if (prices.length === 0) {
        return { low: null, high: null, average: null, percentBelowAverage: null };
    }
    const low = Math.min(...prices);
    const high = Math.max(...prices);
    const average = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    const percentBelowAverage = currentPrice !== null && average > 0
        ? Math.round(((average - currentPrice) / average) * 100)
        : null;
    return { low, high, average, percentBelowAverage };
}
