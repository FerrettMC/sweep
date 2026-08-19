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
import { useTranslate } from "@/lib/i18n";
import { friendlyAuthErrorKey } from "@/lib/authErrors";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  AppState,
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
  const t = useTranslate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(true);
  const [busy, setBusy] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  // Set when an account exists but hasn't been confirmed. Drives a panel
  // rather than another line of message text: the old flow said "check your
  // email" after signup and then said almost the same thing again when Log In
  // was pressed, which reads as the button doing nothing.
  const [awaitingConfirm, setAwaitingConfirm] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  // Scrolling is only enabled when the content genuinely overflows. A
  // ScrollView claims a touch as a scroll the moment the finger drifts a few
  // pixels, which cancels the press underneath it — so on a screen that fits,
  // buttons feel like they need to be jabbed precisely. Measuring both heights
  // keeps the keyboard fix (reachable buttons on a shrunken viewport) without
  // paying for it on every tap.
  const [viewportHeight, setViewportHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const scrollable = contentHeight > viewportHeight;

  // Confirming happens in a browser, so the moment that matters is the user
  // coming back to the app. Retrying the sign-in then turns "confirm, switch
  // back, type it all again" into "confirm, switch back, you're in" — without
  // deep links, which email clients handle unevenly, or PKCE, which breaks if
  // the link is opened on a different device.
  //
  // The credentials are already in this screen's state; nothing is stored.
  const credentials = useRef({ email: "", password: "" });
  credentials.current = { email, password };

  useEffect(() => {
    if (!awaitingConfirm) return;

    const subscription = AppState.addEventListener("change", async (state) => {
      if (state !== "active") return;
      const { email: address, password: secret } = credentials.current;
      if (!address || !secret) return;

      const { data, error } = await supabase.auth.signInWithPassword({
        email: address,
        password: secret,
      });
      // Still unconfirmed is the expected case on most returns — say nothing
      // rather than nagging someone who just switched apps for a second.
      if (error || !data.session) return;

      setAwaitingConfirm(null);
      await setGuestMode(false);
      router.replace("/(tabs)");
    });

    return () => subscription.remove();
  }, [awaitingConfirm, router]);

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
            ? t("auth.accountExists")
            : t("auth.badCredentials"),
        );
      }
      if (/email not confirmed/i.test(error.message)) {
        setAwaitingConfirm(email.trim());
        return fail(t("auth.confirmBlocked"));
      }
      return fail(t(friendlyAuthErrorKey(error.message)));
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
      if (error) return fail(t(friendlyAuthErrorKey(error.message)));

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
        // No session means the project requires email confirmation.
        setAwaitingConfirm(email.trim());
        setIsError(false);
        setMessage(null);
      }
    } catch {
      // Without this the screen locks: a throw would skip setBusy(false) and
      // leave every button on the page disabled with no way back.
      fail(t("auth.offline"));
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
      fail(t("auth.offline"));
    } finally {
      setBusy(false);
    }
  }

  async function resendConfirmation() {
    if (!awaitingConfirm) return;
    setResending(true);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: awaitingConfirm,
      });
      setIsError(Boolean(error));
      // Supabase rate-limits resends; saying so beats a raw provider error.
      setMessage(error ? t("auth.resendFailed") : t("auth.resent"));
    } catch {
      fail(t("auth.offline"));
    } finally {
      setResending(false);
    }
  }

  async function continueAsGuest() {
    await setGuestMode(true);
    router.replace("/(tabs)");
  }

  function validate() {
    if (!email.trim() || !password) {
      fail(t("auth.needBoth"));
      return false;
    }
    // Supabase enforces this server-side too; catching it here saves a round
    // trip and gives a clearer message than the API's.
    if (password.length < 6) {
      fail(t("auth.tooShort"));
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
      scrollEnabled={scrollable}
      onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
      onContentSizeChange={(_width, height) => setContentHeight(height)}
    >
      <Text style={styles.title}>{t("auth.title")}</Text>
      <Text style={styles.subtitle}>{t("auth.subtitle")}</Text>

      <TextInput
        style={styles.input}
        placeholder={t("auth.email")}
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
        placeholder={t("auth.password")}
        value={password}
        onChangeText={setPassword}
        textContentType="password"
      />

      {awaitingConfirm && (
        <View style={styles.confirmPanel}>
          <Text style={styles.confirmTitle}>{t("auth.confirmTitle")}</Text>
          <Text style={styles.confirmBody}>
            {t("auth.confirmBody", { email: awaitingConfirm })}
          </Text>
          <Button
            label={t("auth.resend")}
            onPress={resendConfirmation}
            busy={resending}
            variant="secondary"
            compact
          />
        </View>
      )}

      {message && (
        <Text style={[styles.message, !isError && styles.messageOk]}>
          {message}
        </Text>
      )}

      <Button label={t("auth.signUp")} onPress={signUp} busy={busy} />
      <Button
        label={t("auth.logIn")}
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
        <Text style={styles.forgotText}>{t("auth.forgot")}</Text>
      </Pressable>

      <Pressable
        style={styles.guestButton}
        onPress={continueAsGuest}
        disabled={busy}
      >
        <Text style={styles.guestButtonText}>{t("auth.continueAsGuest")}</Text>
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
        {t("auth.guestNote", { stores: storeListPhrase() })}
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
    confirmPanel: {
      gap: 6,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.accentMuted,
      borderWidth: 1,
      borderColor: colors.accent,
    },
    confirmTitle: {
      color: colors.textPrimary,
      fontSize: type.label.fontSize,
      fontWeight: "800",
    },
    confirmBody: {
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
      lineHeight: 18,
      marginBottom: 4,
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
