// app/profile.tsx
//
// Reached from the header on every tab. Account, plan, and the retailer status
// board — the last one is genuinely useful to a user, not just to us: it
// explains an empty column in search without them having to guess.

import { useCallback, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Button, ErrorBanner, Loading, Screen, SectionTitle } from "@/components/ui";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { APP_VERSION, PRIVACY_URL, SUPPORT_EMAIL, supportMailto } from "@/constants/support";
import { resetOnboarding } from "@/lib/onboarding";
import { setPushRegistered, usePushRegistered } from "@/lib/pushStatus";
import { type ThemeMode, useTheme, useThemedStyles } from "@/lib/theme";
import { LANGUAGES, setLanguage, useLanguage, useTranslate } from "@/lib/i18n";
import ConfirmDialog from "@/components/ConfirmDialog";
import UsernameSheet from "@/components/UsernameSheet";
import {
  ApiError,
  deleteAccount,
  getMyXp,
  getNotificationStatus,
  getPlans,
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

export default function ProfileScreen() {
  const { colors, mode, setMode } = useTheme();
  const t = useTranslate();
  const language = useLanguage();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();

  const [email, setEmail] = useState<string | null>(null);
  // Null means we couldn't reach the server. Defaulting to "free" here was
  // the bug: offline, the app confidently told people they were on the free
  // plan rather than admitting it didn't know.
  const [tier, setTier] = useState<string | null>(null);
  // Fetched rather than hardcoded: the copy that used to live here drifted and
  // advertised Pro at 10 searches a day months after the cap moved to 30.
  const [planSummary, setPlanSummary] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchesLeft, setSearchesLeft] = useState<number | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [retailers, setRetailers] = useState<RetailerStatus[] | null>(null);
  // Shared, so enabling alerts here updates Home immediately.
  const pushRegistered = usePushRegistered();
  const [pushNote, setPushNote] = useState<string | null>(null);
  const [enablingPush, setEnablingPush] = useState(false);
  const [loading, setLoading] = useState(true);
  const [username, setUsernameValue] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);

  const load = useCallback(async () => {
    const [{ data: session }, quotaResult, statusResult, pushResult, xpResult, plansResult] =
      await Promise.all([
        supabase.auth.getSession(),
        getQuota().catch(() => null),
        getRetailerStatus().catch(() => null),
        getNotificationStatus().catch(() => null),
        getMyXp().catch(() => null),
        getPlans().catch(() => null),
      ]);

    setEmail(session.session?.user.email ?? null);
    if (quotaResult) {
      setTier(quotaResult.tier);
      setSearchesLeft(quotaResult.quota.remaining);
      setIsGuest(quotaResult.isGuest);
    }
    setPlanSummary(
      plansResult?.plans.find((p) => p.tier === quotaResult?.tier)?.summary ?? null,
    );
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
      setPushNote(t("profile.alertsOn"));
    } else if (result.status === "denied") {
      // Re-prompting after a denial is a no-op on both platforms, so point at
      // the only place that can actually change it.
      setPushNote(t("profile.permissionDenied"));
    } else {
      setPushNote(result.reason);
    }

    setEnablingPush(false);
  }

  async function onDeleteAccount() {
    if (!deletePassword) return setError(t("profile.enterPasswordConfirm"));
    setDeleting(true);
    setConfirmingDelete(false);
    try {
      await deleteAccount(deletePassword);
      setPushRegistered(null);
      // The session is dead server-side; clearing it locally is what sends the
      // auth gate back to the sign-in screen.
      await supabase.auth.signOut();
      await setGuestMode(false);
      router.replace("/auth");
    } catch (err) {
      setDeleting(false);
      setDeletePassword("");
      setError((err as ApiError).message);
    }
  }

  async function onSignOut() {
    // Deregister first: after signOut there's no token to authenticate the
    // delete, and a shared device would keep alerting the previous account.
    await deregisterPushNotifications();
    // The next account to sign in on this device starts from "unknown", not
    // from the previous user's answer.
    setPushRegistered(null);
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
                {email ?? t("profile.browsingAsGuest")}
              </Text>
            </View>
            <Pressable onPress={() => setEditingName(true)} hitSlop={8}>
              <Text style={styles.changeLink}>{username ? "Edit" : "Set name"}</Text>
            </Pressable>
          </View>

          <Text style={styles.identityNote}>
            {username
              ? t("profile.usernamePublic")
              : t("profile.usernameAnon")}
          </Text>
        </View>

        <Pressable
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}
          onPress={() => router.push("/plans")}
        >
          <View style={styles.planRow}>
            <Text style={styles.label}>{t("profile.plan")}</Text>
            <View style={styles.planRight}>
              <View style={[styles.tierPill, !tier && styles.tierPillUnknown]}>
                <Text style={[styles.tierPillText, !tier && styles.tierPillTextUnknown]}>
                  {tier ? tier.toUpperCase() : "—"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </View>
          </View>
          {planSummary ? (
            <Text style={styles.value}>{planSummary}</Text>
          ) : (
            <Text style={styles.unknown}>
              Can't reach Sweep right now, so your plan isn't confirmed.
            </Text>
          )}
          {searchesLeft !== null && (
            <Text style={styles.sub}>{pluralize(searchesLeft, "search")} left today</Text>
          )}
          <Text style={styles.comparePlans}>
            {tier === null || tier === "free" ? t("profile.comparePlans") : t("profile.seeIncluded")}
          </Text>
        </Pressable>

        <View style={styles.card}>
          <View style={styles.planRow}>
            <Text style={styles.label}>{t("profile.priceAlerts")}</Text>
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
              ? t("profile.alertsOnBody")
              : t("profile.alertsOffBody")}
          </Text>
          {pushNote && <Text style={styles.pushNote}>{pushNote}</Text>}
          {!pushRegistered && (
            <View style={styles.pushAction}>
              <Button
                label={t("profile.enableAlerts")}
                onPress={onEnablePush}
                busy={enablingPush}
                variant="secondary"
                compact
              />
            </View>
          )}
        </View>

        <View style={styles.section}>
          <SectionTitle>{t("profile.appearance")}</SectionTitle>
          <Text style={styles.sectionBlurb}>
            System follows your phone, so it switches when your phone does.
          </Text>
          <View style={styles.themeRow}>
            {THEME_OPTIONS.map((option) => {
              const selected = mode === option.mode;
              return (
                <Pressable
                  key={option.mode}
                  onPress={() => setMode(option.mode)}
                  style={({ pressed }) => [
                    styles.themeOption,
                    selected && styles.themeOptionOn,
                    pressed && styles.pressed,
                  ]}
                >
                  <Ionicons
                    name={option.icon}
                    size={19}
                    color={selected ? colors.accent : colors.textSecondary}
                  />
                  <Text style={[styles.themeLabel, selected && styles.themeLabelOn]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <SectionTitle>{t("profile.language")}</SectionTitle>
          <Text style={styles.sectionBlurb}>{t("profile.languageHint")}</Text>
          <View style={styles.themeRow}>
            {LANGUAGES.map((item) => {
              const selected = language === item.code;
              return (
                <Pressable
                  key={item.code}
                  onPress={() => setLanguage(item.code)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={({ pressed }) => [
                    styles.themeOption,
                    selected && styles.themeOptionOn,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.themeLabel, selected && styles.themeLabelOn]}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <SectionTitle>{t("profile.storeStatus")}</SectionTitle>
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
                  style={[styles.retailerDot, { backgroundColor: retailerColor(colors, item.retailer) }]}
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
              <Text style={styles.sub}>{t("profile.serverUnreachable")}</Text>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <SectionTitle>{t("profile.help")}</SectionTitle>
          <View style={styles.card}>
            <Pressable
              style={({ pressed }) => [styles.helpRow, pressed && styles.pressed]}
              onPress={() =>
                Linking.openURL(
                  supportMailto({ subject: t("profile.supportSubject"), tier }),
                )
              }
            >
              <Ionicons name="mail-outline" size={18} color={colors.accent} />
              <View style={styles.helpText}>
                <Text style={styles.helpTitle}>{t("profile.emailSupport")}</Text>
                <Text style={styles.helpSub}>{SUPPORT_EMAIL}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.helpRow,
                styles.statusRowDivided,
                pressed && styles.pressed,
              ]}
              onPress={async () => {
                await resetOnboarding();
                router.replace("/onboarding");
              }}
            >
              <Ionicons name="play-circle-outline" size={18} color={colors.accent} />
              <View style={styles.helpText}>
                <Text style={styles.helpTitle}>{t("profile.replayTour")}</Text>
                <Text style={styles.helpSub}>{t("profile.replaySub")}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.helpRow,
                styles.statusRowDivided,
                pressed && styles.pressed,
              ]}
              onPress={() => Linking.openURL(PRIVACY_URL)}
            >
              <Ionicons name="shield-checkmark-outline" size={18} color={colors.textSecondary} />
              <View style={styles.helpText}>
                <Text style={styles.helpTitle}>{t("profile.privacy")}</Text>
                <Text style={styles.helpSub}>{t("profile.privacyHint")}</Text>
              </View>
              <Ionicons name="open-outline" size={15} color={colors.textTertiary} />
            </Pressable>
            <View style={[styles.helpRow, styles.statusRowDivided]}>
              <Ionicons name="information-circle-outline" size={18} color={colors.textTertiary} />
              <View style={styles.helpText}>
                <Text style={styles.helpTitle}>{t("profile.version")}</Text>
                <Text style={styles.helpSub}>Sweep {APP_VERSION}</Text>
              </View>
            </View>
          </View>
        </View>

        {error && <ErrorBanner message={error} />}

        {!isGuest && (
          <Pressable
            onPress={() => setConfirmingDelete(true)}
            style={({ pressed }) => [styles.deleteRow, pressed && styles.pressed]}
          >
            <Ionicons name="trash-outline" size={15} color={colors.danger} />
            <Text style={styles.deleteText}>{t("profile.deleteAccount")}</Text>
          </Pressable>
        )}

        <View style={styles.actions}>
          {isGuest ? (
            <Button label={t("profile.createAccount")} onPress={() => router.push("/auth")} />
          ) : (
            <Button label={t("profile.signOut")} onPress={onSignOut} variant="secondary" />
          )}
        </View>
      </ScrollView>

      <UsernameSheet
        visible={editingName}
        current={username}
        onClose={() => setEditingName(false)}
        onSaved={load}
      />
      <ConfirmDialog
        content={
          confirmingDelete && !deleting
            ? {
                icon: "trash-outline",
                destructive: true,
                title: t("profile.deleteTitle"),
                body: t("profile.deleteBodyFull"),
                subject: email ? { title: email, caption: "This account" } : undefined,
                input: {
                  value: deletePassword,
                  onChangeText: setDeletePassword,
                  placeholder: "Your password",
                  secure: true,
                },
                confirmLabel: "Delete forever",
                cancelLabel: "Keep my account",
              }
            : null
        }
        onCancel={() => {
          setConfirmingDelete(false);
          setDeletePassword("");
        }}
        onConfirm={onDeleteAccount}
      />
    </Screen>
  );
}

const THEME_OPTIONS: {
  mode: ThemeMode;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
}[] = [
  { mode: "system", label: "System", icon: "phone-portrait-outline" },
  { mode: "light", label: "Light", icon: "sunny-outline" },
  { mode: "dark", label: "Dark", icon: "moon-outline" },
];

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    themeRow: { flexDirection: "row", gap: spacing.sm },
    themeOption: {
      flex: 1,
      alignItems: "center",
      gap: 5,
      paddingVertical: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surface,
    },
    themeOptionOn: { borderColor: colors.accent, backgroundColor: colors.accentMuted },
    themeLabel: {
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
      fontWeight: "700",
    },
    themeLabelOn: { color: colors.accent },
    deleteRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: spacing.sm,
    },
    deleteText: {
      color: colors.danger,
      fontSize: type.label.fontSize,
      fontWeight: "700",
    },
    helpRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: spacing.sm,
    },
    helpText: { flex: 1, gap: 1 },
    helpTitle: {
      color: colors.textPrimary,
      fontSize: type.body.fontSize,
      fontWeight: "600",
    },
    helpSub: { color: colors.textTertiary, fontSize: type.caption.fontSize },
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
    tierPillUnknown: { backgroundColor: colors.surfaceRaised },
    tierPillTextUnknown: { color: colors.textTertiary },
    unknown: { color: colors.warning, fontSize: type.label.fontSize },
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
