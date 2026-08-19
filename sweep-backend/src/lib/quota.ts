// lib/quota.ts
//
// Daily compiled-search budget. This is the one limit that maps directly to
// money — every search fans out to five retailers, and the Amazon leg costs
// Bright Data quota — so it's enforced here, server-side, before any scraping
// starts. The client is told its remaining count purely so it can render it.

import { createHash } from "node:crypto";
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
    // Guarded on the timestamp we read. Concurrent requests all see "stale",
    // and without this each one resets the counter — wiping increments that
    // just happened and letting extra actions through. Only one rollover
    // wins; the losers re-read and see the window someone else opened.
    const rolled = await prisma.wallet.updateMany({
      where: { userId, searchesResetAt: wallet.searchesResetAt },
      data: { searchesUsedToday: 0, searchesResetAt: reset, bonusSearchesToday: 0 },
    });
    if (rolled.count === 0) return getUserQuota(userId);
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

  // Guarded on the values we read rather than set blindly. Writing
  // `used + 1` from a stale read is how two simultaneous checks both land on
  // the same number — and the cooldown has the same problem, so
  // lastManualCheckAt is part of the condition too.
  const updated = await prisma.wallet.updateMany({
    where: {
      userId,
      manualChecksToday: wallet.manualChecksToday,
      manualChecksResetAt: wallet.manualChecksResetAt,
      lastManualCheckAt: wallet.lastManualCheckAt,
    },
    data: {
      manualChecksToday: used + 1,
      manualChecksResetAt: resetsAt,
      lastManualCheckAt: now,
    },
  });

  // Someone else checked between our read and our write. Refusing is right:
  // whatever they spent, this request would be spending it twice.
  if (updated.count === 0) return { ok: false, reason: "cooldown", state };

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
/**
 * Give a search back after the fact.
 *
 * Quota is spent before scraping so that two requests can't both slip past the
 * check, which means a search where every retailer failed still costs one. That
 * is the version of the limit nobody agreed to: the daily allowance is meant to
 * bound work we actually do, not to charge for our own outages.
 *
 * Deliberately does not restore below zero, and does nothing if the day rolled
 * over in between — refunding into a fresh day would hand out a free extra.
 */
export async function refundUserSearch(
  userId: string,
  resetsAt: Date,
): Promise<void> {
  await prisma.wallet.updateMany({
    where: { userId, searchesUsedToday: { gt: 0 }, searchesResetAt: resetsAt },
    data: { searchesUsedToday: { decrement: 1 } },
  });
}

export async function refundGuestSearch(
  deviceId: string,
  resetsAt: Date,
): Promise<void> {
  await prisma.guestQuota.updateMany({
    where: { deviceId, searchesUsedToday: { gt: 0 }, searchesResetAt: resetsAt },
    data: { searchesUsedToday: { decrement: 1 } },
  });
}

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

/**
 * A guest's product-lookup allowance.
 *
 * Small, because a guest is identified only by a device id — the one identity
 * in the app that can be discarded and reissued for free. This is a taste of
 * the feature, not a way to live without an account.
 */
export async function getGuestLookupQuota(
  deviceId: string,
): Promise<LookupQuotaState> {
  const limit = GUEST_LIMITS.lookupsPerDay;
  const row = await prisma.guestQuota.findUnique({ where: { deviceId } });

  if (!row || isStale(row.lookupsResetAt)) {
    return {
      used: 0,
      limit,
      remaining: limit,
      resetsAt: row?.lookupsResetAt ?? nextResetAt(),
      available: limit > 0,
    };
  }

  return {
    used: row.lookupsUsedToday,
    limit,
    remaining: Math.max(0, limit - row.lookupsUsedToday),
    resetsAt: row.lookupsResetAt,
    available: limit > 0,
  };
}

/**
 * Spend one guest lookup, creating the row on first use.
 *
 * Same shape as consumeGuestSearch, including the reason every branch writes
 * through a condition rather than a bare update: two requests from one device
 * arriving together must not both pass.
 */
