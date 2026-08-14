// lib/ads.ts
//
// ADS ARE CURRENTLY DISABLED — this is a stub with the real module's shape.
//
// Why: react-native-google-mobile-ads pulls in play-services-ads 25.4.0, whose
// Kotlin metadata is version 2.3.0, while Expo SDK 57 / RN 0.86 compiles with
// Kotlin 2.1.0. The Android build fails at :react-native-google-mobile-ads:
// compileDebugKotlin with a wall of:
//
//   Module was compiled with an incompatible version of Kotlin.
//   The binary version of its metadata is 2.3.0, expected version is 2.1.0.
//
// It's a toolchain mismatch, not anything wrong with our integration. Two ways
// out when we come back to it (see docs/INTEGRATIONS.md §5):
//   1. Pin an older play-services-ads built against Kotlin ≤ 2.1.
//   2. Raise the project's Kotlin version via expo-build-properties.
//
// The API below is kept identical to the real implementation so re-enabling is
// a one-file change: reinstall the package, restore the real ads.ts, add the
// config plugin back to app.json. Nothing else in the app has to move.
//
// The backend half is already done and does NOT depend on any of this — AdMob
// server-side verification is implemented and tested in
// sweep-backend/src/lib/admobSsv.ts.

export type RewardedOutcome =
  | { status: "earned"; userId: string }
  | { status: "dismissed" }
  | { status: "failed"; reason: string };

/** Always true while ads are stubbed out. */
/**
 * Whether ads actually work in this build.
 *
 * False while the module is stubbed. The UI must check this rather than
 * offering a reward it cannot deliver — a "watch an ad for a free search"
 * button that returns "ads are not enabled" is worse than no button, both for
 * the user and for a store reviewer.
 *
 * Flip to true in the same change that restores the real SDK.
 */
export const ADS_ENABLED = false;

export function usingTestAds() {
  return true;
}

/**
 * No ad SDK is present, so this reports failure. The search screen already
 * handles that by falling back to the development reward endpoint in __DEV__,
 * which keeps the "+1 search" flow testable end to end without ads.
 */
export async function showRewardedAd(
  _userId: string,
): Promise<RewardedOutcome> {
  return { status: "failed", reason: "Ads are not enabled in this build" };
}

export function preloadInterstitial() {
  // no-op
}

export function countActionAndMaybeShowInterstitial(
  _showAds: boolean,
): boolean {
  return false;
}

export function resetAdSession() {
  // no-op
}
