// routes/search.ts
//
// Compiled multi-site search — the core onboarding flow. One query, results
// from all five retailers side by side, tap to track.
//
// This is the most expensive endpoint in the app (five scrapes, one of them
// metered), so the quota check happens before any work starts, and it is
// spent even if some retailers fail — otherwise a partial outage would make
// searches free.
import { verifySsvCallback } from "../lib/admobSsv.js";
import { optionalAuth, requireAuth } from "../lib/auth.js";
import { recordCheck } from "../lib/health.js";
import { pickHighlights } from "../lib/highlights.js";
import { cacheSearchResults } from "../lib/priceChecker.js";
import { SCRAPE_LIMIT, SENSITIVE_LIMIT } from "../lib/rateLimit.js";
import { prisma } from "../lib/prisma.js";
import { consumeGuestIpSearch, consumeGuestSearch, consumeUserSearch, getGuestQuota, getUserQuota, grantRewardedSearch, } from "../lib/quota.js";
import { routeQuery, searchAllRetailers } from "../lib/scrapers/index.js";
import { RETAILERS, RETAILER_LABELS, isRetailer, } from "../lib/scrapers/types.js";
import { getSearchJob, startAmazonSearch } from "../lib/searchJobs.js";
import { effectiveTier } from "../lib/tiers.js";
const MAX_KEYWORD_LENGTH = 120;
const RESULTS_PER_RETAILER = 4;
export async function searchRoutes(app) {
    // ---- compiled search ----
    app.get("/search", {
        preHandler: optionalAuth,
        config: { rateLimit: SCRAPE_LIMIT },
    }, async (request, reply) => {
        const query = (request.query ?? {});
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
        // Guests are also counted per network, because the device id above is
        // just a header they chose. Without this, rotating it mints unlimited
        // search quota and every search costs an Amazon credit.
        if (!userId) {
            const network = await consumeGuestIpSearch(request.ip);
            if (!network.allowed) {
                return reply.status(429).send({
                    error: "This network has used its guest searches for today. Sign up for your own allowance.",
                    code: "NETWORK_LIMIT_REACHED",
                });
            }
        }
        // Spend the quota first. If this returns null the user is out of budget
        // and no scraping happens at all.
        const quota = userId
            ? await consumeUserSearch(userId)
            : await consumeGuestSearch(deviceId);
        if (!quota) {
            const current = userId
                ? await getUserQuota(userId)
                : await getGuestQuota(deviceId);
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
        // Skip retailers that plainly don't sell what's being searched for — no
        // point asking a clothing site about earbuds. General stores are always
        // included, and an unclassifiable query includes everyone.
        const routing = routeQuery(keyword, only);
        // Amazon is split out of the synchronous path: Bright Data's free tier can
        // take up to ~3 minutes, and making the user stare at a spinner that long
        // for four retailers that answered in 3 seconds is the wrong trade.
        const requested = routing.retailers;
        const fastRetailers = requested.filter((r) => r !== "amazon");
        const wantsAmazon = requested.includes("amazon");
        const amazonJobId = wantsAmazon
            ? startAmazonSearch(keyword, RESULTS_PER_RETAILER)
            : null;
        const outcomes = await searchAllRetailers(keyword, RESULTS_PER_RETAILER, fastRetailers);
        // Search results are real scrape outcomes, so they feed health monitoring
        // exactly like scheduled checks do. Without this, a retailer that only
        // breaks on search would stay invisible.
        await Promise.all(outcomes.map((o) => recordCheck({
            retailer: o.retailer,
            status: o.status,
            detail: o.detail,
            durationMs: o.durationMs,
        })));
        // Keep what we just scraped. Adding one of these to a list or tracking it
        // then needs no scrape at all — see cacheSearchResults.
        await cacheSearchResults(outcomes.flatMap((o) => o.products));
        return {
            keyword,
            quota,
            // The few results worth showing above the per-store columns. Computed
            // here so "cheapest" means the same thing everywhere, and so Amazon
            // arriving late can be folded into the same ranking client-side.
            highlights: pickHighlights(outcomes.flatMap((o) => o.products)),
            // What we decided the query was about, and who we skipped because of it.
            // Sent so the UI can explain an absent store rather than leaving a hole.
            categories: routing.categories,
            skipped: routing.skipped.map((retailer) => ({
                retailer,
                label: RETAILER_LABELS[retailer],
            })),
            // Present when Amazon is still running. The client polls
            // /search/amazon/:id and slots the results in when they arrive.
            amazonJobId,
            results: outcomes.map((outcome) => ({
                retailer: outcome.retailer,
                label: RETAILER_LABELS[outcome.retailer],
                status: outcome.status,
                // Deliberately user-facing text, not the raw error — the raw detail
                // goes to the health log, which is where debugging belongs.
                message: outcome.status === "success"
                    ? null
                    : friendlyMessage(outcome.status),
                products: outcome.products,
            })),
        };
    });
    // ---- poll the Amazon leg of a search ----
    //
    // Cheap and unmetered — the Bright Data call is already in flight, this just
    // reads its state. Safe to poll every few seconds.
    app.get("/search/amazon/:id", { preHandler: optionalAuth }, async (request, reply) => {
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
    });
    // ---- how many searches do I have left? ----
    // Cheap, unmetered, and safe to poll — the Search screen calls this on focus
    // so the counter is right without spending anything.
    app.get("/search/quota", { preHandler: optionalAuth }, async (request, reply) => {
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
    });
    // ---- AdMob server-side verification callback ----
    //
    // Google calls this when a rewarded ad completes. This is the ONLY path that
    // grants a bonus search in production — the client saying "I watched an ad"
    // is not evidence, and a search costs real money on the Amazon leg.
    //
    // Register the URL in the AdMob console against the rewarded ad unit:
    //   https://<your-backend>/ads/admob/ssv
    app.get("/ads/admob/ssv", async (request, reply) => {
        // Verify against the RAW query string. Rebuilding it from parsed params can
        // reorder or re-encode values, and the signature covers the exact bytes.
        const rawQuery = request.raw.url?.split("?")[1] ?? "";
        const result = await verifySsvCallback(rawQuery);
        if (!result.valid) {
            request.log.warn({ reason: result.reason }, "rejected AdMob SSV callback");
            // 200 regardless: a non-2xx makes Google retry a callback that will
            // never verify. The rejection is logged, which is what we actually need.
            return reply.status(200).send({ ok: false });
        }
        // AdMob retries callbacks, so the same completion can arrive twice. The
        // unique constraint is what makes granting idempotent.
        try {
            await prisma.adReward.create({
                data: {
                    transactionId: result.transactionId,
                    userId: result.userId,
                    amount: result.amount,
                },
            });
        }
        catch {
            request.log.info({ transactionId: result.transactionId }, "duplicate SSV callback ignored");
            return reply.status(200).send({ ok: true, duplicate: true });
        }
        const quota = await grantRewardedSearch(result.userId);
        request.log.info({ userId: result.userId, granted: Boolean(quota) }, "AdMob reward verified");
        return reply.status(200).send({ ok: true });
    });
    // ---- development-only reward shortcut ----
    //
    // Lets the reward flow be exercised without a real ad and without AdMob
    // configured. Refuses to run in production, because it is exactly the hole
    // the SSV callback above exists to close.
    app.post("/search/rewarded", {
        preHandler: requireAuth,
        config: { rateLimit: SENSITIVE_LIMIT },
    }, async (request, reply) => {
        if (process.env.NODE_ENV === "production") {
            return reply.status(403).send({
                error: "Rewards are granted by AdMob verification, not by the client.",
                code: "SSV_REQUIRED",
            });
        }
        const quota = await grantRewardedSearch(request.userId);
        if (!quota) {
            return reply.status(403).send({
                error: "No more ad-unlocked searches available today.",
                code: "REWARD_LIMIT_REACHED",
            });
        }
        return { quota, devOnly: true };
    });
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
function parseRetailers(raw) {
    if (!raw)
        return undefined;
    const parts = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    if (parts.length === 0)
        return undefined;
    if (!parts.every(isRetailer))
        return "invalid";
    return parts;
}
function friendlyMessage(status) {
    return status === "blocked"
        ? "This store is blocking us right now."
        : "Couldn't reach this store.";
}