export async function consumeGuestLookup(
  deviceId: string,
): Promise<LookupQuotaState | null> {
  const limit = GUEST_LIMITS.lookupsPerDay;
  const reset = nextResetAt();
  const spent = (used: number, resetsAt: Date): LookupQuotaState => ({
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resetsAt,
    available: limit > 0,
  });

  const existing = await prisma.guestQuota.findUnique({ where: { deviceId } });

  if (!existing) {
    // createMany rather than create: two first-ever requests from the same
    // device race here, and the loser would otherwise throw on the unique
    // index instead of simply spending from the row that won.
    const made = await prisma.guestQuota.createMany({
      data: [{ deviceId, lookupsUsedToday: 1, lookupsResetAt: reset }],
      skipDuplicates: true,
    });
    if (made.count === 1) return spent(1, reset);
    return consumeGuestLookup(deviceId);
  }

  if (isStale(existing.lookupsResetAt)) {
    // Guarded on the timestamp we read, so concurrent rollovers don't each
    // reset the counter and hand out an extra lookup apiece.
    const rolled = await prisma.guestQuota.updateMany({
      where: { deviceId, lookupsResetAt: existing.lookupsResetAt },
      data: { lookupsUsedToday: 1, lookupsResetAt: reset },
    });
    if (rolled.count === 0) return consumeGuestLookup(deviceId);
    return spent(1, reset);
  }

  if (existing.lookupsUsedToday >= limit) return null;

  const updated = await prisma.guestQuota.updateMany({
    where: {
      deviceId,
      lookupsUsedToday: { lt: limit },
      lookupsResetAt: existing.lookupsResetAt,
    },
    data: { lookupsUsedToday: { increment: 1 } },
  });

  if (updated.count === 0) return null;

  return spent(existing.lookupsUsedToday + 1, existing.lookupsResetAt);
}

/**
 * Give a lookup back when it produced nothing.
 *
 * Same contract as refundUserSearch: never below zero, and never across a
 * rollover, because refunding into a fresh day is just a free extra.
 */
export async function refundUserLookup(
  userId: string,
  resetsAt: Date,
): Promise<void> {
  await prisma.wallet.updateMany({
    where: { userId, sweepsUsedToday: { gt: 0 }, sweepsResetAt: resetsAt },
    data: { sweepsUsedToday: { decrement: 1 } },
  });
}

