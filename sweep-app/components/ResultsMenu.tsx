// components/ResultsMenu.tsx
//
// Choosing how many results each store returns.
//
// A menu rather than a row of chips. Ultimate can pick between six values, and
// six chips plus a label needs more width than a phone has next to "3 searches
// left today" — so it wanted its own strip, and a full-width strip for a minor
// setting read as more important than the search box under it.
//
// Fewer results is a real preference, not a lesser one: a compiled search fans
// out to every store, so a smaller number comes back faster. The menu says so,
// because a list of bare numbers gives no reason to pick anything but the max.

import { Ionicons } from "@expo/vector-icons";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { useTranslate } from "@/lib/i18n";

interface Props {
  visible: boolean;
  range: { min: number; max: number; default: number } | null;
  value: number | null;
  onPick: (count: number) => void;
  onClose: () => void;
}

export default function ResultsMenu({ visible, range, value, onPick, onClose }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();
  if (!visible || !range) return null;

  const options = Array.from(
    { length: range.max - range.min + 1 },
    (_, i) => range.min + i,
  );
  const selected = value ?? range.default;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.heading}>{t("search.resultsPerStore")}</Text>
          <Text style={styles.body}>{t("search.resultsHelp")}</Text>

          {options.map((count) => {
            const on = count === selected;
            return (
              <Pressable
                key={count}
                onPress={() => onPick(count)}
                style={({ pressed }) => [
                  styles.row,
                  on && styles.rowOn,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.count, on && styles.countOn]}>{count}</Text>
                <Text style={styles.note}>
                  {count === range.min
                    ? t("search.fastest")
                    : count === range.max
                      ? t("search.thorough")
                      : ""}
                </Text>
                {on && (
                  <Ionicons name="checkmark" size={17} color={colors.accent} />
                )}
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: colors.scrim,
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.lg,
    },
    card: {
      width: "100%",
      maxWidth: 320,
      backgroundColor: colors.background,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      padding: spacing.md,
      gap: 4,
    },
    heading: {
      color: colors.textPrimary,
      fontSize: type.heading.fontSize,
      fontWeight: "800",
    },
    body: {
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
      lineHeight: 18,
      marginBottom: spacing.sm,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: 11,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: "transparent",
    },
    rowOn: { borderColor: colors.accent, backgroundColor: colors.accentMuted },
    pressed: { opacity: 0.7 },
    count: {
      color: colors.textPrimary,
      fontSize: type.body.fontSize,
      fontWeight: "800",
      minWidth: 20,
    },
    countOn: { color: colors.accent },
    note: { flex: 1, color: colors.textTertiary, fontSize: type.caption.fontSize },
  });
