// lib/reviewAsk.ts
//
// Whether the rating dialog is currently open.
//
// Observable because the ask is triggered from five different screens — a
// finished search, a tracked product, a new list, a saved budget entry, a
// product lookup — while the dialog itself is rendered once at the root. The
// alternative was the same dialog copy-pasted into five screens, where four of
// them would drift.

import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function openReviewAsk() {
  if (open) return;
  open = true;
  emit();
}

export function closeReviewAsk() {
  if (!open) return;
  open = false;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useReviewAskOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  );
}
