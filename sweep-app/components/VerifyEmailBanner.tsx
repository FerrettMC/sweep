// components/VerifyEmailBanner.tsx
//
// "Confirm your email", asked where it doesn't cost us the signup.
//
// This used to live on the signup screen as a wall: sign up, then sit there
// unable to continue until you'd switched to your email app, found the link,
// and come back. People bounce there, and the ones who bounce never see the
// app at all — they left before using it once.
//
// Moving the ask here inverts that. Someone signs up, lands in the app, and
// is reminded on Home and Profile until they get round to it. They've used
// the thing before being asked to prove anything, which is both better
// manners and a better conversion rate.
//
// Requires "Confirm email" to be OFF in Supabase Auth, otherwise sign-in is
// refused server-side and nobody reaches a screen this could appear on. The
// component is harmless either way: with confirmation required, no unconfirmed
// user is ever signed in, so it simply never renders.

import { useCallback, useEffect, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { useTranslate } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";
import {
  clearVerifyNag,
  loadVerifyNag,
  shouldShowVerifyNag,
  snoozeVerifyNag,
  useVerifyNagSnoozedUntil,
} from "@/lib/verifyNag";

export default function VerifyEmailBanner() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();

  const [email, setEmail] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<"ok" | "failed" | null>(null);
  // Shared across every copy of this banner, so dismissing it on Home also
  // dismisses the one on Profile.
  const snoozedUntil = useVerifyNagSnoozedUntil();

  const check = useCallback(async () => {
    await loadVerifyNag();
    try {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      // Deliberately checked on the user rather than the session: a session
      // exists either way, and it's the confirmation timestamp that decides.
      const unconfirmed = Boolean(user && !user.email_confirmed_at);
      setEmail(unconfirmed ? (user?.email ?? null) : null);
      // Confirmed now, so a future account on this device isn't silently
      // snoozed by a decision this person made.
      if (user && !unconfirmed) await clearVerifyNag();
    } catch {
      // Offline, or no session. Either way there's nothing to nag about.
      setEmail(null);
    }
  }, []);

  useEffect(() => {
    void check();
    // Re-checked when the app comes back, which is exactly when someone has
    // just tapped the link in their email app. Without this the banner sits
    // there after they've already done what it asked.
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    return () => subscription.remove();
  }, [check]);

  const show = shouldShowVerifyNag({
    unconfirmed: email !== null,
    snoozedUntil,
    now: Date.now(),
  });
  // `email === null` is redundant with `show` but the compiler can't see that
  // through the helper, and it's what narrows the type for the copy below.
  if (!show || email === null) return null;

  async function resend() {
    if (!email) return;
    setSending(true);
    try {
      const { error } = await supabase.auth.resend({ type: "signup", email });
      setSent(error ? "failed" : "ok");
    } catch {
      setSent("failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={styles.banner}>
      <Ionicons name="mail-unread-outline" size={18} color={colors.warning} />
      <View style={styles.body}>
        <Text style={styles.title}>{t("verify.title")}</Text>
        <Text style={styles.text}>
          {sent === "ok"
            ? t("verify.resent", { email })
            : sent === "failed"
              ? t("verify.resendFailed")
              : t("verify.body", { email })}
        </Text>
        {sent !== "ok" && (
          <Pressable onPress={resend} disabled={sending} hitSlop={8}>
            <Text style={styles.action}>
              {sending ? t("verify.sending") : t("verify.resend")}
            </Text>
          </Pressable>
        )}
      </View>
      {/* Snoozed, not dismissed: an unconfirmed address is worth raising
          again — it's the difference between recovering an account and losing
          it — but never worth trapping anyone over. */}
      <Pressable onPress={() => void snoozeVerifyNag()} hitSlop={10}>
        <Ionicons name="close" size={16} color={colors.textTertiary} />
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    banner: {
      flexDirection: "row",
      gap: spacing.sm,
      alignItems: "flex-start",
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.md,
    },
    body: { flex: 1, gap: 2 },
    title: {
      color: colors.textPrimary,
      fontSize: type.label.fontSize,
      fontWeight: "800",
    },
    text: { color: colors.textSecondary, fontSize: type.caption.fontSize },
    action: {
      color: colors.accent,
      fontSize: type.caption.fontSize,
      fontWeight: "700",
      marginTop: 4,
    },
  });
