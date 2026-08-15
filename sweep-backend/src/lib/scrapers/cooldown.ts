// lib/scrapers/cooldown.ts
//
// A circuit breaker per retailer.
//
// The rate gate paces us so we don't *become* a problem. This handles the case
// where we already are one: a retailer has served a challenge page or a 429,
// which means its anti-bot layer has noticed us specifically.
//
// The instinct at that moment is to retry, and that is exactly the wrong move.
// Rate limiting is usually graduated — a short refusal first, a longer one if
// you keep going, an IP ban if you really insist. Every request sent during a
// refusal is evidence that we aren't listening. Walmart has already cost us a
// datacenter IP this way; the cheap insurance is to stop talking for a bit.
//
// So one blocked response opens the circuit for two minutes and every path in
// the app skips that retailer without a request leaving the box. We lose one
// store for two minutes. The alternative is losing it for days.
//
// Deliberately NOT tripped by ordinary failures. A timeout or a parse error is
// our problem, not theirs, and pausing a healthy retailer because our selector
// broke would turn a small bug into an outage.

import type { Retailer } from "./types.js";

/**
 * Long enough to look like we backed off, short enough that a user who
 * searched during a blip sees the store return on their next search.
 */
export const COOLDOWN_MS = 2 * 60 * 1000;

/**
 * Repeat offences get longer, capped. If a retailer blocks us again the moment
 * the circuit closes, two minutes clearly wasn't enough, and continuing to
 * probe every two minutes is the same mistake at a slower rate.
 */
const MAX_COOLDOWN_MS = 30 * 60 * 1000;

/**
 * Consecutive blocks are forgiven once a retailer has behaved for this long
 * *after* a cooldown ended.
 *
 * Measured from when the circuit closed rather than from the last block. Timing
 * it from the block makes the streak self-cancelling: a long cooldown is itself
 * longer than the forgiveness window, so a retailer blocking us the instant it
 * reopened would read as a brand-new incident and never escalate past the
 * fourth strike.
 */
const STREAK_RESET_MS = 15 * 60 * 1000;

interface Breaker {
  openUntil: number;
  /** Consecutive cooldowns, for the backoff. */
  strikes: number;
}

const breakers = new Map<Retailer, Breaker>();

/** Test seam so a suite doesn't have to wait two real minutes. */
let now = () => Date.now();
export function __setClock(fn: () => number) {
  now = fn;
}
export function __reset() {
  breakers.clear();
  now = () => Date.now();
}

/**
 * Record that a retailer refused us. Opens the circuit.
 *
 * Returns when it will close, mostly so callers can log something useful.
 */
export function noteBlocked(retailer: Retailer): number {
  const at = now();
  const existing = breakers.get(retailer);

  // A block well after the previous cooldown ended is a fresh incident, not an
  // escalation. Blocking us again the moment we resumed is an escalation.
  const strikes =
    existing && at - existing.openUntil < STREAK_RESET_MS ? existing.strikes + 1 : 1;

  const wait = Math.min(COOLDOWN_MS * 2 ** (strikes - 1), MAX_COOLDOWN_MS);
  const openUntil = at + wait;
  breakers.set(retailer, { openUntil, strikes });

  console.warn(
    `[cooldown] ${retailer} blocked us — pausing for ${Math.round(wait / 1000)}s ` +
      `(strike ${strikes})`,
  );
  return openUntil;
}

/** A success closes the circuit early and clears the escalation. */
export function noteSuccess(retailer: Retailer): void {
  const existing = breakers.get(retailer);
  if (!existing) return;
  // Only a success while the circuit is *closed* proves recovery; one that
  // somehow lands mid-cooldown shouldn't cancel the pause.
  if (existing.openUntil > now()) return;
  breakers.delete(retailer);
}

/** Milliseconds until this retailer may be contacted again. 0 when free. */
export function cooldownRemaining(retailer: Retailer): number {
  const existing = breakers.get(retailer);
  if (!existing) return 0;
  const left = existing.openUntil - now();
  if (left <= 0) {
    // Keep the strike count: it's what makes a repeat offence back off further.
    return 0;
  }
  return left;
}

export function isCoolingDown(retailer: Retailer): boolean {
  return cooldownRemaining(retailer) > 0;
}

/** For diagnostics and the retailer-status endpoint. */
export function cooldownState(): Record<
  string,
  { remainingMs: number; strikes: number }
> {
  const out: Record<string, { remainingMs: number; strikes: number }> = {};
  for (const [retailer, breaker] of breakers) {
    const remainingMs = Math.max(0, breaker.openUntil - now());
    if (remainingMs > 0) out[retailer] = { remainingMs, strikes: breaker.strikes };
  }
  return out;
}
