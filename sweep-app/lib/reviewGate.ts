// lib/reviewGate.ts
//
// The decision of whether to ask for a rating, as a pure function.
//
// Split out from reviewPrompt.ts because "only ever once" is a promise to the
// user, and a promise worth testing. Everything here is arithmetic on values
// passed in — no storage, no native modules — so the rules can be exercised
// directly instead of inferred from behaviour on a device.

export interface ReviewGateInput {
  /** How many products this person is tracking, after the current action. */
  trackedCount: number;
  /** Epoch ms of first launch, or null if we never recorded one. */
  firstSeenAt: number | null;
  /** Whether we have already used our single ask. */
  alreadyAsked: boolean;
  /** Whether the platform can show a review flow at all. */
  reviewAvailable: boolean;
  now: number;
}

/** Long enough to have formed an opinion worth publishing. */
export const MIN_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Tracking anything at all is the signal. Someone who has bothered to paste a
 * link and watch a price has used the feature the app exists for.
 */
export const MIN_TRACKED = 1;

export type ReviewDecision =
  | { ask: true }
  | {
      ask: false;
      /** Why not — for logging and for tests to assert against. */
      reason: "already-asked" | "too-new" | "no-first-seen" | "not-tracking" | "unavailable";
    };

export function shouldAskForReview(input: ReviewGateInput): ReviewDecision {
  // Checked first and unconditionally: no combination of the other inputs may
  // ever produce a second ask.
  if (input.alreadyAsked) return { ask: false, reason: "already-asked" };

  if (input.trackedCount < MIN_TRACKED) return { ask: false, reason: "not-tracking" };
  if (input.firstSeenAt === null) return { ask: false, reason: "no-first-seen" };
  if (input.now - input.firstSeenAt < MIN_AGE_MS) return { ask: false, reason: "too-new" };
  if (!input.reviewAvailable) return { ask: false, reason: "unavailable" };

  return { ask: true };
}
