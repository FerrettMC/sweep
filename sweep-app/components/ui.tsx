// components/ui.tsx
//
// Small shared primitives. Here so an empty state or an error looks the same
// on every screen rather than being re-invented per file.

import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { useTranslate } from "@/lib/i18n";

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
  busy,
  compact,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  busy?: boolean;
  compact?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const isDisabled = disabled || busy;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        variant === "primary" && styles.buttonPrimary,
        variant === "secondary" && styles.buttonSecondary,
        variant === "danger" && styles.buttonDanger,
        pressed && !isDisabled && styles.buttonPressed,
        isDisabled && styles.buttonDisabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator
          size="small"
          color={variant === "primary" ? colors.background : colors.textPrimary}
        />
      ) : (
        <Text
          style={[
            styles.buttonText,
            compact && styles.buttonTextCompact,
            variant === "primary" && styles.buttonTextPrimary,
            variant === "secondary" && styles.buttonTextSecondary,
            variant === "danger" && styles.buttonTextDanger,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Screen({ children }: { children: React.ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  return <View style={styles.screen}>{children}</View>;
}

export function Loading({ label }: { label?: string }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={colors.accent} />
      {label && <Text style={styles.centeredText}>{label}</Text>}
    </View>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.centered}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {action && <View style={styles.emptyAction}>{action}</View>}
    </View>
  );
}

export function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();
  return (
    <View style={styles.errorBanner}>
      <Text style={styles.errorText}>{message}</Text>
      {onRetry && (
        <Pressable onPress={onRetry} hitSlop={8}>
          <Text style={styles.errorRetry}>{t("common.retryShort")}</Text>
        </Pressable>
      )}
    </View>
  );
}

/** Small labelled stat, used in rows on the product detail screen. */
export function Stat({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

export function SectionTitle({
  children,
  trailing,
}: {
  children: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {trailing}
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    button: {
      borderRadius: radius.md,
      paddingVertical: 14,
      paddingHorizontal: spacing.lg,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 48,
    },
    buttonCompact: {
      paddingVertical: 8,
      paddingHorizontal: spacing.md,
      minHeight: 36,
      borderRadius: radius.sm,
    },
    buttonPrimary: { backgroundColor: colors.accent },
    buttonSecondary: {
      backgroundColor: colors.surfaceRaised,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    buttonDanger: { backgroundColor: "transparent" },
    buttonPressed: { opacity: 0.75 },
    buttonDisabled: { opacity: 0.4 },
    buttonText: { fontSize: type.body.fontSize, fontWeight: "700" },
    buttonTextCompact: { fontSize: type.label.fontSize },
    buttonTextPrimary: { color: colors.background },
    buttonTextSecondary: { color: colors.textPrimary },
    buttonTextDanger: { color: colors.danger },
    centered: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.xl,
      gap: spacing.sm,
      // Loading and empty states are rendered OUTSIDE <Screen> by most screens
      // (`if (loading) return <Loading />`), so they need their own background —
      // without it they show the navigator's default, which is white.
      backgroundColor: colors.background,
    },
    centeredText: { color: colors.textSecondary, fontSize: type.label.fontSize },
    emptyTitle: {
      color: colors.textPrimary,
      fontSize: type.heading.fontSize,
      fontWeight: "800",
      textAlign: "center",
    },
    emptyBody: {
      color: colors.textSecondary,
      fontSize: type.body.fontSize,
      textAlign: "center",
      lineHeight: 21,
    },
    emptyAction: { marginTop: spacing.md, alignSelf: "stretch" },
    errorBanner: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
      backgroundColor: colors.dangerMuted,
      borderWidth: 1,
      borderColor: colors.danger,
      borderRadius: radius.md,
      padding: spacing.md,
      margin: spacing.md,
    },
    errorText: { color: colors.dangerOn, fontSize: type.label.fontSize, flex: 1 },
    errorRetry: {
      color: colors.danger,
      fontSize: type.label.fontSize,
      fontWeight: "800",
    },
    stat: { flex: 1, gap: 2 },
    statLabel: {
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      fontWeight: "700",
    },
    statValue: {
      color: colors.textPrimary,
      fontSize: type.heading.fontSize,
      fontWeight: "800",
    },
    sectionTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: spacing.sm,
    },
    sectionTitle: {
      color: colors.textPrimary,
      fontSize: type.heading.fontSize,
      fontWeight: "800",
    },
  });
