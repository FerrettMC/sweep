// lib/backoff.ts
//
// Adaptive polling: check boring products less often.
//
// Most tracked items sit at the same price for weeks. Checking those at full
// rate buys nothing and, for Amazon, costs real money on every single one. So
// an item that keeps coming back unchanged gets progressively slower checks,
// and snaps straight back to full speed the moment its price actually moves.
//
// Two rules keep this from being a silent downgrade rather than an
// optimisation:
//
//   1. There's a CEILING. Nothing ever backs off past MAX_MULTIPLIER, so no
//      item can quietly go stale however long it sits still.
//   2. Any price change resets the counter to zero immediately. The item is
//      back at full rate on the very next sweep, not gradually.
//
// Because checks are shared across everyone tracking a product, the counter
// lives on Product — if an item is stable, it's stable for all its watchers.
/** Consecutive unchanged checks before we start slowing down at all. */
const PATIENCE = 3;
/** Never check less often than this multiple of the tier's base interval. */
export const MAX_MULTIPLIER = 4;
/**
 * Hard floor on service, regardless of tier or how long something has sat
 * still: every tracked item gets checked at least once a day.
 *
 * Without this, the free tier's 12-hour base stretched to 48 hours — and
 * "we checked your price twice this week" is the kind of thing that makes an
 * app feel like it's quietly not doing the job you asked it to do, even when
 * the small print technically allows it. The saving from backing off free
 * harder than this is negligible; the damage to trust isn't.
 */
export const MAX_GAP_MINUTES = 24 * 60;
/**
 * How much to stretch the check interval for a product, given how many
 * consecutive checks have come back at the same price.
 *
 *   0–2 unchanged → 1×  (full rate — still settling, or actively moving)
 *   3–5 unchanged → 2×
 *   6+  unchanged → 4×  (ceiling)
 */
export function backoffMultiplier(unchangedChecks) {
    if (unchangedChecks < PATIENCE)
        return 1;
    if (unchangedChecks < PATIENCE * 2)
        return 2;
    return MAX_MULTIPLIER;
}
/**
 * How long to actually wait before re-checking this product: the tier's base
 * interval, stretched by the backoff, then clamped so nothing ever exceeds the
 * once-a-day floor.
 */
export function effectiveIntervalMinutes(baseIntervalMinutes, unchangedChecks) {
    const stretched = baseIntervalMinutes * backoffMultiplier(unchangedChecks);
    return Math.min(stretched, MAX_GAP_MINUTES);
}
/**
 * Human-readable reason, for logs and the product screen. Being able to see
 * WHY something is checked less often is what stops this looking like a bug.
 */
export function backoffLabel(unchangedChecks) {
    const multiplier = backoffMultiplier(unchangedChecks);
    if (multiplier === 1)
        return null;
    return `Price hasn't moved in ${unchangedChecks} checks — checking ${multiplier}× less often until it does`;
}
