// lib/pushStatus.ts
//
// Whether price alerts are on, in one place.
//
// Home and Profile both show this, and both used to hold their own copy from
// their own fetch. Enabling alerts in Profile had no way to reach Home, so the
// "Price alerts are off" card sat there being wrong until something forced a
// reload — which reads as the app ignoring what you just did.
//
// Registration is the moment the truth changes, so registration writes here and
// every screen reads from it. Fetches update it too, so a device that had its
// token pruned server-side corrects itself on the next load.

import { useSyncExternalStore } from "react";

/** Null while unknown — not the same as "off", and shouldn't render as it. */
let registered: boolean | null = null;
const listeners = new Set<() => void>();

export function setPushRegistered(value: boolean | null) {
  if (registered === value) return;
  registered = value;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePushRegistered(): boolean | null {
  return useSyncExternalStore(
    subscribe,
    () => registered,
    () => null,
  );
}
