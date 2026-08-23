// lib/toast.ts
//
// Brief confirmation for actions that don't warrant a dialog.
//
// Observable rather than local state, because the actions that need it happen
// on several screens while the toast itself is rendered once at the root. It
// also has to survive the screen scrolling: a notice at the top of a long list
// is invisible to someone who tapped a row at the bottom, which is the same as
// no feedback at all.

import { useSyncExternalStore } from "react";

export interface ToastState {
  message: string;
  tone: "ok" | "bad";
  /** Changes on every call, so an identical repeat still re-triggers. */
  id: number;
}

let state: ToastState | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Long enough to read a few words, short enough not to sit in the way. */
const VISIBLE_MS = 2200;

export function toast(message: string, tone: "ok" | "bad" = "ok") {
  // The id changes even when the text doesn't, so adding two things in a row
  // re-shows the confirmation instead of looking like nothing happened.
  state = { message, tone, id: Date.now() };
  emit();

  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    state = null;
    timer = null;
    emit();
  }, VISIBLE_MS);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useToast(): ToastState | null {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => null,
  );
}
