// lib/guestMode.ts
//
// Whether this device is browsing without an account.
//
// Observable rather than read-once, because the routing gate depends on it.
// When the value lived only in AsyncStorage, tapping "Continue as guest" wrote
// it to disk but left the gate's copy stale — so the gate still saw "no access,
// tour unseen" and redirected to onboarding, whose finish handler read the
// fresh value and redirected forward again. An infinite loop between two
// screens, each individually behaving correctly.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

const KEY = "sweep_guest_mode";

/** Null until read from disk — distinct from "not a guest". */
let guest: boolean | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export async function setGuestMode(value: boolean) {
  guest = value;
  emit();
  await AsyncStorage.setItem(KEY, value ? "true" : "false");
}

export async function isGuestMode(): Promise<boolean> {
  if (guest !== null) return guest;
  guest = (await AsyncStorage.getItem(KEY)) === "true";
  emit();
  return guest;
}

/** Load once at start-up so the gate has a real answer before it routes. */
export async function loadGuestMode(): Promise<boolean> {
  return isGuestMode();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useGuestMode(): boolean | null {
  return useSyncExternalStore(
    subscribe,
    () => guest,
    () => null,
  );
}
