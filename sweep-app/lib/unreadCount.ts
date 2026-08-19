// lib/unreadCount.ts
//
// How many notifications are waiting, shared across the app.
//
// Observable rather than fetched per component, because the badge lives in the
// tab header while the things that change it happen elsewhere: Home already
// loads the count as part of its own refresh, and opening the notifications
// screen clears it. Without somewhere shared to put the number, the header
// would either poll on its own or show a stale badge after the list had been
// read.

import { useSyncExternalStore } from "react";
import { getNotifications } from "./api";

let unread = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Set from whatever already knows — usually a screen that just fetched. */
export function setUnreadCount(count: number) {
  if (count === unread) return;
  unread = Math.max(0, count);
  emit();
}

/**
 * Ask the server.
 *
 * Swallows failures on purpose: guests have no feed, and a server that
 * predates it has no endpoint. Both mean "no badge", which is also what a
 * network error should look like — a badge is not worth an error message.
 */
export async function refreshUnreadCount(): Promise<void> {
  try {
    setUnreadCount((await getNotifications()).unread);
  } catch {
    setUnreadCount(0);
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useUnreadCount(): number {
  return useSyncExternalStore(
    subscribe,
    () => unread,
    () => 0,
  );
}
