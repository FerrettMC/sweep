// lib/ads.ts
//
// The one ad in Sweep: watch a short video, get an extra search.
//
// Nothing else in the app is interrupted by advertising. This is opt-in, it
// only appears when someone has actually run out of searches, and it is the
// only reason an ad SDK is in the build at all.
//
// THE REWARD IS NOT GRANTED HERE. When the video completes, Google calls our
// backend directly (server-side verification), and the backend credits the
// search after checking Google's signature. This file only asks for an ad and
// reports what happened — a client that could grant itself searches would be
// a client that could mint them forever, and in production the reward endpoint
// refuses anything that didn't come from AdMob.
//
// The userId passed in is what ties the two halves together: it travels to
// Google as the SSV `user_id`, and comes back to us in the callback.

import { Platform } from "react-native";
import mobileAds, {
  AdEventType,
  InterstitialAd,
  MaxAdContentRating,
  RewardedAd,
  RewardedAdEventType,
  TestIds,
} from "react-native-google-mobile-ads";

const REWARDED_UNIT = process.env.EXPO_PUBLIC_ADMOB_REWARDED_UNIT_ID?.trim();
const INTERSTITIAL_UNIT =
  process.env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_UNIT_ID?.trim();

/**
 * Test units unless a real one is configured.
 *
 * Deliberately the default. Requesting live ads during development means
 * impressions and taps against your own account, which AdMob classes as
 * invalid traffic and suspends accounts over — a mistake that costs the
 * account, not just the build.
 */
const rewardedUnitId = REWARDED_UNIT || TestIds.REWARDED;
const interstitialUnitId = INTERSTITIAL_UNIT || TestIds.INTERSTITIAL;

export function usingTestAds() {
  return !REWARDED_UNIT;
}

/**
 * Whether ads work in this build.
 *
 * The UI checks this before offering a reward, rather than offering one it
 * can't deliver. A "watch an ad for a search" button that then says "ads
 * aren't enabled" is worse than no button, for the user and for a reviewer.
 */
export const ADS_ENABLED = Platform.OS === "android";

let initialised = false;

async function ensureInitialised() {
  if (initialised) return;
  initialised = true;
  await mobileAds()
    .setRequestConfiguration({
      // Sweep is a shopping app, not a games app. Nothing stronger than a
      // general audience rating belongs next to a price comparison.
      maxAdContentRating: MaxAdContentRating.G,
      tagForChildDirectedTreatment: false,
      tagForUnderAgeOfConsent: false,
    })
    .then(() => mobileAds().initialize());
}

export type RewardedOutcome =
  | { status: "earned"; userId: string }
  | { status: "dismissed" }
  | { status: "failed"; reason: string };

/**
 * Show a rewarded ad and report the outcome.
 *
 * Resolves exactly once, whatever happens. Every listener is removed on the
 * way out — a rewarded ad that leaks its handlers will fire the old ones the
 * next time one is shown, and credit a search twice for one video.
 */
export async function showRewardedAd(userId: string): Promise<RewardedOutcome> {
  if (!ADS_ENABLED) {
    return { status: "failed", reason: "Ads are not available on this platform" };
  }

  try {
    await ensureInitialised();
  } catch (err) {
    return { status: "failed", reason: describe(err) };
  }

  return new Promise<RewardedOutcome>((resolve) => {
    const ad = RewardedAd.createForAdRequest(rewardedUnitId, {
      // The link between this device and the SSV callback. Without it the
      // callback arrives with no user_id and the backend has nobody to credit.
      serverSideVerificationOptions: { userId },
      requestNonPersonalizedAdsOnly: true,
    });

    let settled = false;
    let earned = false;
    const unsubscribers: (() => void)[] = [];

    function finish(outcome: RewardedOutcome) {
      if (settled) return;
      settled = true;
      for (const off of unsubscribers) {
        try {
          off();
        } catch {
          // Removing a listener must never be the thing that throws.
        }
      }
      resolve(outcome);
    }

    unsubscribers.push(
      ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
        try {
          ad.show();
        } catch (err) {
          finish({ status: "failed", reason: describe(err) });
        }
      }),
      // Fired when the video is watched far enough to count. The reward
      // itself arrives at our backend from Google, not from here.
      ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
        earned = true;
      }),
      // Closing is the normal end of both paths, so the earned flag decides
      // which one it was.
      ad.addAdEventListener(AdEventType.CLOSED, () => {
        finish(earned ? { status: "earned", userId } : { status: "dismissed" });
      }),
      ad.addAdEventListener(AdEventType.ERROR, (error) => {
        finish({ status: "failed", reason: describe(error) });
      }),
    );

    try {
      ad.load();
    } catch (err) {
      finish({ status: "failed", reason: describe(err) });
    }
  });
}

// ---- interstitials ---------------------------------------------------------
//
// Shown between actions on the free tier, never over one. Loaded ahead of time
// because an interstitial that has to fetch before it appears is a freeze in
// the middle of whatever the person was doing.

let interstitial: InterstitialAd | null = null;
let interstitialReady = false;
let actionsSinceLastAd = 0;

/** Actions between interstitials. Frequent enough to matter, rare enough to bear. */
const ACTIONS_PER_INTERSTITIAL = 8;

export function preloadInterstitial() {
  if (!ADS_ENABLED || interstitial) return;

  void ensureInitialised()
    .then(() => {
      interstitial = InterstitialAd.createForAdRequest(interstitialUnitId, {
        requestNonPersonalizedAdsOnly: true,
      });
      interstitial.addAdEventListener(AdEventType.LOADED, () => {
        interstitialReady = true;
      });
      interstitial.addAdEventListener(AdEventType.CLOSED, () => {
        // One instance can only be shown once, so the next one is loaded now
        // rather than when it's next needed.
        interstitialReady = false;
        interstitial = null;
        preloadInterstitial();
      });
      interstitial.addAdEventListener(AdEventType.ERROR, () => {
        interstitialReady = false;
        interstitial = null;
      });
      interstitial.load();
    })
    .catch(() => {
      // No ad is a fine outcome. It is not worth surfacing.
    });
}

/**
 * Count an action, and show an interstitial if enough have passed.
 *
 * Returns whether one was shown, so the caller can avoid stacking its own UI
 * on top of a full-screen ad.
 */
export function countActionAndMaybeShowInterstitial(showAds: boolean): boolean {
  if (!ADS_ENABLED || !showAds) return false;

  actionsSinceLastAd += 1;
  if (actionsSinceLastAd < ACTIONS_PER_INTERSTITIAL) return false;

  if (!interstitialReady || !interstitial) {
    // Not loaded in time. The counter is left alone so the next action tries
    // again rather than waiting another full cycle.
    preloadInterstitial();
    return false;
  }

  try {
    interstitial.show();
    actionsSinceLastAd = 0;
    return true;
  } catch {
    return false;
  }
}

/** Called on sign-out, so a new account doesn't inherit a part-full counter. */
export function resetAdSession() {
  actionsSinceLastAd = 0;
}

function describe(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}
