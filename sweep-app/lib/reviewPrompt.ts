// lib/reviewPrompt.ts
//
// Asking for a Play Store rating, once, at a moment worth asking.
//
// Two rules shape everything here.
//
// The first is Google's: the Play In-App Review API has an undocumented quota,
// and when it's exhausted `requestReview()` resolves normally without showing
// anything. There is no callback, no result, no way to know whether the sheet
// appeared or whether the person rated. So this file can never branch on the
// outcome — it records that we asked and moves on. Anything built on "did they
// rate?" would be built on a value we cannot obtain.
//
// The second is manners: the prompt lands on a moment the app has just been
// useful, not on launch, and never twice. An immediate ask reads as "rate me
// before you know if I'm any good", which earns one-star reviews from people
// who were only annoyed by the dialog.
//
// Hence: at least a day of ownership, at least a couple of products tracked,
// asked on the act of tracking another one, and never again either way.

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as StoreReview from "expo-store-review";

const FIRST_SEEN_KEY = "sweep.review.firstSeen";
const ASKED_KEY = "sweep.review.asked";

/** Long enough to have formed an opinion. */
const MIN_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Tracking one product could be curiosity. A second is a habit, and a habit is
 * what we're asking them to vouch for.
 */
const MIN_TRACKED = 2;

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
export async function maybeAskForReview(trackedCount: number): Promise<boolean> {
  try {
    if (trackedCount < MIN_TRACKED) return false;
    if (await hasAsked()) return false;

    const firstSeen = Number(await AsyncStorage.getItem(FIRST_SEEN_KEY));
    if (!firstSeen || Date.now() - firstSeen < MIN_AGE_MS) return false;

    // Both checks: availability is the platform, hasAction is whether a review
    // flow can actually be reached from here.
    if (!(await StoreReview.isAvailableAsync())) return false;
    if (!(await StoreReview.hasAction())) return false;

    // Written before the call, not after. If requestReview throws or the app is
    // killed while the sheet is up, we still don't ask a second time.
    await AsyncStorage.setItem(ASKED_KEY, String(Date.now()));
    await StoreReview.requestReview();
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
  await AsyncStorage.multiRemove([FIRST_SEEN_KEY, ASKED_KEY]);
}
