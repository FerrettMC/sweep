// components/ForgotPasswordSheet.tsx
//
// Recovering an account you can't sign into.
//
// Uses a six-digit code rather than a magic link. A link would arrive as
// `sweep://...#access_token=...`, and with `detectSessionInUrl: false` — which
// is correct on mobile — the app would have to catch the deep link, parse the
// fragment, and set the session by hand. Every step there is a place to break,
// and it breaks silently: the user taps a link, something doesn't fire, and
// they're stuck with no way to tell you what happened.
//
// A code is typed into a screen the user is already looking at. It works from a
// desktop inbox, survives the email being forwarded, and when it fails it fails
// visibly with "that code is wrong".
//
// Requires one thing in the Supabase dashboard: the "Reset Password" email
// template must include {{ .Token }}. The default only has a link.

import { useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import PasswordInput from "@/components/PasswordInput";
import { Button } from "@/components/ui";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { useTranslate } from "@/lib/i18n";
import { MIN_PASSWORD_LENGTH } from "@/lib/authErrors";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";

/** Supabase allows 6–10; don't hard-code the project's current choice. */
// Supabase's email OTP length is a project setting, valid from 6 to 10, so
// both ends are accepted rather than one length assumed. Six is what it should
// be set to: a code is read in another app and typed back in this one, and six
// digits survive that trip in one glance where eight does not.
const MIN_CODE_LENGTH = 6;
const MAX_CODE_LENGTH = 10;

interface Props {
  visible: boolean;
  /** Prefilled from the sign-in form, so it's usually already right. */
  initialEmail: string;
  onClose: () => void;
  onDone: (message: string) => void;
}

export default function ForgotPasswordSheet({
  visible,
  initialEmail,
  onClose,
  onDone,
}: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();
  // Anchored near the top rather than the bottom: every field in here needs the
  // keyboard, and a bottom sheet ends up underneath it.
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openedFor, setOpenedFor] = useState<string | null>(null);

  // Reset each time the sheet opens, so a previous attempt doesn't linger.
  const key = visible ? initialEmail || "blank" : null;
  if (key !== null && openedFor !== key) {
    setOpenedFor(key);
    setStep("email");
    setEmail(initialEmail);
    setCode("");
    setPassword("");
    setError(null);
  }

  if (!visible) return null;

  async function sendCode() {
    const address = email.trim().toLowerCase();
    if (!address.includes("@")) return setError(t("reset.enterEmail"));

    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(address);
    setBusy(false);

    // Deliberately advances even on error. Telling someone "no account with
    // that email" turns this form into a way to discover who has an account.
    if (error && !/rate|limit/i.test(error.message)) {
      setStep("code");
      return;
    }
    if (error) return setError(error.message);
    setStep("code");
  }

  async function confirm() {
    // Supabase's OTP length is a project setting (6–10), so don't assume six.
    if (code.trim().length < MIN_CODE_LENGTH) {
      return setError(t("reset.enterCode"));
    }
    if (password.length < MIN_PASSWORD_LENGTH) return setError(t("reset.tooShort"));

    setBusy(true);
    setError(null);

    // Verifying the code signs the user in, which is what makes the password
    // update below possible — updateUser needs an authenticated session.
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.trim(),
      type: "recovery",
    });
    if (verifyError) {
      setBusy(false);
      return setError(t("reset.badCode"));
    }

    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) return setError(updateError.message);

    onDone(t("reset.done"));
    onClose();
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.backdrop, { paddingTop: insets.top + spacing.lg }]}>
        <View style={styles.sheet}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.heading}>
              {step === "email" ? t("reset.title") : t("reset.checkTitle")}
            </Text>

            {step === "email" ? (
              <>
                <Text style={styles.body}>{t("reset.intro")}</Text>
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder={t("reset.emailPlaceholder")}
                  placeholderTextColor={colors.textTertiary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  autoFocus
                />
              </>
            ) : (
              <>
                <Text style={styles.body}>
                  {t("reset.sent", { email: email.trim().toLowerCase() })}
                </Text>
                <TextInput
                  style={[styles.input, styles.codeInput]}
                  value={code}
                  // Alphanumeric and generously long: the token format is a
                  // project setting, and silently truncating a valid code is a
                  // maddening failure — it just says "that didn't work".
                  onChangeText={(text) =>
                    setCode(text.replace(/\s/g, "").slice(0, MAX_CODE_LENGTH))
                  }
                  placeholder={t("reset.codePlaceholder")}
                  placeholderTextColor={colors.textTertiary}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={MAX_CODE_LENGTH}
                  // Lets the OS offer the code straight from the notification
                  // where it can, which is the whole trip to the mail app and
                  // back. Ignored where it can't; costs nothing to ask.
                  textContentType="oneTimeCode"
                  autoComplete="one-time-code"
                  autoFocus
                />
                <PasswordInput
                  fieldStyle={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder={t("reset.newPassword")}
                />
                <Pressable onPress={() => setStep("email")} hitSlop={8}>
                  <Text style={styles.link}>{t("reset.sendAnother")}</Text>
                </Pressable>
              </>
            )}

            {error && (
              <View style={styles.errorRow}>
                <Ionicons name="alert-circle" size={15} color={colors.danger} />
                <Text style={styles.error}>{error}</Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.actions}>
            <Button label={t("common.cancel")} onPress={onClose} variant="secondary" />
            <Button
              label={step === "email" ? t("reset.sendCode") : t("reset.changePassword")}
              onPress={step === "email" ? sendCode : confirm}
              busy={busy}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: colors.scrim,
      justifyContent: "flex-start",
      paddingHorizontal: spacing.md,
    },
    // A floating card, not a sheet: it sits above the keyboard rather than
    // being pushed off-screen by it.
    sheet: {
      backgroundColor: colors.background,
      borderRadius: radius.lg,
      maxHeight: "75%",
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      overflow: "hidden",
    },
    content: { padding: spacing.md, gap: spacing.sm },
    heading: {
      color: colors.textPrimary,
      fontSize: type.title.fontSize,
      fontWeight: "800",
    },
    body: {
      color: colors.textSecondary,
      fontSize: type.body.fontSize,
      lineHeight: 21,
      marginBottom: spacing.xs,
    },
    input: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: 13,
      color: colors.textPrimary,
      fontSize: type.body.fontSize,
    },
    codeInput: {
      fontSize: 22,
      fontWeight: "800",
      letterSpacing: 4,
      textAlign: "center",
    },
    link: {
      color: colors.accent,
      fontSize: type.label.fontSize,
      fontWeight: "700",
      paddingVertical: 6,
    },
    errorRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
    error: { flex: 1, color: colors.danger, fontSize: type.label.fontSize, lineHeight: 18 },
    actions: {
      flexDirection: "row",
      gap: spacing.sm,
      padding: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.surfaceBorder,
    },
  });
