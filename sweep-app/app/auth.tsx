// app/auth.tsx
//
// Sign in, sign up, or continue as a guest.
//
// Note there's no syncUser call here: the root layout syncs on every auth
// state change, which also covers confirming by email and restoring a
// persisted session — paths that never pass through this screen.

import ForgotPasswordSheet from "@/components/ForgotPasswordSheet";
import { Button } from "@/components/ui";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { storeListPhrase } from "@/lib/format";
import { setGuestMode } from "@/lib/guestMode";
import { supabase } from "@/lib/supabase";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

export default function Auth() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(true);
  const [busy, setBusy] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  function fail(text: string) {
    setIsError(true);
    setMessage(text);
  }

  async function signUp() {
    if (!validate()) return;

    setBusy(true);
    setMessage(null);

    const { data, error } = await supabase.auth.signUp({ email, password });
    setBusy(false);

    if (error) return fail(error.message);

    if (data.session) {
      // Signing up supersedes guest mode, so the flag doesn't linger and grant
      // guest fallbacks to a real account.
      await setGuestMode(false);
      router.replace("/(tabs)");
    } else {
      setIsError(false);
      setMessage("Check your email to confirm your account, then log in.");
    }
  }

  async function signIn() {
    if (!validate()) return;

    setBusy(true);
    setMessage(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setBusy(false);

    if (error) {
      // Supabase returns the same "Invalid login credentials" whether the email
      // is unknown or the password is wrong — deliberately, so the form can't
      // be used to find out who has an account. Passed through verbatim it
      // reads as "your account is missing", which sends people to sign up
      // again and hit "already registered". Say what it actually means.
      if (/invalid login credentials/i.test(error.message)) {
        return fail("Email or password is incorrect. Try 'Forgot your password?' below.");
      }
      if (/email not confirmed/i.test(error.message)) {
        return fail("Confirm your email first — check your inbox for the link.");
      }
      return fail(error.message);
    }

    await setGuestMode(false);
    router.replace("/(tabs)");
  }

  async function continueAsGuest() {
    await setGuestMode(true);
    router.replace("/(tabs)");
  }

  function validate() {
    if (!email.trim() || !password) {
      fail("Enter an email and password.");
      return false;
    }
    // Supabase enforces this server-side too; catching it here saves a round
    // trip and gives a clearer message than the API's.
    if (password.length < 6) {
      fail("Password must be at least 6 characters.");
      return false;
    }
    return true;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sweep</Text>
      <Text style={styles.subtitle}>Your online shopping buddy</Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor={colors.textTertiary}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor={colors.textTertiary}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        textContentType="password"
      />

      {message && (
        <Text style={[styles.message, !isError && styles.messageOk]}>
          {message}
        </Text>
      )}

      <Button label="Sign Up" onPress={signUp} busy={busy} />
      <Button
        label="Log In"
        onPress={signIn}
        variant="secondary"
        disabled={busy}
      />

      {/* Below the buttons, not beside the password field: it's a recovery
          path, not part of signing in, and it should be findable without
          competing with the thing most people are here to do. */}
      <Pressable
        style={styles.forgotButton}
        onPress={() => setForgotOpen(true)}
        disabled={busy}
        hitSlop={8}
      >
        <Text style={styles.forgotText}>Forgot your password?</Text>
      </Pressable>

      <Pressable
        style={styles.guestButton}
        onPress={continueAsGuest}
        disabled={busy}
      >
        <Text style={styles.guestButtonText}>Continue as guest</Text>
      </Pressable>

      <ForgotPasswordSheet
        visible={forgotOpen}
        initialEmail={email}
        onClose={() => setForgotOpen(false)}
        onDone={(text) => {
          setIsError(false);
          setMessage(text);
          router.replace("/(tabs)");
        }}
      />
      <Text style={styles.guestNote}>
        Compare prices across {storeListPhrase()} in one search. Guests get one
        a day.
      </Text>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
      justifyContent: "center",
      padding: spacing.xl,
      gap: spacing.sm,
    },
    title: {
      color: colors.accent,
      fontSize: 44,
      fontWeight: "900",
      textAlign: "center",
    },
    subtitle: {
      color: colors.textSecondary,
      fontSize: type.body.fontSize,
      textAlign: "center",
      marginBottom: spacing.lg,
    },
    input: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: radius.md,
      padding: spacing.md,
      color: colors.textPrimary,
      fontSize: 16,
    },
    message: {
      color: colors.danger,
      fontSize: type.label.fontSize,
      textAlign: "center",
      paddingVertical: spacing.xs,
    },
    messageOk: { color: colors.success },
    forgotButton: { paddingVertical: spacing.sm, alignItems: "center" },
    forgotText: {
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
      fontWeight: "600",
    },
    guestButton: { paddingVertical: spacing.sm, alignItems: "center" },
    guestButtonText: {
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
      textDecorationLine: "underline",
    },
    guestNote: {
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
      textAlign: "center",
      lineHeight: 15,
    },
  });
