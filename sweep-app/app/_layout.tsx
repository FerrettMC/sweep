// app/_layout.tsx
//
// Root layout and auth gate.
//
// The gate reacts to auth state rather than checking once on cold start: a
// user can sign in, sign out, or have a token expire at any point, and a
// one-shot check leaves the app showing a screen the session no longer allows.

import { useEffect, useMemo, useRef, useState } from "react";
import * as Notifications from "expo-notifications";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { View } from "react-native";
import { StatusBar } from "expo-status-bar";
import {
  SafeAreaInsetsContext,
  SafeAreaProvider,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import AppErrorScreen from "@/components/AppErrorScreen";
import OfflineBanner from "@/components/OfflineBanner";
import AnimatedSplash from "@/components/AnimatedSplash";
import Toast from "@/components/Toast";
import ReviewPrompt from "@/components/ReviewPrompt";
import { useIsOnline } from "@/lib/connection";
import { setPushRegistered } from "@/lib/pushStatus";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { useTranslate } from "@/lib/i18n";
import { syncUser } from "@/lib/api";
import { loadGuestMode, useGuestMode } from "@/lib/guestMode";
import { loadLanguage } from "@/lib/i18n";
import { reportError, startCrashReporting } from "@/lib/crashReporting";
import { identifyForPurchases, startPurchases } from "@/lib/purchases";
import { noteAppOpened } from "@/lib/reviewPrompt";
import { hasSeenOnboarding, useHasSeenOnboarding } from "@/lib/onboarding";
import {
  parsePayload,
  registerForPushNotifications,
} from "@/lib/notifications";
import { supabase } from "@/lib/supabase";

// Hold the orange screen open until AnimatedSplash has painted over it.
//
// At module scope on purpose: inside a component this runs after the first
// frame, and that frame is exactly the flash we're preventing. Rejection is
// ignored — it throws only when the splash is already gone, which is not a
// reason to fail a launch.
SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * expo-router renders this instead of the screen when a render throws.
 *
 * Must be exported from a layout, and must bring its own providers: the crash
 * may have happened above them, so useTheme would throw again inside the very
 * component meant to handle the crash.
 */
export function ErrorBoundary({
  error,
  retry,
}: {
  error: Error;
  retry: () => Promise<void>;
}) {
  // Reported here rather than only by the global handler: expo-router catches
  // render errors itself, so without this the screen someone actually saw fail
  // is the one crash that never reaches us.
  useEffect(() => {
    reportError(error, { boundary: "root" });
  }, [error]);

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppErrorScreen error={error} retry={() => void retry()} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/**
 * The provider has to sit above anything calling useTheme, so the navigator is
 * a separate component rather than this one.
 */
// Started at module scope, before any component mounts — a crash during the
// first render is exactly the kind this exists to catch, and a hook would be
// too late to see it.
startCrashReporting();
startPurchases();

export default function RootLayout() {
  return (
    // SafeAreaProvider explicitly rather than relying on the navigator's own:
    // the offline banner renders ABOVE the navigator and still needs insets.
    <SafeAreaProvider>
      <ThemeProvider>
        <RootNavigator />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { colors, scheme } = useTheme();
  const online = useIsOnline();
  const insets = useSafeAreaInsets();

  // The banner sits above the navigator and already pads for the status bar.
  // Without telling the navigator that, its header pads for the status bar a
  // second time and the title ends up floating well below the banner.
  const navigatorInsets = useMemo(
    () => (online ? insets : { ...insets, top: 0 }),
    [online, insets],
  );
  const router = useRouter();
  const segments = useSegments();
  const t = useTranslate();

  const [ready, setReady] = useState(false);
  // Separate from `ready`: the app can be ready while the splash is still
  // playing its exit, and the navigator needs to be mounted underneath it by
  // then or the reveal shows an empty screen.
  const [splashDone, setSplashDone] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  // From the shared stores rather than local copies: writing either one has
  // to re-run the gate below, or the two screens bounce off each other.
  const guest = useGuestMode() ?? false;
  // Null until read from storage, so the gate can't bounce someone to /auth
  // before it knows whether they've seen the tour.
  const seenTour = useHasSeenOnboarding();

  // Which user we've already synced, so re-renders and token refreshes don't
  // fire a redundant round trip on every auth event.
  const syncedUserId = useRef<string | null>(null);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      // Language is loaded before the first paint so the app never flashes
      // English at someone who chose Spanish.
      const [{ data }, guestMode] = await Promise.all([
        supabase.auth.getSession(),
        loadGuestMode(),
        loadLanguage(),
        // Starts the clock for the rating prompt. Only the first call sticks,
        // so the wait is measured from install rather than from whenever the
        // person first tracked something.
        noteAppOpened(),
      ]);
      if (!active) return;

      setSignedIn(Boolean(data.session));
      // Nothing to set — loadGuestMode() populates the store the gate reads.
      void guestMode;
      setReady(true);

      if (data.session?.user) void ensureSynced(data.session.user);
    }

    // A rejection here used to mean setReady(true) never ran and the app hung
    // on the launch screen forever — corrupt AsyncStorage or a bad stored
    // language would brick the app with no way back short of reinstalling.
    // Launching signed-out is a bad outcome; never launching is a worse one.
    bootstrap().catch(() => {
      if (active) setReady(true);
    });

    // Keeps the gate honest for the whole session, not just at launch.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setSignedIn(Boolean(session));
      // RevenueCat's app_user_id has to be the Supabase user id: it is what
      // the billing webhook uses to find the wallet. Re-run on every auth
      // change so a shared device can't attribute one person's subscription
      // to whoever logs in next.
      void identifyForPurchases(session?.user?.id ?? null);
      if (session?.user) void ensureSynced(session.user);
      else syncedUserId.current = null;
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  /**
   * Make sure the backend has a User + Wallet row for this session.
   *
   * This lives here rather than in the sign-up handler because sign-up isn't
   * the only way to arrive with a session: confirming by email, or restoring a
   * persisted session on a new install, both skip that path and would
   * otherwise leave the account with no wallet.
   */
  async function ensureSynced(user: { id: string; email?: string }) {
    if (syncedUserId.current === user.id || !user.email) return;
    syncedUserId.current = user.id;
    try {
      await syncUser(user.email);

      // Register for push only after the account exists server-side —
      // /notifications/register needs a User row to attach the token to.
      //
      // The result is written to the shared store rather than discarded. Home
      // reads its notification state on focus, which happens BEFORE this
      // finishes, so it would see "no token yet" and show "Price alerts are
      // off" for a session that had in fact just enabled them.
      const push = await registerForPushNotifications();
      if (push.status === "registered") setPushRegistered(true);
      else if (push.status === "denied") setPushRegistered(false);
    } catch {
      // Non-fatal: the next authenticated call will surface a real problem.
      // Clear it so a transient network failure gets retried.
      syncedUserId.current = null;
    }
  }

  // Tapping a price-drop notification should land on that product, not just
  // open the app. Handles both cases: tapped while running, and tapped from
  // cold start (where the tap already happened before this effect mounted).
  useEffect(() => {
    if (!ready || !signedIn) return;

    let handled = false;

    function open(data: unknown) {
      const payload = parsePayload(data);
      if (payload) router.push(`/product/${payload.productId}`);
    }

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (handled || !response) return;
      handled = true;
      open(response.notification.request.content.data);
    });

    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        handled = true;
        open(response.notification.request.content.data);
      },
    );

    return () => subscription.remove();
  }, [ready, signedIn, router]);

  useEffect(() => {
    // Populates the store; the gate re-runs when it lands.
    void hasSeenOnboarding().catch(() => {});
  }, []);

  useEffect(() => {
    if (!ready || seenTour === null) return;

    const inAuth = segments[0] === "auth";
    const inTour = segments[0] === "onboarding";
    const hasAccess = signedIn || guest;

    if (hasAccess) {
      // Only a genuinely signed-in user gets bounced off the auth screen.
      //
      // Guests must be allowed to stay: "Create an account" is the entire
      // upgrade path, and treating a guest as already-authenticated meant
      // every one of those buttons navigated to /auth and was returned to the
      // tabs before a frame rendered — which reads as a dead button.
      //
      // Also deliberately does NOT redirect off the tour: replaying it from
      // Profile is something a signed-in user does on purpose.
      if (inAuth && signedIn) router.replace("/(tabs)");
      return;
    }

    // The tour runs before the login form, but only once per device, and never
    // for someone who already has a session to restore.
    //
    // `inAuth` is in the first condition because finishing the tour navigates
    // to /auth immediately, before this component has re-read storage — without
    // it the stale `seenTour` would bounce them straight back into the tour.
    if (!seenTour && !inTour && !inAuth) {
      router.replace("/onboarding");
    } else if (seenTour && !inAuth && !inTour) {
      router.replace("/auth");
    }
  }, [ready, seenTour, signedIn, guest, segments, router]);

  const appReady = ready && seenTour !== null;

  // The navigator is not mounted until the gate resolves — routing decisions
  // depend on `seenTour`, and mounting early puts someone on a screen the gate
  // is about to move them off. The splash covers that gap instead of `null`,
  // which is what used to hand the native splash over to an empty rectangle.
  return (
    // An explicit flex container: the banner and the navigator are siblings,
    // so the navigator needs something to fill the space that's left.
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Light icons while the orange is up regardless of theme — dark status
          icons on #fc5430 are barely legible. Reverts as the splash leaves. */}
      <StatusBar style={!splashDone ? "light" : scheme === "dark" ? "light" : "dark"} />
      {/* Above the navigator so no screen can forget it. */}
      <OfflineBanner />
      {appReady && (
      <SafeAreaInsetsContext.Provider value={navigatorInsets}>
        <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="auth" />
        {/* No header and no swipe-back: the tour is a flow, not a page. */}
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
        {/*
          Header styling lives here rather than only inside each screen. A
          screen that returns a loading state before rendering its own
          <Stack.Screen options> would otherwise flash the navigator defaults
          for that first frame — a white bar titled "product/[id]". Screens
          still override `title` once their data arrives.
        */}
        <Stack.Screen
          name="product/[id]"
          options={{
            headerShown: true,
            title: "",
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.textPrimary,
            headerShadowVisible: false,
            headerTitleStyle: { fontWeight: "800" },
          }}
        />
        <Stack.Screen
          name="notifications"
          options={{
            headerShown: true,
            title: t("nav.notifications"),
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.textPrimary,
            headerShadowVisible: false,
            headerTitleStyle: { fontWeight: "800" },
          }}
        />
        <Stack.Screen
          name="why-limited"
          options={{
            headerShown: true,
            title: t("nav.whyLimited"),
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.textPrimary,
            headerShadowVisible: false,
            headerTitleStyle: { fontWeight: "800" },
          }}
        />
        <Stack.Screen
          name="lookup"
          options={{
            headerShown: true,
            title: t("nav.lookup"),
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.textPrimary,
            headerShadowVisible: false,
            headerTitleStyle: { fontWeight: "800" },
          }}
        />
        <Stack.Screen
          name="radar"
          options={{
            headerShown: true,
            title: t("nav.radar"),
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.textPrimary,
            headerShadowVisible: false,
            headerTitleStyle: { fontWeight: "800" },
          }}
        />
        <Stack.Screen
          name="budget"
          options={{
            headerShown: true,
            title: t("nav.budget"),
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.textPrimary,
            headerShadowVisible: false,
            headerTitleStyle: { fontWeight: "800" },
          }}
        />
        <Stack.Screen
          name="lists"
          options={{
            headerShown: true,
            title: t("nav.lists"),
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.textPrimary,
            headerShadowVisible: false,
            headerTitleStyle: { fontWeight: "800" },
          }}
        />
        <Stack.Screen
          name="plans"
          options={{
            headerShown: true,
            title: t("nav.plans"),
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.textPrimary,
            headerShadowVisible: false,
            headerTitleStyle: { fontWeight: "800" },
          }}
        />
        <Stack.Screen
          name="leaderboard"
          options={{
            headerShown: true,
            title: t("nav.leaderboard"),
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.textPrimary,
            headerShadowVisible: false,
            headerTitleStyle: { fontWeight: "800" },
          }}
        />
        <Stack.Screen
          name="profile"
          options={{
            headerShown: true,
            presentation: "modal",
            title: t("nav.profile"),
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.textPrimary,
            headerShadowVisible: false,
            headerTitleStyle: { fontWeight: "800" },
          }}
        />
        </Stack>
      </SafeAreaInsetsContext.Provider>
      )}

      {/*
        AFTER the navigator, deliberately. These paint over whatever screen is
        showing, and in React Native later siblings render on top — a toast
        placed above the navigator sits behind every screen and is invisible,
        which is exactly what happened.

        The dialog renders in its own window so its position in the tree
        doesn't matter, but it lives here for the same reason: both are things
        drawn over the app rather than part of it.
      */}
      <Toast />
      {/* One dialog for an ask triggered from five screens. */}
      <ReviewPrompt />

      {/*
        Last of all, so it covers everything — same reason the toast sits after
        the navigator. It unmounts itself once its exit animation is done, and
        force-unmounts on a timer if that animation is ever interrupted, since
        a splash that never leaves is an app that never starts.
      */}
      {!splashDone && (
        <AnimatedSplash appReady={appReady} onFinished={() => setSplashDone(true)} />
      )}
    </View>
  );
}
