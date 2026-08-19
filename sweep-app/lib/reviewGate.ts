// lib/reviewGate.ts
//
// The decision of whether to ask for a rating, as a pure function.
//
// Split out from reviewPrompt.ts because "only ever once" is a promise to the
// user, and a promise worth testing. Everything here is arithmetic on values
// passed in — no storage, no native modules — so the rules can be exercised
// directly instead of inferred from behaviour on a device.

export interface ReviewGateInput {
  /**
   * Meaningful things this person has finished in the app — a search that
   * returned results, a product tracked, a list made, a purchase logged.
   *
   * Counting actions rather than tracked products because tracking is only one
   * of several ways to get value here, and someone who searches every day
   * without ever tracking anything was previously never asked at all.
   */
  actionsCompleted: number;
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
 * One completed action is enough, given the day of ownership alongside it.
 * Someone who has used the app, come back the next day, and finished something
 * has told us what we need to know.
 */
export const MIN_ACTIONS = 1;

export type ReviewDecision =
  | { ask: true }
  | {
      ask: false;
      /** Why not — for logging and for tests to assert against. */
      reason: "already-asked" | "too-new" | "no-first-seen" | "no-actions" | "unavailable";
    };

export function shouldAskForReview(input: ReviewGateInput): ReviewDecision {
  // Checked first and unconditionally: no combination of the other inputs may
  // ever produce a second ask.
  if (input.alreadyAsked) return { ask: false, reason: "already-asked" };

  if (input.actionsCompleted < MIN_ACTIONS) return { ask: false, reason: "no-actions" };
  if (input.firstSeenAt === null) return { ask: false, reason: "no-first-seen" };
  if (input.now - input.firstSeenAt < MIN_AGE_MS) return { ask: false, reason: "too-new" };
  if (!input.reviewAvailable) return { ask: false, reason: "unavailable" };

  return { ask: true };
}
