// lib/onboarding.ts
//
// Whether this device has been walked through the app yet.
//
// Stored per-device rather than per-account on purpose: the tour runs before
// anyone has an account, and someone who's already seen it shouldn't sit
// through it again just because they signed out.

import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "sweep_onboarding_seen";

export async function hasSeenOnboarding(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEY)) === "true";
}

export async function markOnboardingSeen() {
  await AsyncStorage.setItem(KEY, "true");
}

/** Dev helper: run the tour again on the next launch. */
export async function resetOnboarding() {
  await AsyncStorage.removeItem(KEY);
}
