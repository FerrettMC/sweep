// constants/support.ts
//
// Where support mail goes, and what we attach to it.
//
// Play Store listings require a public support address, so this exists whether
// or not anyone writes in. It's one constant because it appears in several
// places and an address that's right in two of them is worse than useless.
//
// The prefilled diagnostics are the questions we'd otherwise have to ask in a
// reply — version, platform, plan. None of it is personal: no email, no user
// id, no product history. It's visible in the draft before sending, which is
// the point; silently attaching anything to a user's own outgoing mail would
// be a poor way to treat someone already having a bad enough day to write in.

import Constants from "expo-constants";
import { Platform } from "react-native";
import { API_URL } from "@/lib/api";

/**
 * TODO before launch: point this at a real inbox and use the same address on
 * the Play Store listing. They have to match — Google checks.
 */
export const SUPPORT_EMAIL = "benju.support@gmail.com";

export const APP_VERSION = Constants.expoConfig?.version ?? "dev";

/**
 * Legal pages, served by the backend so they share its domain.
 *
 * Google Play requires the privacy policy and the deletion page to be public
 * URLs, and requires the policy to be reachable from inside the app too — so
 * these are linked from Profile as well as from the store listing.
 */
export const PRIVACY_URL = `${API_URL}/privacy`;
export const DELETE_ACCOUNT_URL = `${API_URL}/delete-account`;

/** A mailto: with the subject and diagnostics already filled in. */
export function supportMailto(
  options: { subject?: string; tier?: string | null } = {},
) {
  const { subject = "Sweep support", tier } = options;

  const diagnostics = [
    "",
    "",
    "— — —",
    "Sent from the app, so we can help faster:",
    `App: Sweep ${APP_VERSION}`,
    `Device: ${Platform.OS} ${Platform.Version}`,
    ...(tier ? [`Plan: ${tier}`] : []),
  ].join("\n");

  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(diagnostics)}`;
}
