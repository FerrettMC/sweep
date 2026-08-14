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
import { Button } from "@/components/ui";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { supabase } from "@/lib/supabase";

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
    if (!address.includes("@")) return setError("Enter the email you signed up with.");

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
    if (code.trim().length < 6) return setError("Enter the 6-digit code from the email.");
    if (password.length < 8) return setError("Passwords need at least 8 characters.");

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
      return setError("That code didn't work. It may have expired — send a new one.");
    }

    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) return setError(updateError.message);

    onDone("Password changed. You're signed in.");
    onClose();
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.heading}>
              {step === "email" ? "Reset your password" : "Check your email"}
            </Text>

            {step === "email" ? (
              <>
                <Text style={styles.body}>
                  We'll email you a six-digit code. It's valid for one hour.
                </Text>
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
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
                  If there's an account for {email.trim().toLowerCase()}, a code is
                  on its way. Enter it below with your new password.
                </Text>
                <TextInput
                  style={[styles.input, styles.codeInput]}
                  value={code}
                  onChangeText={(t) => setCode(t.replace(/[^0-9]/g, "").slice(0, 6))}
                  placeholder="000000"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoFocus
                />
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="New password (8+ characters)"
                  placeholderTextColor={colors.textTertiary}
                  secureTextEntry
                  autoCapitalize="none"
                />
                <Pressable onPress={() => setStep("email")} hitSlop={8}>
                  <Text style={styles.link}>Send another code</Text>
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
            <Button label="Cancel" onPress={onClose} variant="secondary" />
            <Button
              label={step === "email" ? "Send code" : "Change password"}
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
    backdrop: { flex: 1, backgroundColor: colors.scrim, justifyContent: "flex-end" },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      maxHeight: "85%",
      borderTopWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    grabber: {
      alignSelf: "center",
      width: 38,
      height: 4,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceBorder,
      marginTop: spacing.sm,
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
      fontSize: 24,
      fontWeight: "800",
      letterSpacing: 8,
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
