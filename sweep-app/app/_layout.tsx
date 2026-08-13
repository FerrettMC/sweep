// app/_layout.tsx
//
// Root layout and auth gate.
//
// The gate reacts to auth state rather than checking once on cold start: a
// user can sign in, sign out, or have a token expire at any point, and a
// one-shot check leaves the app showing a screen the session no longer allows.

import { useEffect, useRef, useState } from "react";
import * as Notifications from "expo-notifications";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { syncUser } from "@/lib/api";
import { isGuestMode } from "@/lib/guestMode";
import {
  parsePayload,
  registerForPushNotifications,
} from "@/lib/notifications";
import { supabase } from "@/lib/supabase";

/**
 * The provider has to sit above anything calling useTheme, so the navigator is
 * a separate component rather than this one.
 */
export default function RootLayout() {
  return (
    <ThemeProvider>
      <RootNavigator />
    </ThemeProvider>
  );
}

function RootNavigator() {
  const { colors, scheme } = useTheme();
  const router = useRouter();
  const segments = useSegments();

  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [guest, setGuest] = useState(false);

  // Which user we've already synced, so re-renders and token refreshes don't
  // fire a redundant round trip on every auth event.
  const syncedUserId = useRef<string | null>(null);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      const [{ data }, guestMode] = await Promise.all([
        supabase.auth.getSession(),
        isGuestMode(),
      ]);
      if (!active) return;

      setSignedIn(Boolean(data.session));
      setGuest(guestMode);
      setReady(true);

      if (data.session?.user) void ensureSynced(data.session.user);
    }

    bootstrap();

    // Keeps the gate honest for the whole session, not just at launch.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setSignedIn(Boolean(session));
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
      void registerForPushNotifications();
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
    if (!ready) return;

    const inAuth = segments[0] === "auth";
    const hasAccess = signedIn || guest;

    if (!hasAccess && !inAuth) {
      router.replace("/auth");
    } else if (signedIn && inAuth) {
      // Signed in but sitting on the auth screen — send them into the app.
      router.replace("/(tabs)");
    }
  }, [ready, signedIn, guest, segments, router]);

  if (!ready) return null;

  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="auth" />
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
          name="radar"
          options={{
            headerShown: true,
            title: "Deal Radar",
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
            title: "Budget",
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
            title: "Lists",
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
            title: "Plans",
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
            title: "Leaderboard",
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
            title: "Profile",
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.textPrimary,
            headerShadowVisible: false,
            headerTitleStyle: { fontWeight: "800" },
          }}
        />
      </Stack>
    </>
  );
}
