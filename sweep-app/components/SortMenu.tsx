// components/SortMenu.tsx
//
// Picking a sort order.
//
// A menu rather than a row of chips, for the same reason ResultsMenu is one:
// five options plus a label needs more width than a phone has, and a
// full-width strip for a sort order reads as more important than the list
// under it.
//
// Each option carries a line saying what it means. "Biggest drop" and "Best
// deal" sound like the same thing and are not — one is movement since you
// started watching, the other is discount off list right now — and a list of
// bare labels gives no way to tell.

import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { useTranslate } from "@/lib/i18n";
import { useSheetTopInset } from "@/lib/sheetTopInset";

export interface SortOption<K extends string> {
  key: K;
  label: string;
  hint: string;
}

interface Props<K extends string> {
  visible: boolean;
  title: string;
  options: SortOption<K>[];
  value: K;
  onPick: (key: K) => void;
  onClose: () => void;
}

export default function SortMenu<K extends string>({
  visible,
  title,
  options,
  value,
  onPick,
  onClose,
}: Props<K>) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();
  const topInset = useSheetTopInset();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { paddingTop: topInset }]} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>{title}</Text>

          {options.map((option) => {
            const picked = option.key === value;
            return (
              <Pressable
                key={option.key}
                onPress={() => {
                  onPick(option.key);
                  onClose();
                }}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                accessibilityRole="button"
                accessibilityState={{ selected: picked }}
              >
                <View style={styles.rowText}>
                  <Text style={[styles.label, picked && styles.labelPicked]}>
                    {option.label}
                  </Text>
                  <Text style={styles.hint}>{option.hint}</Text>
                </View>
                {picked && <Ionicons name="checkmark" size={19} color={colors.accent} />}
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
    },
    title: {
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.6,
      marginBottom: spacing.sm,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: 12,
      paddingHorizontal: spacing.xs,
      borderRadius: radius.sm,
    },
    rowPressed: { backgroundColor: colors.surfaceRaised },
    rowText: { flex: 1, gap: 2 },
    label: {
      color: colors.textPrimary,
      fontSize: type.body.fontSize,
      fontWeight: "700",
    },
    labelPicked: { color: colors.accent },
    hint: { color: colors.textTertiary, fontSize: type.caption.fontSize },
    cancel: { alignItems: "center", paddingVertical: 14, marginTop: spacing.xs },
    cancelText: {
      color: colors.textTertiary,
      fontSize: type.body.fontSize,
      fontWeight: "700",
    },
  });
