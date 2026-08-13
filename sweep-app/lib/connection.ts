// lib/connection.ts
//
// Whether Sweep can currently reach its backend.
//
// Deliberately inferred from real requests rather than from a network-state
// library. What matters here isn't whether the phone has a radio signal — it's
// whether *our* API is answering. A phone on hotel wifi that hasn't accepted
// the captive portal is "connected" by every OS measure and completely useless
// to us, and that's exactly the case where a wrong answer is most confusing.
//
// This exists because the alternative was worse than an error: screens that
// swallowed a failed fetch and rendered their defaults, so being offline
// silently told people they were on the free tier with nothing tracked.

import { useSyncExternalStore } from "react";

let online = true;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Called by lib/api on any response at all — even a 500 means we reached it. */
export function markReachable() {
  if (online) return;
  online = true;
  emit();
}

/** Called by lib/api when the request never made it out. */
export function markUnreachable() {
  if (!online) return;
  online = false;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useIsOnline(): boolean {
  // Optimistic default: assume reachable until something actually fails, so a
  // cold start doesn't flash an error before the first request completes.
  return useSyncExternalStore(
    subscribe,
    () => online,
    () => true,
  );
}
