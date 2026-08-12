// lib/quota.ts
//
// Daily compiled-search budget. This is the one limit that maps directly to
// money — every search fans out to five retailers, and the Amazon leg costs
// Bright Data quota — so it's enforced here, server-side, before any scraping
// starts. The client is told its remaining count purely so it can render it.
import { prisma } from "./prisma.js";
import { GUEST_LIMITS, MAX_REWARDED_SEARCHES_PER_DAY, effectiveTier, TIER_LIMITS, } from "./tiers.js";
/**
 * Quota windows roll at midnight UTC rather than 24h-from-first-use, so a user
 * can't extend their day by drifting their usage later and later.
 */
function nextResetAt() {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}
function isStale(resetAt) {
    return resetAt.getTime() <= Date.now();
}
// ---- signed-in users -------------------------------------------------------
/**
 * Read a user's quota, rolling the window over first if the stored reset time
 * has passed. Returns null if the user has no wallet (shouldn't happen —
 * /auth/sync-user creates one — but callers must not crash if it does).
 */
export async function getUserQuota(userId) {
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet)
        return null;
    const tier = effectiveTier(wallet);
    const base = TIER_LIMITS[tier].searchesPerDay;
    if (isStale(wallet.searchesResetAt)) {
        const reset = nextResetAt();
        await prisma.wallet.update({
            where: { userId },
            data: { searchesUsedToday: 0, searchesResetAt: reset, bonusSearchesToday: 0 },
        });
        return state(0, base, 0, reset, tier);
    }
    return state(wallet.searchesUsedToday, base, wallet.bonusSearchesToday, wallet.searchesResetAt, tier);
}
/**
 * Atomically consume one search. Returns null when the user is out of budget,
 * which the caller must treat as a hard stop — not a warning.
 *
 * The conditional update is what makes this safe under concurrency: two
 * simultaneous requests can't both pass a read-then-write check, because the
 * WHERE clause re-tests the count at write time and the loser matches no rows.
 */
export async function consumeUserSearch(userId) {
    const quota = await getUserQuota(userId);
    if (!quota || quota.remaining <= 0)
        return null;
    const updated = await prisma.wallet.updateMany({
        where: {
            userId,
            searchesUsedToday: { lt: quota.limit + quota.bonus },
            searchesResetAt: quota.resetsAt,
        },
        data: { searchesUsedToday: { increment: 1 } },
    });
    // Lost the race — someone else spent the last search between our read and
    // our write.
    if (updated.count === 0)
        return null;
    return { ...quota, used: quota.used + 1, remaining: quota.remaining - 1 };
}
/**
 * Grant one extra search for a watched rewarded ad. Capped per day so the
 * mechanic stays a top-up rather than an unlimited bypass.
 *
 * NOTE: this trusts the client's claim that an ad was watched. Before launch
 * this must verify AdMob's server-side verification (SSV) callback instead —
 * see docs/INTEGRATIONS.md.
 */
export async function grantRewardedSearch(userId) {
    const quota = await getUserQuota(userId);
    if (!quota || !quota.canWatchAd)
        return null;
    const updated = await prisma.wallet.updateMany({
        where: {
            userId,
            bonusSearchesToday: { lt: MAX_REWARDED_SEARCHES_PER_DAY },
            searchesResetAt: quota.resetsAt,
        },
        data: { bonusSearchesToday: { increment: 1 } },
    });
    if (updated.count === 0)
        return null;
    return {
        ...quota,
        bonus: quota.bonus + 1,
        remaining: quota.remaining + 1,
        canWatchAd: quota.bonus + 1 < MAX_REWARDED_SEARCHES_PER_DAY,
    };
}
/** Read the manual-check budget without spending any of it. */
export async function getManualCheckState(userId) {
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet)
        return null;
    const limits = TIER_LIMITS[effectiveTier(wallet)];
    const stale = isStale(wallet.manualChecksResetAt);
    const used = stale ? 0 : wallet.manualChecksToday;
    return manualState(wallet.lastManualCheckAt, used, limits, stale ? nextResetAt() : wallet.manualChecksResetAt);
}
/**
 * Spend one manual check.
 *
 * Two different limits apply depending on tier, and both are enforced here so
 * the client can't decide it's allowed. Ultimate passes straight through.
 */