export async function refundGuestLookup(
  deviceId: string,
  resetsAt: Date,
): Promise<void> {
  await prisma.guestQuota.updateMany({
    where: { deviceId, lookupsUsedToday: { gt: 0 }, lookupsResetAt: resetsAt },
    data: { lookupsUsedToday: { decrement: 1 } },
  });
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

// ---- product lookups -------------------------------------------------------
//
// Metered separately from search, on its own counter, because they are
// different actions: a search finds candidates across stores, a lookup reads
// one product deeply. Someone spending an afternoon reading product pages
// shouldn't lose the ability to search, and vice versa.
//
// The database columns are still named `sweeps*`. This counter replaced "Sweep
// this deal" in place, and renaming a live column buys a migration and a
// window where old and new backends disagree — for a name only we read.

export interface LookupQuotaState {
  used: number;
  limit: number;
  remaining: number;
  resetsAt: Date;
  /** False on tiers that don't include the feature at all. */
  available: boolean;
}

export async function getLookupQuota(userId: string): Promise<LookupQuotaState | null> {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) return null;

  const limit = TIER_LIMITS[effectiveTier(wallet)].lookupsPerDay;

  if (isStale(wallet.sweepsResetAt)) {
    const resetsAt = nextResetAt();
    // Guarded on the timestamp we read. Concurrent requests all see "stale",
    // and without this each one resets the counter — wiping increments that
    // just happened and letting extra actions through. Only one rollover
    // wins; the losers re-read and see the window someone else opened.
    const rolled = await prisma.wallet.updateMany({
      where: { userId, sweepsResetAt: wallet.sweepsResetAt },
      data: { sweepsUsedToday: 0, sweepsResetAt: resetsAt },
    });
    if (rolled.count === 0) return getLookupQuota(userId);
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
 * Spend one lookup. Returns null if the user has none left, so the caller can
 * refuse before doing any of the expensive work.
 */
export async function consumeLookup(userId: string): Promise<LookupQuotaState | null> {
  const state = await getLookupQuota(userId);
  if (!state || state.remaining <= 0) return null;

  // The limit lives in the WHERE, not in the check above, so the read and the
  // write can't be separated. Two requests arriving together both pass the
  // check; only one matches this condition, because Postgres serialises
  // updates to a row. The margin is wider than it was when this was 1/day,
  // but the reason is unchanged: a limit enforced by a read-then-write is not
  // a limit, it's a suggestion.
  const updated = await prisma.wallet.updateMany({
    where: {
      userId,
      sweepsUsedToday: { lt: state.limit },
      sweepsResetAt: state.resetsAt,
    },
    data: { sweepsUsedToday: { increment: 1 } },
  });

  // Lost the race — someone spent the last one between our read and our write.
  if (updated.count === 0) return null;

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
    // Guarded on the timestamp we read. Concurrent requests all see "stale",
    // and without this each one resets the counter — wiping increments that
    // just happened and letting extra actions through. Only one rollover
    // wins; the losers re-read and see the window someone else opened.
    const rolled = await prisma.wallet.updateMany({
      where: { userId, radarRefreshesResetAt: wallet.radarRefreshesResetAt },
      data: { radarRefreshesToday: 0, radarRefreshesResetAt: resetsAt },
    });
    if (rolled.count === 0) return getRadarRefreshState(userId);
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

  const updated = await prisma.wallet.updateMany({
    where: {
      userId,
      radarRefreshesToday: { lt: state.limit },
      radarRefreshesResetAt: state.resetsAt,
    },
    data: { radarRefreshesToday: { increment: 1 } },
  });
  if (updated.count === 0) return null;

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
    // Guarded on the timestamp we read. Concurrent requests all see "stale",
    // and without this each one resets the counter — wiping increments that
    // just happened and letting extra actions through. Only one rollover
    // wins; the losers re-read and see the window someone else opened.
    const rolled = await prisma.wallet.updateMany({
      where: { userId, radarChangesResetAt: wallet.radarChangesResetAt },
      data: { radarChangesToday: 0, radarChangesResetAt: resetsAt },
    });
    if (rolled.count === 0) return getRadarChangeState(userId);
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

  const updated = await prisma.wallet.updateMany({
    where: {
      userId,
      radarChangesToday: { lt: state.limit },
      radarChangesResetAt: state.resetsAt,
    },
    data: { radarChangesToday: { increment: 1 } },
  });
  if (updated.count === 0) return null;

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

function hashIp(ip: string): string {
  return createHash("sha256").update(`sweep:${ip}`).digest("hex").slice(0, 32);
}

export interface IpQuotaResult {
  allowed: boolean;
  used: number;
  limit: number;
}

/** Count a guest search against its network, and say whether to allow it. */
export async function consumeGuestIpSearch(ip: string): Promise<IpQuotaResult> {
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

  // This one guards abuse rather than cost, so racing past it is worth more
  // to an attacker than a spare search is to a user.
  const updated = await prisma.ipQuota.updateMany({
    where: {
      ipHash,
      searchesUsedToday: { lt: GUEST_SEARCHES_PER_IP_PER_DAY },
      searchesResetAt: existing.searchesResetAt,
    },
    data: { searchesUsedToday: { increment: 1 } },
  });

  if (updated.count === 0) {
    return {
      allowed: false,
      used: GUEST_SEARCHES_PER_IP_PER_DAY,
      limit: GUEST_SEARCHES_PER_IP_PER_DAY,
    };
  }

  return {
    allowed: true,
    used: existing.searchesUsedToday + 1,
    limit: GUEST_SEARCHES_PER_IP_PER_DAY,
  };
}
