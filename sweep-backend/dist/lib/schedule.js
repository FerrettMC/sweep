// lib/schedule.ts
//
// Fixed check times for the free tier: "check my products at 9am and 9pm".
//
// The whole point of fixed times over a rolling interval is that load is
// predictable — N users produce at most 2N checks a day regardless of when
// they signed up or how often they open the app.
//
// Times are stored as local hours plus an IANA timezone rather than as UTC,
// because "9am" has to keep meaning 9am after the clocks change.
const MAX_LOOKBACK_HOURS = 72;
/** Hours must be whole numbers in 0-23, unique, and non-empty. */
export function normalizeCheckHours(input, maxCount) {
    if (!Array.isArray(input)) {
        return { ok: false, error: "checkHours must be an array of hours" };
    }
    const hours = [...new Set(input)];
    if (hours.length !== input.length) {
        return { ok: false, error: "checkHours must not repeat the same hour" };
    }
    if (hours.length === 0) {
        return { ok: false, error: "Pick at least one check time" };
    }
    if (hours.length > maxCount) {
        return {
            ok: false,
            error: `Your plan allows ${maxCount} check ${maxCount === 1 ? "time" : "times"} a day`,
        };
    }
    for (const hour of hours) {
        if (typeof hour !== "number" || !Number.isInteger(hour) || hour < 0 || hour > 23) {
            return { ok: false, error: "Each check time must be a whole hour from 0 to 23" };
        }
    }
    return { ok: true, hours: hours.sort((a, b) => a - b) };
}
/** Is this a timezone Node actually knows about? */
export function isValidTimezone(timezone) {
    if (typeof timezone !== "string" || !timezone)
        return false;
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: timezone });
        return true;
    }
    catch {
        return false;
    }
}
/** Minutes since local midnight at a given instant, in a given zone. */
export function localMinutesOfDay(instant, timezone) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "numeric",
        minute: "numeric",
        hour12: false,
    }).formatToParts(instant);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    return hour * 60 + minute;
}
/**
 * Is an interval-tier user due for a check?
 *
 * Slots are anchored to LOCAL MIDNIGHT plus the user's minute offset, so
 * "every 2 hours at :35" means 00:35, 02:35, 04:35 — predictable clock times
 * rather than "two hours after whenever the last check happened to run".
 *
 * Works by finding how long ago the most recent slot was and comparing the
 * last check against it. Deriving the slot from elapsed minutes rather than
 * constructing a local datetime avoids having to reverse a timezone offset,
 * which is where this kind of code usually goes wrong.
 */
export function isDueAtInterval(lastCheckedAt, intervalMinutes, minuteOffset, timezone, now = new Date()) {
    if (!lastCheckedAt)
        return true;
    if (intervalMinutes <= 0)
        return false;
    const local = localMinutesOfDay(now, timezone);
    const sinceSlot = (((local - minuteOffset) % intervalMinutes) + intervalMinutes) % intervalMinutes;
    const lastSlot = new Date(now.getTime() - sinceSlot * 60 * 1000);
    lastSlot.setSeconds(0, 0);
    return lastCheckedAt < lastSlot;
}
/** When the next interval slot lands, for display. */
export function nextIntervalCheckAt(intervalMinutes, minuteOffset, timezone, now = new Date()) {
    if (intervalMinutes <= 0)
        return null;
    const local = localMinutesOfDay(now, timezone);
    const sinceSlot = (((local - minuteOffset) % intervalMinutes) + intervalMinutes) % intervalMinutes;
    const next = new Date(now.getTime() + (intervalMinutes - sinceSlot) * 60 * 1000);
    next.setSeconds(0, 0);
    return next;
}
/** Validate a minute offset against what the tier allows. */
export function normalizeCheckMinute(input, max) {
    if (typeof input !== "number" || !Number.isInteger(input)) {
        return { ok: false, error: "Check minute must be a whole number" };
    }
    if (input < 0 || input > max) {
        return { ok: false, error: `Check minute must be between 0 and ${max}` };
    }
    return { ok: true, minute: input };
}
/** The local hour (0-23) at a given instant, in a given zone. */
export function localHourAt(instant, timezone) {
    const formatted = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "numeric",
        hour12: false,
    }).format(instant);
    // "24" shows up for midnight in some locales/versions.
    return Number(formatted) % 24;
}
/**
 * Has one of the user's scheduled check times passed since we last checked?
 *
 * Walks hour boundaries between the last check and now, and asks what local
 * hour each one was in the user's zone. Doing it this way rather than
 * computing UTC offsets means DST is handled by Intl rather than by us.
 *
 * A product never checked before is always due.
 */
export function isDueAtFixedTimes(lastCheckedAt, checkHours, timezone, now = new Date()) {
    if (!lastCheckedAt)
        return true;
    if (checkHours.length === 0)
        return false;
    const wanted = new Set(checkHours);
    // Start at the top of the hour after the last check, and step forward.
    const cursor = new Date(lastCheckedAt);
    cursor.setMinutes(0, 0, 0);
    cursor.setHours(cursor.getHours() + 1);
    // A product left unchecked for days shouldn't cost an unbounded loop; if any
    // scheduled hour fell in the last 72h we'd have found it well inside that.
    const earliest = new Date(now.getTime() - MAX_LOOKBACK_HOURS * 60 * 60 * 1000);
    if (cursor < earliest)
        return true;
    while (cursor <= now) {
        if (wanted.has(localHourAt(cursor, timezone)))
            return true;
        cursor.setHours(cursor.getHours() + 1);
    }
    return false;
}
/**
 * When the next scheduled check lands, so the UI can say "next check 9:00 PM"
 * rather than leaving the user guessing.
 */
export function nextCheckAt(checkHours, timezone, now = new Date()) {
    if (checkHours.length === 0)
        return null;
    const wanted = new Set(checkHours);
    const cursor = new Date(now);
    cursor.setMinutes(0, 0, 0);
    cursor.setHours(cursor.getHours() + 1);
    // 48 steps covers a full day in every real zone, including the 30/45-minute
    // offsets and DST days that are 23 or 25 hours long.
    for (let i = 0; i < 48; i++) {
        if (wanted.has(localHourAt(cursor, timezone)))
            return new Date(cursor);
        cursor.setHours(cursor.getHours() + 1);
    }
    return null;
}
/** "9:00 AM" for display, in the user's own zone. */
export function formatHour(hour, timezone = "UTC") {
    const sample = new Date(Date.UTC(2024, 0, 1, hour));
    return new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: "UTC",
    }).format(sample);
}
