// app/auth.tsx
//
// Sign in, sign up, or continue as a guest.
//
// Note there's no syncUser call here: the root layout syncs on every auth
// state change, which also covers confirming by email and restoring a
// persisted session — paths that never pass through this screen.

import ForgotPasswordSheet from "@/components/ForgotPasswordSheet";
import PasswordInput from "@/components/PasswordInput";
import { Button } from "@/components/ui";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { storeListPhrase } from "@/lib/format";
import { setGuestMode } from "@/lib/guestMode";
import { supabase } from "@/lib/supabase";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

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

  /**
   * Sign in with whatever is in the form.
   *
   * Split out from the button handler because signing up with an address that
   * already has an account ends here too. `afterDuplicate` only changes the
   * wording of a rejected password: we already know the account exists, so the
   * usual "email or password is incorrect" would be vaguer than what we know.
   */
  async function attemptSignIn(afterDuplicate = false) {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      // Supabase returns the same "Invalid login credentials" whether the email
      // is unknown or the password is wrong — deliberately, so the form can't
      // be used to find out who has an account. Passed through verbatim it
      // reads as "your account is missing", which sends people to sign up
      // again and hit "already registered". Say what it actually means.
      if (/invalid login credentials/i.test(error.message)) {
        return fail(
          afterDuplicate
            ? "You already have an account with that email, but that password doesn't match. Try 'Forgot your password?' below."
            : "Email or password is incorrect. Try 'Forgot your password?' below.",
        );
      }
      if (/email not confirmed/i.test(error.message)) {
        return fail("Confirm your email first — check your inbox for the link.");
      }
      return fail(error.message);
    }

    await setGuestMode(false);
    router.replace("/(tabs)");
  }

  async function signUp() {
    Keyboard.dismiss();
    if (!validate()) return;

    setBusy(true);
    setMessage(null);

    try {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) return fail(error.message);

      // Supabase does not error on a duplicate email — it returns a
      // success-shaped response with no session, identical to a genuine new
      // signup, so nobody can probe which addresses have accounts. The one
      // tell is that `identities` comes back empty.
      //
      // At that point we know the account exists and we are holding an email
      // and password the person just typed, so we sign them in rather than
      // asking them to retype nothing and press a different button. If the
      // password is right they are simply in; if not, they get a message that
      // says which half was wrong.
      if (data.user && data.user.identities?.length === 0) {
        return await attemptSignIn(true);
      }

      if (data.session) {
        // Signing up supersedes guest mode, so the flag doesn't linger and
        // grant guest fallbacks to a real account.
        await setGuestMode(false);
        router.replace("/(tabs)");
      } else {
        setIsError(false);
        setMessage("Check your email to confirm your account, then log in.");
      }
    } catch {
      // Without this the screen locks: a throw would skip setBusy(false) and
      // leave every button on the page disabled with no way back.
      fail("Couldn't reach Sweep. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function signIn() {
    Keyboard.dismiss();
    if (!validate()) return;

    setBusy(true);
    setMessage(null);

    try {
      await attemptSignIn();
    } catch {
      fail("Couldn't reach Sweep. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
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
    // Scrollable rather than a centred View: with the keyboard up the window
    // shrinks, and a fixed centred column silently pushes its bottom controls
    // underneath the keyboard where taps land on keys instead of buttons.
    // keyboardShouldPersistTaps is what makes a button reachable on the FIRST
    // tap — the default lets the keyboard swallow that tap to dismiss itself.
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
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
      <PasswordInput
        fieldStyle={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
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
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    container: {
      // flexGrow, not flex: the column still centres when it fits, but is free
      // to grow taller than the viewport and scroll once the keyboard is up.
      flexGrow: 1,
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
