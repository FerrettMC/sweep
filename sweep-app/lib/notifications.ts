// lib/notifications.ts
//
// Push notification registration.
//
// Two things about this that bite people:
//   1. It only works in a development or production build. Remote push was
//      removed from Expo Go in SDK 53 — you already build with `npm run
//      android`, so you're fine, but reloading JS is not enough after adding
//      this package. You must rebuild.
//   2. Android needs a notification CHANNEL to exist before anything will
//      show. The channel id here must match the `channelId` the server sends
//      ("price-drops") or Android drops the notification silently.

import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { registerPushToken, unregisterPushToken } from "./api";

export const PRICE_DROP_CHANNEL = "price-drops";

/**
 * How a notification behaves when it lands while the app is open. Price drops
 * are worth showing immediately — the user is shopping right now.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export type PushRegistrationResult =
  | { status: "registered"; token: string }
  | { status: "denied" }
  | { status: "unsupported"; reason: string };

/**
 * Ask for permission, get an Expo push token, and hand it to the backend.
 * Safe to call on every launch — registration is idempotent server-side.
 */
export async function registerForPushNotifications(): Promise<PushRegistrationResult> {
  // Android channels must exist before the first notification arrives, and
  // creating one is cheap and idempotent — so do it before asking permission.
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(PRICE_DROP_CHANNEL, {
      name: "Price drops",
      description: "Alerts when something you track gets cheaper",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }

  // Emulators and simulators can't receive remote push.
  if (!Device.isDevice) {
    return {
      status: "unsupported",
      reason: "Push notifications need a physical device.",
    };
  }

  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted;

  // Only prompt if we haven't been refused already — re-prompting after a
  // denial does nothing on both platforms and just burns the request.
  if (!granted && existing.canAskAgain) {
    const requested = await Notifications.requestPermissionsAsync();
    granted = requested.granted;
  }

  if (!granted) return { status: "denied" };

  const projectId = resolveProjectId();
  if (!projectId) {
    return {
      status: "unsupported",
      reason:
        "No EAS project id. Run `npx eas init` in sweep-app/, then rebuild.",
    };
  }

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await registerPushToken(token, Platform.OS === "ios" ? "ios" : "android");
    return { status: "registered", token };
  } catch (err) {
    return {
      status: "unsupported",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Called on sign-out so a shared device stops alerting the previous account. */
export async function deregisterPushNotifications() {
  try {
    const projectId = resolveProjectId();
    if (!projectId) return;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await unregisterPushToken(token);
  } catch {
    // Best effort. If this fails the server prunes the token the first time
    // Expo reports it as unregistered.
  }
}

/**
 * The EAS project id is injected at build time, but the docs recommend not
 * relying on a single location — it moved between SDK versions and differs
 * between dev and production builds.
 */
function resolveProjectId(): string | undefined {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    undefined
  );
}

/** The payload the server attaches to a price-drop notification. */
export interface PriceDropPayload {
  type: "price_drop";
  productId: string;
}

export function parsePayload(data: unknown): PriceDropPayload | null {
  if (!data || typeof data !== "object") return null;
  const payload = data as Record<string, unknown>;
  if (payload.type !== "price_drop" || typeof payload.productId !== "string") {
    return null;
  }
  return { type: "price_drop", productId: payload.productId };
}
