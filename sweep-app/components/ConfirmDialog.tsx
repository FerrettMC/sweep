// components/ConfirmDialog.tsx
//
// A confirm step that looks like the rest of the app.
//
// The OS alert is fine for "are you sure you want to delete", but it drops the
// user into stock system chrome mid-flow — white on a black app, no accent, no
// product. Here the moment worth confirming usually has an object attached
// ("you just logged this, stop watching it?"), and showing the thing being
// acted on is most of what makes the question easy to answer.
//
// Centered rather than a bottom sheet on purpose: sheets in this app hold
// forms you fill in, and a decision shouldn't look like an input.

import { Ionicons } from "@expo/vector-icons";
import {
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

export interface ConfirmContent {
  title: string;
  body?: string;
  /** Sits in the tinted circle at the top. */
  icon?: IoniconName;
  /** Shown as a small card, for when the question is about a specific product. */
  subject?: { title: string; imageUrl?: string | null; caption?: string };
  confirmLabel: string;
  cancelLabel: string;
  /** Red confirm button, for anything destructive. */
  destructive?: boolean;
  /**
   * Optional field the user must fill before confirming — a password, say.
   *
   * Re-authenticating in the same dialog matters for irreversible actions: a
   * signed-in session proves the phone was signed in, not that its owner is
   * the one tapping. Splitting it across two modals would just get dismissed.
   */
  input?: {
    value: string;
    onChangeText: (text: string) => void;
    placeholder: string;
    secure?: boolean;
  };
}

interface Props {
  content: ConfirmContent | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({ content, onConfirm, onCancel }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  if (!content) return null;

  const {
    title,
    body,
    icon = "help-circle",
    subject,
    confirmLabel,
    cancelLabel,
    destructive,
    input,
  } = content;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      {/* Tapping outside cancels — the safe choice either way, since the
          confirm action is the one that changes something. */}
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={[styles.iconCircle, destructive && styles.iconCircleDanger]}>
            <Ionicons
              name={icon}
              size={22}
              color={destructive ? colors.danger : colors.accent}
            />
          </View>

          <Text style={styles.title}>{title}</Text>
          {body && <Text style={styles.body}>{body}</Text>}

          {subject && (
            <View style={styles.subject}>
              {subject.imageUrl ? (
                <Image
                  source={{ uri: subject.imageUrl }}
                  style={styles.thumb}
                  resizeMode="contain"
                />
              ) : (
                <View style={[styles.thumb, styles.thumbEmpty]}>
                  <Ionicons name="cube-outline" size={16} color={colors.textTertiary} />
                </View>
              )}
              <View style={styles.subjectText}>
                <Text style={styles.subjectTitle} numberOfLines={2}>
                  {subject.title}
                </Text>
                {subject.caption && (
                  <Text style={styles.subjectCaption}>{subject.caption}</Text>
                )}
              </View>
            </View>
          )}

          {input && (
            <TextInput
              style={styles.input}
              value={input.value}
              onChangeText={input.onChangeText}
              placeholder={input.placeholder}
              placeholderTextColor={colors.textTertiary}
              secureTextEntry={input.secure}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
          )}

          <View style={styles.actions}>
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [
                styles.button,
                styles.cancel,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.cancelText}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              disabled={Boolean(input) && !input!.value}
              style={({ pressed }) => [
                styles.button,
                destructive ? styles.confirmDanger : styles.confirm,
                pressed && styles.pressed,
                Boolean(input) && !input!.value && styles.confirmDisabled,
              ]}
            >
              <Text style={destructive ? styles.confirmDangerText : styles.confirmText}>
                {confirmLabel}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: colors.scrimStrong,
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.lg,
    },
    card: {
      width: "100%",
      maxWidth: 360,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      padding: spacing.lg,
      alignItems: "center",
      gap: spacing.sm,
    },
    iconCircle: {
      width: 46,
      height: 46,
      borderRadius: radius.pill,
      backgroundColor: colors.accentMuted,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.xs,
    },
    iconCircleDanger: { backgroundColor: colors.dangerMuted },
    title: {
      color: colors.textPrimary,
      fontSize: type.heading.fontSize,
      fontWeight: "800",
      textAlign: "center",
    },
    body: {
      color: colors.textSecondary,
      fontSize: type.body.fontSize,
      textAlign: "center",
      lineHeight: 21,
    },
    subject: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      alignSelf: "stretch",
      backgroundColor: colors.background,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      padding: spacing.sm,
      marginTop: spacing.xs,
    },
    thumb: {
      width: 40,
      height: 40,
      borderRadius: radius.sm,
      backgroundColor: "#FFFFFF",
    },
    thumbEmpty: {
      backgroundColor: colors.surfaceRaised,
      alignItems: "center",
      justifyContent: "center",
    },
    subjectText: { flex: 1, gap: 1 },
    subjectTitle: {
      color: colors.textPrimary,
      fontSize: type.label.fontSize,
      fontWeight: "600",
    },
    subjectCaption: { color: colors.textTertiary, fontSize: type.caption.fontSize },
    actions: {
      flexDirection: "row",
      gap: spacing.sm,
      alignSelf: "stretch",
      marginTop: spacing.md,
    },
    button: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 13,
      borderRadius: radius.md,
      borderWidth: 1,
    },
    pressed: { opacity: 0.75 },
    cancel: { backgroundColor: colors.surfaceRaised, borderColor: colors.surfaceBorder },
    cancelText: {
      color: colors.textPrimary,
      fontSize: type.body.fontSize,
      fontWeight: "700",
    },
    input: {
      alignSelf: "stretch",
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: 12,
      color: colors.textPrimary,
      fontSize: type.body.fontSize,
      marginTop: spacing.sm,
    },
    confirmDisabled: { opacity: 0.4 },
    confirm: { backgroundColor: colors.accent, borderColor: colors.accent },
    confirmText: {
      color: colors.background,
      fontSize: type.body.fontSize,
      fontWeight: "800",
    },
    confirmDanger: { backgroundColor: colors.danger, borderColor: colors.danger },
    confirmDangerText: {
      color: colors.background,
      fontSize: type.body.fontSize,
      fontWeight: "800",
    },
  });
