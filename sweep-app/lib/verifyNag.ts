// lib/verifyNag.ts
//
// When to next remind someone to confirm their email.
//
// Observable rather than component state, because the banner appears on two
// screens at once. Held locally, each copy kept its own `dismissed` flag, so
// closing it on Home did nothing to the one on Profile — you dismissed the
// same message twice and it looked like it hadn't worked.
//
// Snoozed rather than dismissed forever. An unconfirmed address is worth
// mentioning again: it's the difference between recovering an account and
// losing it, and for a subscriber it's the difference between recovering a
// subscription and paying twice. But it is never worth blocking anyone over,
// which is the whole reason this moved off the signup screen.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

const KEY = "sweep.verify.snoozedUntil";

/**
 * Long enough not to be nagging, short enough to catch a typo before the
 * person has built up anything worth losing.
 */
export const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Whether to show the banner right now.
 *
 * Pure, so the three-way distinction can be tested directly: "not loaded yet"
 * must behave differently from "not snoozed", or the banner flashes on screen
 * at launch and then hides itself once the stored value arrives.
 */
export function shouldShowVerifyNag(input: {
  /** False when confirmed, or when nobody is signed in. */
  unconfirmed: boolean;
  /** Epoch ms, or null while still reading from disk. */
  snoozedUntil: number | null;
  now: number;
}): boolean {
  if (!input.unconfirmed) return false;
  if (input.snoozedUntil === null) return false;
  return input.now >= input.snoozedUntil;
}

/** Epoch ms. 0 means never snoozed; null means not yet read from disk. */
let snoozedUntil: number | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export async function loadVerifyNag(): Promise<number> {
  if (snoozedUntil !== null) return snoozedUntil;
  const stored = Number(await AsyncStorage.getItem(KEY));
  snoozedUntil = Number.isFinite(stored) ? stored : 0;
  emit();
  return snoozedUntil;
}

export async function snoozeVerifyNag(now = Date.now()): Promise<void> {
  snoozedUntil = now + SNOOZE_MS;
  // Emitted before the write, so both banners disappear on the tap rather
  // than after a round trip to disk.
  emit();
  await AsyncStorage.setItem(KEY, String(snoozedUntil));
}

/** Cleared once confirmed, so a later sign-up on this device starts fresh. */
export async function clearVerifyNag(): Promise<void> {
  snoozedUntil = 0;
  emit();
  await AsyncStorage.removeItem(KEY);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Null while still reading from disk — deliberately distinct from "not
 * snoozed", so the banner doesn't flash on screen for one frame at launch
 * only to hide itself once the stored value arrives.
 */
export function useVerifyNagSnoozedUntil(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => snoozedUntil,
    () => null,
  );
}
