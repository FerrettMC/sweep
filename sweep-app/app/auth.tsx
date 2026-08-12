// app/auth.tsx
//
// Sign in, sign up, or continue as a guest.
//
// Note there's no syncUser call here: the root layout syncs on every auth
// state change, which also covers confirming by email and restoring a
// persisted session — paths that never pass through this screen.

import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Button } from "@/components/ui";
import { colors, radius, spacing, type } from "@/constants/theme";
import { setGuestMode } from "@/lib/guestMode";
import { supabase } from "@/lib/supabase";

export default function Auth() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(true);
  const [busy, setBusy] = useState(false);

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

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);

    if (error) return fail(error.message);

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
      <Text style={styles.subtitle}>Track prices across every store</Text>

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
        <Text style={[styles.message, !isError && styles.messageOk]}>{message}</Text>
      )}

      <Button label="Sign Up" onPress={signUp} busy={busy} />
      <Button label="Log In" onPress={signIn} variant="secondary" disabled={busy} />

      <Pressable style={styles.guestButton} onPress={continueAsGuest} disabled={busy}>
        <Text style={styles.guestButtonText}>Continue as guest</Text>
      </Pressable>
      <Text style={styles.guestNote}>
        Guests get one multi-store search a day. Tracking and price alerts need
        an account.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
