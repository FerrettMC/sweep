// app/profile.tsx
//
// Reached from the header on every tab. Account, plan, and the retailer status
// board — the last one is genuinely useful to a user, not just to us: it
// explains an empty column in search without them having to guess.

import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { Button, Loading, Screen, SectionTitle } from "@/components/ui";
import { colors, radius, spacing, type } from "@/constants/theme";
import { getNotificationStatus, getQuota, getRetailerStatus } from "@/lib/api";
import { pluralize, retailerColor } from "@/lib/format";
import { setGuestMode } from "@/lib/guestMode";
import {
  deregisterPushNotifications,
  registerForPushNotifications,
} from "@/lib/notifications";
import { supabase } from "@/lib/supabase";

interface RetailerStatus {
  retailer: string;
  label: string;
  available: boolean;
  successRate: number | null;
}

const TIER_BLURB: Record<string, string> = {
  free: "3 products · 2 checks a day · 1 search a day",
  pro: "20 products · hourly checks · 10 searches a day",
  ultimate: "100 products · checks every 30 min · 100 searches a day",
};

export default function ProfileScreen() {
  const router = useRouter();

  const [email, setEmail] = useState<string | null>(null);
  const [tier, setTier] = useState("free");
  const [searchesLeft, setSearchesLeft] = useState<number | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [retailers, setRetailers] = useState<RetailerStatus[] | null>(null);
  const [pushRegistered, setPushRegistered] = useState<boolean | null>(null);
  const [pushNote, setPushNote] = useState<string | null>(null);
  const [enablingPush, setEnablingPush] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [{ data: session }, quotaResult, statusResult, pushResult] =
      await Promise.all([
        supabase.auth.getSession(),
        getQuota().catch(() => null),
        getRetailerStatus().catch(() => null),
        getNotificationStatus().catch(() => null),
      ]);

    setEmail(session.session?.user.email ?? null);
    if (quotaResult) {
      setTier(quotaResult.tier);
      setSearchesLeft(quotaResult.quota.remaining);
      setIsGuest(quotaResult.isGuest);
    }
    setRetailers(statusResult?.retailers ?? null);
    setPushRegistered(pushResult?.registered ?? null);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      load().catch(() => {
        if (!cancelled) setLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }, [load]),
  );

  async function onEnablePush() {
    setEnablingPush(true);
    setPushNote(null);

    const result = await registerForPushNotifications();

    if (result.status === "registered") {
      setPushRegistered(true);
      setPushNote("Price-drop alerts are on.");
    } else if (result.status === "denied") {
      // Re-prompting after a denial is a no-op on both platforms, so point at
      // the only place that can actually change it.
      setPushNote("Permission denied. Enable notifications in system settings.");
    } else {
      setPushNote(result.reason);
    }

    setEnablingPush(false);
  }

  async function onSignOut() {
    // Deregister first: after signOut there's no token to authenticate the
    // delete, and a shared device would keep alerting the previous account.
    await deregisterPushNotifications();
    await supabase.auth.signOut();
    await setGuestMode(false);
    router.replace("/auth");
  }

  if (loading) return <Loading />;

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: "Profile",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
        }}
      />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.label}>Account</Text>
          <Text style={styles.value}>{email ?? "Browsing as guest"}</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.planRow}>
            <Text style={styles.label}>Plan</Text>
            <View style={styles.tierPill}>
              <Text style={styles.tierPillText}>{tier.toUpperCase()}</Text>
            </View>
          </View>
          <Text style={styles.value}>{TIER_BLURB[tier] ?? TIER_BLURB.free}</Text>
          {searchesLeft !== null && (
            <Text style={styles.sub}>{pluralize(searchesLeft, "search")} left today</Text>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.planRow}>
            <Text style={styles.label}>Price alerts</Text>
            <Text
              style={[
                styles.statusValue,
                { color: pushRegistered ? colors.success : colors.textTertiary },
              ]}
            >
              {pushRegistered === null ? "—" : pushRegistered ? "On" : "Off"}
            </Text>
          </View>
          <Text style={styles.sub}>
            {pushRegistered
              ? "You'll get a push when something you track drops."
              : "Turn these on so you hear about a drop while it's still live."}
          </Text>
          {pushNote && <Text style={styles.pushNote}>{pushNote}</Text>}
          {!pushRegistered && (
            <View style={styles.pushAction}>
              <Button
                label="Enable price alerts"
                onPress={onEnablePush}
                busy={enablingPush}
                variant="secondary"
                compact
              />
            </View>
          )}
        </View>

        <View style={styles.section}>
          <SectionTitle>Store status</SectionTitle>
          <Text style={styles.sectionBlurb}>
            Which stores Sweep can currently read prices from.
          </Text>
          <View style={styles.card}>
            {(retailers ?? []).map((item, index) => (
              <View
                key={item.retailer}
                style={[styles.statusRow, index > 0 && styles.statusRowDivided]}
              >
                <View
                  style={[styles.retailerDot, { backgroundColor: retailerColor(item.retailer) }]}
                />
                <Text style={styles.statusName}>{item.label}</Text>
                <Text
                  style={[
                    styles.statusValue,
                    { color: item.available ? colors.success : colors.danger },
                  ]}
                >
                  {item.available ? "Working" : "Unavailable"}
                </Text>
              </View>
            ))}
            {retailers === null && (
              <Text style={styles.sub}>Couldn't reach the server.</Text>
            )}
          </View>
        </View>

        <View style={styles.actions}>
          {isGuest ? (
            <Button label="Create an account" onPress={() => router.push("/auth")} />
          ) : (
            <Button label="Sign out" onPress={onSignOut} variant="secondary" />
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    padding: spacing.md,
    gap: spacing.xs,
  },
  label: {
    color: colors.textTertiary,
    fontSize: type.caption.fontSize,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  value: { color: colors.textPrimary, fontSize: type.body.fontSize, fontWeight: "600" },
  sub: { color: colors.textSecondary, fontSize: type.label.fontSize },
  planRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  tierPill: {
    backgroundColor: colors.accentMuted,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tierPillText: { color: colors.accent, fontSize: type.caption.fontSize, fontWeight: "900" },
  section: { gap: spacing.xs },
  sectionBlurb: {
    color: colors.textSecondary,
    fontSize: type.label.fontSize,
    marginBottom: spacing.xs,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  statusRowDivided: { borderTopWidth: 1, borderTopColor: colors.surfaceBorder },
  retailerDot: { width: 8, height: 8, borderRadius: radius.pill },
  statusName: { color: colors.textPrimary, fontSize: type.body.fontSize, flex: 1 },
  statusValue: { fontSize: type.label.fontSize, fontWeight: "700" },
  pushNote: {
    color: colors.warning,
    fontSize: type.caption.fontSize,
    lineHeight: 15,
  },
  pushAction: { marginTop: spacing.xs, alignSelf: "flex-start" },
  actions: { marginTop: spacing.md },
});
