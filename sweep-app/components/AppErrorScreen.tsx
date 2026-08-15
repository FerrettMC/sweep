// components/AppErrorScreen.tsx
//
// What a user sees if something in the app throws.
//
// In development an uncaught error gets LogBox — the red screen with a stack
// trace. None of that ships: LogBox is stripped from production builds, so
// without an error boundary the same crash renders nothing at all. A blank
// screen with no way out is the worst possible version of a bug, because it
// looks like the app is broken rather than that one screen failed.
//
// Deliberately offers a retry rather than only apologising. expo-router's
// boundary can re-render the failed route, and a surprising number of crashes
// are transient — a bad response, a race on a screen that unmounted mid-load.

import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { useTranslate } from "@/lib/i18n";
import { APP_VERSION, SUPPORT_EMAIL, supportMailto } from "@/constants/support";
import { Linking } from "react-native";

export default function AppErrorScreen({
  error,
  retry,
}: {
  error: Error;
  retry: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.icon}>
          <Ionicons name="alert-circle-outline" size={30} color={colors.accent} />
        </View>

        <Text style={styles.title}>{t("appError.title")}</Text>
        <Text style={styles.body}>{t("appError.body")}</Text>

        <Pressable
          onPress={retry}
          style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
        >
          <Text style={styles.primaryText}>{t("appError.tryAgain")}</Text>
        </Pressable>

        <Pressable
          onPress={() =>
            Linking.openURL(
              supportMailto({ subject: `Sweep error: ${error.message.slice(0, 60)}` }),
            )
          }
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
        >
          <Ionicons name="mail-outline" size={15} color={colors.textSecondary} />
          <Text style={styles.secondaryText}>{t("appError.tellUs")}</Text>
        </Pressable>

        {/*
          The message, not the stack. It's what someone would paste into an
          email, and it's occasionally self-explanatory ("Network request
          failed"). A stack trace would just be noise on a phone.
        */}
        <Text style={styles.detail} selectable>
          {error.message}
        </Text>
        <Text style={styles.version}>
          Sweep {APP_VERSION} · {SUPPORT_EMAIL}
        </Text>
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: {
      flexGrow: 1,
      justifyContent: "center",
      padding: spacing.lg,
      gap: spacing.sm,
    },
    icon: {
      width: 56,
      height: 56,
      borderRadius: radius.pill,
      backgroundColor: colors.accentMuted,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.sm,
    },
    title: {
      color: colors.textPrimary,
      fontSize: type.title.fontSize,
      fontWeight: "900",
    },
    body: {
      color: colors.textSecondary,
      fontSize: type.body.fontSize,
      lineHeight: 22,
      marginBottom: spacing.md,
    },
    primary: {
      backgroundColor: colors.accent,
      borderRadius: radius.md,
      paddingVertical: 14,
      alignItems: "center",
    },
    primaryText: {
      color: colors.background,
      fontSize: type.body.fontSize,
      fontWeight: "800",
    },
    secondary: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: 12,
    },
    secondaryText: {
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
      fontWeight: "700",
    },
    pressed: { opacity: 0.75 },
    detail: {
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
      marginTop: spacing.md,
      lineHeight: 16,
    },
    version: {
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
      marginTop: spacing.xs,
    },
  });
