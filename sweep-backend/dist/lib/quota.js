// lib/quota.ts
//
// Daily compiled-search budget. This is the one limit that maps directly to
// money — every search fans out to five retailers, and the Amazon leg costs
// Bright Data quota — so it's enforced here, server-side, before any scraping
// starts. The client is told its remaining count purely so it can render it.
import { createHash } from "node:crypto";
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
export async function getSweepQuota(userId) {
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet)
        return null;
    const limit = TIER_LIMITS[effectiveTier(wallet)].sweepsPerDay;
    if (isStale(wallet.sweepsResetAt)) {
        const resetsAt = nextResetAt();
        await prisma.wallet.update({
            where: { userId },
            data: { sweepsUsedToday: 0, sweepsResetAt: resetsAt },
        });
        return { used: 0, limit, remaining: limit, resetsAt, available: limit > 0 };
    }
    const used = wallet.sweepsUsedToday;
    return {
        used,
        limit,
        remaining: Math.max(0, limit - used),
        resetsAt: wallet.sweepsResetAt,
        available: limit > 0,
    };
}
/**
 * Spend one sweep. Returns null if the user has none left, so the caller can
 * refuse before doing any of the expensive work.
 */
export async function consumeSweep(userId) {
    const state = await getSweepQuota(userId);
    if (!state || state.remaining <= 0)
        return null;
    await prisma.wallet.update({
        where: { userId },
        data: { sweepsUsedToday: { increment: 1 } },
    });
    return { ...state, used: state.used + 1, remaining: state.remaining - 1 };
}
export async function getRadarRefreshState(userId) {
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet)
        return null;
    const limit = TIER_LIMITS[effectiveTier(wallet)].radarRefreshesPerDay;
    if (isStale(wallet.radarRefreshesResetAt)) {
        const resetsAt = nextResetAt();
        await prisma.wallet.update({
            where: { userId },
            data: { radarRefreshesToday: 0, radarRefreshesResetAt: resetsAt },
        });
        return { used: 0, limit, remaining: limit, resetsAt };
    }
    const used = wallet.radarRefreshesToday;
    return {
        used,
        limit,
        remaining: Math.max(0, limit - used),
        resetsAt: wallet.radarRefreshesResetAt,
    };
}
/** Spend one refresh, or return null if there are none left. */
export async function consumeRadarRefresh(userId) {
    const state = await getRadarRefreshState(userId);
    if (!state || state.remaining <= 0)
        return null;
    await prisma.wallet.update({
        where: { userId },
        data: { radarRefreshesToday: { increment: 1 } },
    });
    return { ...state, used: state.used + 1, remaining: state.remaining - 1 };
}
export async function getRadarChangeState(userId) {
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet)
        return null;
    const limit = TIER_LIMITS[effectiveTier(wallet)].radarChangesPerDay;
    if (isStale(wallet.radarChangesResetAt)) {
        const resetsAt = nextResetAt();
        await prisma.wallet.update({
            where: { userId },
            data: { radarChangesToday: 0, radarChangesResetAt: resetsAt },
        });
        return { used: 0, limit, remaining: limit, resetsAt };
    }
    const used = wallet.radarChangesToday;
    return {
        used,
        limit,
        remaining: Math.max(0, limit - used),
        resetsAt: wallet.radarChangesResetAt,
    };
}
export async function consumeRadarChange(userId) {
    const state = await getRadarChangeState(userId);
    if (!state || state.remaining <= 0)
        return null;
    await prisma.wallet.update({
        where: { userId },
        data: { radarChangesToday: { increment: 1 } },
    });
    return { ...state, used: state.used + 1, remaining: state.remaining - 1 };
}
// ---- guest network ceiling -------------------------------------------------
/**
 * Guests are identified by a device id they send us, which anyone can change.
 * That makes GuestQuota a courtesy, not a control: rotate the header and you
 * get a fresh allowance, and every search costs an Amazon credit.
 *
 * So guests are also counted per network. Deliberately generous — offices,
 * schools and mobile carriers put a lot of real people behind one address, and
 * the goal is to stop a script, not to punish a shared connection.
 */
const GUEST_SEARCHES_PER_IP_PER_DAY = 25;
function hashIp(ip) {
    return createHash("sha256").update(`sweep:${ip}`).digest("hex").slice(0, 32);
}
/** Count a guest search against its network, and say whether to allow it. */
export async function consumeGuestIpSearch(ip) {
    const ipHash = hashIp(ip);
    const existing = await prisma.ipQuota.findUnique({ where: { ipHash } });
    if (!existing || isStale(existing.searchesResetAt)) {
        await prisma.ipQuota.upsert({
            where: { ipHash },
            create: { ipHash, searchesUsedToday: 1, searchesResetAt: nextResetAt() },
            update: { searchesUsedToday: 1, searchesResetAt: nextResetAt() },
        });
        return { allowed: true, used: 1, limit: GUEST_SEARCHES_PER_IP_PER_DAY };
    }
    if (existing.searchesUsedToday >= GUEST_SEARCHES_PER_IP_PER_DAY) {
        return {
            allowed: false,
            used: existing.searchesUsedToday,
            limit: GUEST_SEARCHES_PER_IP_PER_DAY,
        };
    }
    const updated = await prisma.ipQuota.update({
        where: { ipHash },
        data: { searchesUsedToday: { increment: 1 } },
    });
    return {
        allowed: true,
        used: updated.searchesUsedToday,
        limit: GUEST_SEARCHES_PER_IP_PER_DAY,
    };
}