export async function consumeManualCheck(userId) {
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet)
        return null;
    const limits = TIER_LIMITS[effectiveTier(wallet)];
    const now = new Date();
    // Roll the daily window over first, so a stale count can't block a new day.
    const stale = isStale(wallet.manualChecksResetAt);
    const used = stale ? 0 : wallet.manualChecksToday;
    const resetsAt = stale ? nextResetAt() : wallet.manualChecksResetAt;
    const state = manualState(wallet.lastManualCheckAt, used, limits, resetsAt);
    if (limits.manualChecksPerDay !== null && used >= limits.manualChecksPerDay) {
        return { ok: false, reason: "limit", state };
    }
    if (state.availableAt && state.availableAt > now) {
        return { ok: false, reason: "cooldown", state };
    }
    await prisma.wallet.update({
        where: { userId },
        data: {
            manualChecksToday: used + 1,
            manualChecksResetAt: resetsAt,
            lastManualCheckAt: now,
        },
    });
    return { ok: true, state: manualState(now, used + 1, limits, resetsAt) };
}
function manualState(lastCheckAt, used, limits, resetsAt) {
    const cooldown = limits.manualCheckCooldownMinutes;
    return {
        used,
        limit: limits.manualChecksPerDay,
        remaining: limits.manualChecksPerDay === null
            ? null
            : Math.max(0, limits.manualChecksPerDay - used),
        cooldownMinutes: cooldown,
        availableAt: cooldown && lastCheckAt
            ? new Date(lastCheckAt.getTime() + cooldown * 60 * 1000)
            : null,
        resetsAt,
    };
}
// ---- guests ----------------------------------------------------------------
export async function getGuestQuota(deviceId) {
    const limit = GUEST_LIMITS.searchesPerDay;
    const row = await prisma.guestQuota.findUnique({ where: { deviceId } });
    if (!row || isStale(row.searchesResetAt)) {
        return state(0, limit, 0, row?.searchesResetAt ?? nextResetAt(), "free", false);
    }
    return state(row.searchesUsedToday, limit, 0, row.searchesResetAt, "free", false);
}
/**
 * Consume one guest search, creating the quota row on first use.
 * Guests get no rewarded-ad top-up — that requires an account.
 */
export async function consumeGuestSearch(deviceId) {
    const limit = GUEST_LIMITS.searchesPerDay;
    const reset = nextResetAt();
    const existing = await prisma.guestQuota.findUnique({ where: { deviceId } });
    if (!existing) {
        await prisma.guestQuota.create({
            data: { deviceId, searchesUsedToday: 1, searchesResetAt: reset },
        });
        return state(1, limit, 0, reset, "free", false);
    }
    if (isStale(existing.searchesResetAt)) {
        await prisma.guestQuota.update({
            where: { deviceId },
            data: { searchesUsedToday: 1, searchesResetAt: reset },
        });
        return state(1, limit, 0, reset, "free", false);
    }
    if (existing.searchesUsedToday >= limit)
        return null;
    const updated = await prisma.guestQuota.updateMany({
        where: {
            deviceId,
            searchesUsedToday: { lt: limit },
            searchesResetAt: existing.searchesResetAt,
        },
        data: { searchesUsedToday: { increment: 1 } },
    });
    if (updated.count === 0)
        return null;
    return state(existing.searchesUsedToday + 1, limit, 0, existing.searchesResetAt, "free", false);
}
// ---- shared ----------------------------------------------------------------
function state(used, limit, bonus, resetsAt, tier, adsAllowed = true) {
    return {
        used,
        limit,
        bonus,
        remaining: Math.max(0, limit + bonus - used),
        // Only ad-supported tiers can top up, and only up to the daily ceiling.
        canWatchAd: adsAllowed && TIER_LIMITS[tier].showAds && bonus < MAX_REWARDED_SEARCHES_PER_DAY,
        resetsAt,
    };
}
