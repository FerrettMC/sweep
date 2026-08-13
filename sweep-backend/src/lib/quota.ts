// lib/quota.ts
//
// Daily compiled-search budget. This is the one limit that maps directly to
// money — every search fans out to five retailers, and the Amazon leg costs
// Bright Data quota — so it's enforced here, server-side, before any scraping
// starts. The client is told its remaining count purely so it can render it.

import { prisma } from "./prisma.js";
import {
  GUEST_LIMITS,
  MAX_REWARDED_SEARCHES_PER_DAY,
  type Tier,
  effectiveTier,
  TIER_LIMITS,
} from "./tiers.js";

export interface QuotaState {
  used: number;
  limit: number;
  remaining: number;
  /** Extra searches unlocked today by watching rewarded ads. */
  bonus: number;
  /** Whether watching an ad could unlock another search right now. */
  canWatchAd: boolean;
  resetsAt: Date;
}

/**
 * Quota windows roll at midnight UTC rather than 24h-from-first-use, so a user
 * can't extend their day by drifting their usage later and later.
 */
function nextResetAt(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
}

function isStale(resetAt: Date): boolean {
  return resetAt.getTime() <= Date.now();
}

// ---- signed-in users -------------------------------------------------------

/**
 * Read a user's quota, rolling the window over first if the stored reset time
 * has passed. Returns null if the user has no wallet (shouldn't happen —
 * /auth/sync-user creates one — but callers must not crash if it does).
 */
export async function getUserQuota(userId: string): Promise<QuotaState | null> {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) return null;

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

  return state(
    wallet.searchesUsedToday,
    base,
    wallet.bonusSearchesToday,
    wallet.searchesResetAt,
    tier,
  );
}

/**
 * Atomically consume one search. Returns null when the user is out of budget,
 * which the caller must treat as a hard stop — not a warning.
 *
 * The conditional update is what makes this safe under concurrency: two
 * simultaneous requests can't both pass a read-then-write check, because the
 * WHERE clause re-tests the count at write time and the loser matches no rows.
 */
