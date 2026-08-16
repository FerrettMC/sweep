// lib/purchases.ts
//
// Buying a subscription.
//
// The split that matters: RevenueCat tells the *app* what someone owns so the
// screen can update immediately, and tells the *backend* the same thing by
// webhook so limits are enforced against something the client can't lie about.
// The app never grants itself anything — it asks, then refetches from our API.
//
// Identity is the other half. Purchases.logIn() sets RevenueCat's app_user_id
// to the Supabase user id, which is what lets the webhook find the right
// wallet. Without it, purchases land against an anonymous id and the tier is
// never applied to anybody.
//
// Everything is a no-op when no key is configured, so a build without
// credentials behaves exactly as the app did before subscriptions existed.

import Purchases, {
  type CustomerInfo,
  type PurchasesOffering,
  type PurchasesPackage,
} from "react-native-purchases";

const KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY?.trim();

/** Entitlement ids, matching what the backend webhook looks for. */
export const ENTITLEMENTS = { pro: "pro", ultimate: "ultimate" } as const;

export const BILLING_ENABLED = Boolean(KEY);

let configured = false;

/** Safe to call repeatedly; only the first call configures. */
export function startPurchases() {
  if (!KEY || configured) return;
  Purchases.configure({ apiKey: KEY });
  configured = true;
}

/**
 * Tie purchases to the signed-in account.
 *
 * Called on sign-in and after sign-out, so a shared device doesn't attribute
 * one person's subscription to the next person who logs in.
 */
export async function identifyForPurchases(userId: string | null) {
  if (!KEY) return;
  startPurchases();
  try {
    if (userId) await Purchases.logIn(userId);
    else await Purchases.logOut();
  } catch {
    // Identity failing shouldn't block using the app; it only means a purchase
    // made right now would need restoring later.
  }
}

/** What's for sale, or null when nothing is configured yet. */
export async function getOffering(): Promise<PurchasesOffering | null> {
  if (!KEY) return null;
  startPurchases();
  try {
    const offerings = await Purchases.getOfferings();
    return offerings.current ?? null;
  } catch {
    return null;
  }
}

export type PurchaseOutcome =
  | { status: "bought"; entitlements: string[] }
  | { status: "cancelled" }
  | { status: "unavailable" }
  | { status: "failed"; message: string };

/**
 * Buy a package.
 *
 * A cancellation is not an error — someone closing the sheet is the most
 * common outcome and shouldn't produce an error message.
 */
export async function buy(pkg: PurchasesPackage): Promise<PurchaseOutcome> {
  if (!KEY) return { status: "unavailable" };
  startPurchases();

  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return { status: "bought", entitlements: activeEntitlements(customerInfo) };
  } catch (err) {
    const e = err as { userCancelled?: boolean; message?: string };
    if (e.userCancelled) return { status: "cancelled" };
    return { status: "failed", message: e.message ?? "Purchase failed" };
  }
}

/**
 * Re-apply a subscription bought on another device or before a reinstall.
 *
 * Google Play requires this to be reachable — a subscriber who reinstalls must
 * be able to get their access back without paying again.
 */
export async function restore(): Promise<PurchaseOutcome> {
  if (!KEY) return { status: "unavailable" };
  startPurchases();
  try {
    const info = await Purchases.restorePurchases();
    return { status: "bought", entitlements: activeEntitlements(info) };
  } catch (err) {
    return { status: "failed", message: (err as Error).message };
  }
}

function activeEntitlements(info: CustomerInfo): string[] {
  return Object.keys(info.entitlements.active);
}
