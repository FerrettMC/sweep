// lib/reviewPrompt.ts
//
// Asking for a Play Store rating, once, at a moment worth asking.
//
// Two rules shape everything here.
//
// The first is Google's, and it decides the whole shape. The Play In-App
// Review API forbids asking anything before its sheet — no "do you like the
// app?", no filtering. It also has an undocumented quota, and when that's
// exhausted `requestReview()` resolves normally having shown nothing at all.
//
// So this asks in our own dialog and links to the Play listing instead. That
// sidesteps the rule entirely, because the rule is about the native sheet:
// a dialog of our own that opens the store page is an ordinary link. It's also
// the only version that reliably appears, and the only one where there's room
// to say who made this and why a rating matters.
//
// The second is manners: the prompt lands on a moment the app has just been
// useful, not on launch, and never twice. An immediate ask reads as "rate me
// before you know if I'm any good", which earns one-star reviews from people
// who were only annoyed by the dialog.
//
// Hence: at least a day of ownership, asked after something real was finished,
// and never again either way — whichever way it was answered. The cancel
// button says "No thanks" rather than "Not now" for that reason: the softer
// wording would promise a second ask that never comes. The rules themselves live in reviewGate.ts as a
// pure function, so "only ever once" is tested rather than asserted.

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as StoreReview from "expo-store-review";
import { openReviewAsk } from "./reviewAsk";
import { shouldAskForReview } from "./reviewGate";

const FIRST_SEEN_KEY = "sweep.review.firstSeen";
const ASKED_KEY = "sweep.review.asked";
const ACTIONS_KEY = "sweep.review.actions";

/**
 * Stamp the install date. Safe to call on every launch — only the first sticks.
 *
 * Kept separate from the ask so the clock starts at first launch rather than
 * at the first time someone happened to track something.
 */
export async function noteAppOpened(): Promise<void> {
  try {
    const existing = await AsyncStorage.getItem(FIRST_SEEN_KEY);
    if (!existing) {
      await AsyncStorage.setItem(FIRST_SEEN_KEY, String(Date.now()));
    }
  } catch {
    // A missed stamp only delays the prompt to the next launch.
  }
}

/**
 * Record that something worth counting finished.
 *
 * Called from the end of real actions — a search that returned results, a
 * product tracked, a list made, a purchase logged — never from opening a
 * screen. The count is what separates "has used the app" from "has it
 * installed".
 */
export async function noteAction(): Promise<void> {
  try {
    const current = Number(await AsyncStorage.getItem(ACTIONS_KEY)) || 0;
    await AsyncStorage.setItem(ACTIONS_KEY, String(current + 1));
  } catch {
    // A dropped count only delays the prompt.
  }
}

/** Whether we've already used our one ask. */
export async function hasAsked(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ASKED_KEY)) !== null;
  } catch {
    // Assume we have. Asking twice is worse than never asking.
    return true;
  }
}

/**
 * Ask for a review if this is a good moment. Silent when it isn't.
 *
 * `trackedCount` is passed in rather than fetched so this stays a pure decision
 * the caller can reason about — and so it costs nothing on the common path
 * where we're not going to ask anyway.
 */
export async function maybeAskForReview(): Promise<boolean> {
  try {
    // The cheap disqualifier first, so the common path costs one read.
    if (await hasAsked()) return false;

    // Counted here rather than passed in, so every caller is just "something
    // finished" and none of them has to know what the threshold is.
    await noteAction();

    const [stored, actions] = await AsyncStorage.multiGet([
      FIRST_SEEN_KEY,
      ACTIONS_KEY,
    ]);
    const firstSeenAt = stored[1] ? Number(stored[1]) : null;
    const actionsCompleted = Number(actions[1]) || 0;

    const decision = shouldAskForReview({
      actionsCompleted,
      firstSeenAt: Number.isFinite(firstSeenAt) ? firstSeenAt : null,
      alreadyAsked: false,
      // Our own dialog, so there is no platform capability to check. The
      // store link is checked when they say yes, which is the only moment it
      // matters.
      reviewAvailable: true,
      now: Date.now(),
    });
    if (!decision.ask) return false;

    // Written before the dialog opens, not after, and only once every check
    // has passed. If the app is killed while it's on screen we have still
    // spent our one ask and will not come back — asking twice is worse than
    // never asking.
    await AsyncStorage.setItem(ASKED_KEY, String(Date.now()));
    openReviewAsk();
    return true;
  } catch {
    // Never let a rating prompt break the thing the user was actually doing.
    return false;
  }
}

/**
 * The Play listing, for an explicit "Rate Sweep" tap.
 *
 * Deliberately not `requestReview()`: the platform guidance is that the native
 * sheet belongs on organic moments, and it may show nothing at all once the
 * quota is spent — which, from a button the user deliberately pressed, looks
 * like a broken button. A link to the listing always does something.
 */
export function storeListingUrl(): string | null {
  return StoreReview.storeUrl();
}

/** Test/debug seam: forget that we asked. */
export async function __resetReviewPrompt(): Promise<void> {
  await AsyncStorage.multiRemove([FIRST_SEEN_KEY, ASKED_KEY, ACTIONS_KEY]);
}