export async function consumeUserSearch(
  userId: string,
): Promise<QuotaState | null> {
  const quota = await getUserQuota(userId);
  if (!quota || quota.remaining <= 0) return null;

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
  if (updated.count === 0) return null;

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
export async function grantRewardedSearch(
  userId: string,
): Promise<QuotaState | null> {
  const quota = await getUserQuota(userId);
  if (!quota || !quota.canWatchAd) return null;

  const updated = await prisma.wallet.updateMany({
    where: {
      userId,
      bonusSearchesToday: { lt: MAX_REWARDED_SEARCHES_PER_DAY },
      searchesResetAt: quota.resetsAt,
    },
    data: { bonusSearchesToday: { increment: 1 } },
  });

  if (updated.count === 0) return null;

  return {
    ...quota,
    bonus: quota.bonus + 1,
    remaining: quota.remaining + 1,
    canWatchAd: quota.bonus + 1 < MAX_REWARDED_SEARCHES_PER_DAY,
  };
}

// ---- manual "check price now" ----------------------------------------------

export interface ManualCheckState {
  used: number;
  /** Null when the tier has no daily cap. */
  limit: number | null;
  remaining: number | null;
  cooldownMinutes: number | null;
  /** When the cooldown expires, if one is currently in force. */
  availableAt: Date | null;
  resetsAt: Date;
}

export type ManualCheckOutcome =
  | { ok: true; state: ManualCheckState }
  | { ok: false; reason: "limit"; state: ManualCheckState }
  | { ok: false; reason: "cooldown"; state: ManualCheckState };

/** Read the manual-check budget without spending any of it. */
export async function getManualCheckState(
  userId: string,
): Promise<ManualCheckState | null> {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) return null;

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
export async function consumeManualCheck(
  userId: string,
): Promise<ManualCheckOutcome | null> {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) return null;

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

function manualState(
  lastCheckAt: Date | null,
  used: number,
  limits: { manualChecksPerDay: number | null; manualCheckCooldownMinutes: number | null },
  resetsAt: Date,
): ManualCheckState {
  const cooldown = limits.manualCheckCooldownMinutes;

  return {
    used,
    limit: limits.manualChecksPerDay,
    remaining:
      limits.manualChecksPerDay === null
        ? null
        : Math.max(0, limits.manualChecksPerDay - used),
    cooldownMinutes: cooldown,
    availableAt:
      cooldown && lastCheckAt
        ? new Date(lastCheckAt.getTime() + cooldown * 60 * 1000)
        : null,
    resetsAt,
  };
}

// ---- guests ----------------------------------------------------------------

export async function getGuestQuota(deviceId: string): Promise<QuotaState> {
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
export async function consumeGuestSearch(
  deviceId: string,
): Promise<QuotaState | null> {
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

  if (existing.searchesUsedToday >= limit) return null;

  const updated = await prisma.guestQuota.updateMany({
    where: {
      deviceId,
      searchesUsedToday: { lt: limit },
      searchesResetAt: existing.searchesResetAt,
    },
    data: { searchesUsedToday: { increment: 1 } },
  });

  if (updated.count === 0) return null;

  return state(
    existing.searchesUsedToday + 1,
    limit,
    0,
    existing.searchesResetAt,
    "free",
    false,
  );
}

// ---- shared ----------------------------------------------------------------

function state(
  used: number,
  limit: number,
  bonus: number,
  resetsAt: Date,
  tier: Tier,
  adsAllowed = true,
): QuotaState {
  return {
    used,
    limit,
    bonus,
    remaining: Math.max(0, limit + bonus - used),
    // Only ad-supported tiers can top up, and only up to the daily ceiling.
    canWatchAd:
      adsAllowed && TIER_LIMITS[tier].showAds && bonus < MAX_REWARDED_SEARCHES_PER_DAY,
    resetsAt,
  };
}

// ---- "Sweep this deal" -----------------------------------------------------
//
// Metered separately from search. A sweep fans out to every other retailer AND
// reads price history, so it costs more than a search and is deliberately a
// small daily allowance rather than something to spend casually.

export interface SweepQuotaState {
  used: number;
  limit: number;
  remaining: number;
  resetsAt: Date;
  /** False on tiers that don't include the feature at all. */
  available: boolean;
}

export async function getSweepQuota(userId: string): Promise<SweepQuotaState | null> {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) return null;

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
export async function consumeSweep(userId: string): Promise<SweepQuotaState | null> {
  const state = await getSweepQuota(userId);
  if (!state || state.remaining <= 0) return null;

  await prisma.wallet.update({
    where: { userId },
    data: { sweepsUsedToday: { increment: 1 } },
  });

  return { ...state, used: state.used + 1, remaining: state.remaining - 1 };
}

// ---- deal radar refreshes --------------------------------------------------
//
// The free tier's radar has no scheduled checks at all, so this counter is its
// entire cost ceiling: a radar only runs when someone taps refresh, and they
// get two taps a day.

export interface RadarRefreshState {
  used: number;
  limit: number;
  remaining: number;
  resetsAt: Date;
}

export async function getRadarRefreshState(
  userId: string,
): Promise<RadarRefreshState | null> {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) return null;

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
export async function consumeRadarRefresh(
  userId: string,
): Promise<RadarRefreshState | null> {
  const state = await getRadarRefreshState(userId);
  if (!state || state.remaining <= 0) return null;

  await prisma.wallet.update({
    where: { userId },
    data: { radarRefreshesToday: { increment: 1 } },
  });

  return { ...state, used: state.used + 1, remaining: state.remaining - 1 };
}

/**
 * Budget for creating a radar or changing its keyword.
 *
 * Separate from refreshes because they defend against different things: the
 * refresh cap bounds how much SCRAPING someone can trigger, this bounds how
 * many different QUESTIONS they can ask. Without it, one radar plus a rename
 * is an unmetered search box.
 */
export interface RadarChangeState {
  used: number;
  limit: number;
  remaining: number;
  resetsAt: Date;
}

export async function getRadarChangeState(
  userId: string,
): Promise<RadarChangeState | null> {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) return null;

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

export async function consumeRadarChange(
  userId: string,
): Promise<RadarChangeState | null> {
  const state = await getRadarChangeState(userId);
  if (!state || state.remaining <= 0) return null;

  await prisma.wallet.update({
    where: { userId },
    data: { radarChangesToday: { increment: 1 } },
  });

  return { ...state, used: state.used + 1, remaining: state.remaining - 1 };
}
