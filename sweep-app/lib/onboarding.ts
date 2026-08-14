// lib/onboarding.ts
//
// Whether this device has been walked through the app yet.
//
// Stored per-device rather than per-account on purpose: the tour runs before
// anyone has an account, and someone who's already seen it shouldn't sit
// through it again just because they signed out.
//
// Observable for the same reason guest mode is — the routing gate reads it, and
// a value that only lives in AsyncStorage leaves the gate deciding on a stale
// copy the moment the tour finishes.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

const KEY = "sweep_onboarding_seen";

/** Null until read from disk — the gate must not route on a guess. */
let seen: boolean | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export async function hasSeenOnboarding(): Promise<boolean> {
  if (seen !== null) return seen;
  seen = (await AsyncStorage.getItem(KEY)) === "true";
  emit();
  return seen;
}

export async function markOnboardingSeen() {
  seen = true;
  emit();
  await AsyncStorage.setItem(KEY, "true");
}

/** Dev helper: run the tour again on the next launch. */
export async function resetOnboarding() {
  seen = false;
  emit();
  await AsyncStorage.removeItem(KEY);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useHasSeenOnboarding(): boolean | null {
  return useSyncExternalStore(
    subscribe,
    () => seen,
    () => null,
  );
}
