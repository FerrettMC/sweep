// components/LanguageMenu.tsx
//
// Picking the app language.
//
// Two pieces: a compact button that shows the current language, and the sheet
// it opens. They ship together because every place that offers this needs both,
// and the button's job — being findable without being loud — is easy to get
// wrong separately.
//
// Each language is named in itself ("Español", not "Spanish"). Someone who
// opened the app to a language they don't read has to be able to find theirs,
// and a list translated into the current UI language is exactly the list they
// can't read.

import { Ionicons } from "@expo/vector-icons";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { LANGUAGES, setLanguage, useLanguage, useTranslate } from "@/lib/i18n";
import type { Language } from "@/lib/i18n/translations";

/** The current language as a tappable pill. */
export function LanguageButton({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const language = useLanguage();
  const current = LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[0];

  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={current.label}
      style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
    >
      <Ionicons name="language-outline" size={15} color={colors.textSecondary} />
      <Text style={styles.pillText}>{current.label}</Text>
    </Pressable>
  );
}

export default function LanguageMenu({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();
  const language = useLanguage();

  if (!visible) return null;

  function pick(code: Language) {
    setLanguage(code);
    onClose();
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.heading}>{t("profile.language")}</Text>
          <Text style={styles.body}>{t("profile.languageHint")}</Text>

          {LANGUAGES.map((item) => {
            const on = item.code === language;
            return (
              <Pressable
                key={item.code}
                onPress={() => pick(item.code)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={({ pressed }) => [
                  styles.row,
                  on && styles.rowOn,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.label, on && styles.labelOn]}>{item.label}</Text>
                {on && <Ionicons name="checkmark" size={17} color={colors.accent} />}
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
    pill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    pillText: {
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
      fontWeight: "700",
    },
    pressed: { opacity: 0.7 },

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
      paddingVertical: 12,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: "transparent",
    },
    rowOn: { borderColor: colors.accent, backgroundColor: colors.accentMuted },
    label: {
      flex: 1,
      color: colors.textPrimary,
      fontSize: type.body.fontSize,
      fontWeight: "700",
    },
    labelOn: { color: colors.accent },
  });
