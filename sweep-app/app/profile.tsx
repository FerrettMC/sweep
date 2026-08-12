// app/profile.tsx
//
// Reached from the header on every tab. Account, plan, and the retailer status
// board — the last one is genuinely useful to a user, not just to us: it
// explains an empty column in search without them having to guess.

import { useCallback, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Button, Loading, Screen, SectionTitle } from "@/components/ui";
import { colors, radius, spacing, type } from "@/constants/theme";
import UsernameSheet from "@/components/UsernameSheet";
import {
  getMyXp,
  getNotificationStatus,
  getQuota,
  getRetailerStatus,
} from "@/lib/api";
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
  const [username, setUsernameValue] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);

  const load = useCallback(async () => {
    const [{ data: session }, quotaResult, statusResult, pushResult, xpResult] =
      await Promise.all([
        supabase.auth.getSession(),
        getQuota().catch(() => null),
        getRetailerStatus().catch(() => null),
        getNotificationStatus().catch(() => null),
        getMyXp().catch(() => null),
      ]);

    setEmail(session.session?.user.email ?? null);
    if (quotaResult) {
      setTier(quotaResult.tier);
      setSearchesLeft(quotaResult.quota.remaining);
      setIsGuest(quotaResult.isGuest);
    }
    setRetailers(statusResult?.retailers ?? null);
    setPushRegistered(pushResult?.registered ?? null);
    setUsernameValue(xpResult?.username ?? null);
    setDisplayName(xpResult?.name ?? null);
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
      <ScrollView contentContainerStyle={styles.content}>
        {/* One identity card. Username and account were two separate cards,
            which made the same person read as two unrelated settings — and put
            the public name nowhere near the private email it contrasts with. */}
        <View style={styles.card}>
          <View style={styles.identityRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(displayName ?? "S").slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <View style={styles.identityText}>
              <Text style={styles.identityName} numberOfLines={1}>
                {displayName ?? "—"}
              </Text>
              <Text style={styles.identityEmail} numberOfLines={1}>
                {email ?? "Browsing as guest"}
              </Text>
            </View>
            <Pressable onPress={() => setEditingName(true)} hitSlop={8}>
              <Text style={styles.changeLink}>{username ? "Edit" : "Set name"}</Text>
            </Pressable>
          </View>

          <Text style={styles.identityNote}>
            {username
              ? "Your username is public on the leaderboard. Your email never is."
              : "You're anonymous on the leaderboard until you pick a username. Your email is never shown."}
          </Text>
        </View>

        <Pressable
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}
          onPress={() => router.push("/plans")}
        >
          <View style={styles.planRow}>
            <Text style={styles.label}>Plan</Text>
            <View style={styles.planRight}>
              <View style={styles.tierPill}>
                <Text style={styles.tierPillText}>{tier.toUpperCase()}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </View>
          </View>
          <Text style={styles.value}>{TIER_BLURB[tier] ?? TIER_BLURB.free}</Text>
          {searchesLeft !== null && (
            <Text style={styles.sub}>{pluralize(searchesLeft, "search")} left today</Text>
          )}
          <Text style={styles.comparePlans}>
            {tier === "free" ? "Compare plans" : "See what's included"}
          </Text>
        </Pressable>

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

      <UsernameSheet
        visible={editingName}
        current={username}
        onClose={() => setEditingName(false)}
        onSaved={load}
      />
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
  changeLink: {
    color: colors.accent,
    fontSize: type.label.fontSize,
    fontWeight: "800",
  },
  pressed: { opacity: 0.75 },
  identityRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.accentMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.accent, fontSize: 20, fontWeight: "900" },
  identityText: { flex: 1, gap: 1 },
  identityName: {
    color: colors.textPrimary,
    fontSize: type.heading.fontSize,
    fontWeight: "800",
  },
  identityEmail: { color: colors.textSecondary, fontSize: type.label.fontSize },
  identityNote: {
    color: colors.textTertiary,
    fontSize: type.caption.fontSize,
    lineHeight: 15,
    marginTop: spacing.xs,
  },
  planRight: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  comparePlans: {
    color: colors.accent,
    fontSize: type.label.fontSize,
    fontWeight: "700",
    marginTop: spacing.xs,
  },
  pushNote: {
    color: colors.warning,
    fontSize: type.caption.fontSize,
    lineHeight: 15,
  },
  pushAction: { marginTop: spacing.xs, alignSelf: "flex-start" },
  actions: { marginTop: spacing.md },
});
