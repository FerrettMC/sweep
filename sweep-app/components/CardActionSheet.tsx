// components/CardActionSheet.tsx
//
// The actions that don't fit on a grid card.
//
// A half-width card can hold one button. Search results carry five — compare,
// list, details, cart, track — so four of them live here, in a sheet the
// screen owns rather than the card, because the card is rendered eight times
// on screen and eight modals is eight modals.
//
// Takes CardAction, the same type the toolbar renders, so an action behaves
// identically whether it was tapped in a row or in here. The alternative was a
// second list of labels and icons that would drift from the first.

import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { useTranslate } from "@/lib/i18n";
import { useSheetTopInset } from "@/lib/sheetTopInset";
import type { CardAction } from "./ProductCard";

interface Props {
  /** Null when closed. The product's title, for the sheet's heading. */
  subject: string | null;
  actions: CardAction[];
  onClose: () => void;
}

export default function CardActionSheet({ subject, actions, onClose }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();
  const topInset = useSheetTopInset();

  return (
    <Modal
      visible={subject !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      {/* Tapping away closes it. A sheet with only a button to dismiss it is
          a sheet people tap around for a while first. */}
      <Pressable style={[styles.backdrop, { paddingTop: topInset }]} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          {subject && (
            <Text style={styles.subject} numberOfLines={2}>
              {subject}
            </Text>
          )}

          {actions.map((action) => {
            const on = Boolean(action.active);
            return (
              <Pressable
                key={action.key}
                disabled={action.busy}
                onPress={() => {
                  // Closed first, so the sheet is gone by the time whatever
                  // this does navigates or opens a sheet of its own.
                  onClose();
                  action.onPress();
                }}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                accessibilityRole="button"
              >
                <Ionicons
                  name={on ? (action.activeIcon ?? action.icon) : action.icon}
                  size={19}
                  color={on || action.tone === "accent" ? colors.accent : colors.textSecondary}
                />
                <Text style={[styles.label, on && styles.labelActive]}>
                  {on ? (action.activeLabel ?? action.label) : action.label}
                </Text>
              </Pressable>
            );
          })}

          <Pressable onPress={onClose} style={styles.cancel} accessibilityRole="button">
            <Text style={styles.cancelText}>{t("common.cancel")}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.6)",
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      borderTopWidth: 1,
      borderColor: colors.surfaceBorder,
      paddingTop: spacing.md,
      paddingBottom: spacing.xl,
      paddingHorizontal: spacing.md,
      gap: 2,
    },
    subject: {
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
      marginBottom: spacing.sm,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: 14,
      paddingHorizontal: spacing.xs,
      borderRadius: radius.sm,
    },
    rowPressed: { backgroundColor: colors.surfaceRaised },
    label: {
      color: colors.textPrimary,
      fontSize: type.body.fontSize,
      fontWeight: "600",
    },
    labelActive: { color: colors.accent },
    cancel: { alignItems: "center", paddingVertical: 14, marginTop: spacing.xs },
    cancelText: { color: colors.textTertiary, fontSize: type.body.fontSize, fontWeight: "700" },
  });
