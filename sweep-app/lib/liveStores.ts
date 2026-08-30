// lib/liveStores.ts
//
// Which stores are actually live, in one place.
//
// The app shipped with a static list of every retailer it has ever had an
// adapter for, and used it to write copy: "Amazon, Walmart, Best Buy, eBay and
// more" on the home hero, the auth screen and every empty state. Three of those
// are switched off server-side, so the app was advertising stores it does not
// search — and naming Best Buy while asking Best Buy for API access is a
// particularly bad way to be wrong.
//
// Stores go on and off with an environment variable and no release, so the
// truthful list can only come from the server. Every screen that already calls
// getRetailerStatus writes here, and anything that needs to name a store reads
// from here.
//
// The static list stays as the fallback for the first render and for an old
// server that predates the `enabled` field. Naming a store we don't search is
// bad; naming none at all is worse, and would leave "search across  and more"
// on the screen.

import { useSyncExternalStore } from "react";
import { RETAILER_LABELS } from "@/lib/format";

/** Null while unknown, which is not the same as "none". */
let live: string[] | null = null;
const listeners = new Set<() => void>();

/**
 * Record what the server says. Accepts the raw status rows so callers don't
 * each decide what "live" means.
 *
 * `enabled` is optional on the wire — an older server doesn't send it. Missing
 * therefore means "this server has no opinion", and the store is kept, rather
 * than the whole list emptying out against an older backend.
 */
export function setLiveStores(
  rows: { label: string; enabled?: boolean }[] | null | undefined,
) {
  if (!rows || rows.length === 0) return;
  const next = rows.filter((r) => r.enabled !== false).map((r) => r.label);
  if (next.length === 0) return;
  if (live && live.length === next.length && live.every((l, i) => l === next[i])) return;
  live = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): string[] | null {
  return live;
}

/** The live store names, or the static list until the server has answered. */
export function liveStoreNames(): string[] {
  return live ?? Object.values(RETAILER_LABELS);
}

/** Re-renders a screen when the live list arrives or changes. */
export function useLiveStores(): string[] {
  const value = useSyncExternalStore(subscribe, snapshot, () => null);
  return value ?? Object.values(RETAILER_LABELS);
}
