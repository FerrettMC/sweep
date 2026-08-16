// components/UsernameSheet.tsx
//
// Setting or changing the public username. Shared by the leaderboard and the
// profile so the rules, the error wording, and the "this is public" framing
// are stated once rather than drifting apart between two screens.

import { useState } from "react";
import { Modal, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "@/components/ui";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { useTranslate } from "@/lib/i18n";
import { ApiError, setUsername } from "@/lib/api";

interface Props {
  visible: boolean;
  /** Current username, so changing one starts from what's already there. */
  current: string | null;
  onClose: () => void;
  onSaved: (username: string) => void;
}

export default function UsernameSheet({ visible, current, onClose, onSaved }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [seededFor, setSeededFor] = useState<string | null>(null);

  // Re-seed each time it opens, so cancelling doesn't leave a stale draft.
  const key = `${visible}:${current ?? ""}`;
  if (seededFor !== key) {
    setSeededFor(key);
    setDraft(current ?? "");
    setError(null);
  }

  const trimmed = draft.trim();
  const valid = /^[a-zA-Z0-9_]{3,16}$/.test(trimmed);

  async function onSave() {
    setSaving(true);
    setError(null);
    try {
      const { username } = await setUsername(trimmed);
      onSaved(username);
      onClose();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* Anchored to the top, not centred: the field autofocuses, so the
          keyboard is already up when this opens and a centred dialog puts Save
          and Cancel behind it. Same treatment as ConfirmDialog's input mode. */}
      <View style={[styles.backdrop, { paddingTop: insets.top + spacing.lg }]}>
        <View style={styles.sheet}>
          <Text style={styles.heading}>
            {current ? t("username.change") : t("username.choose")}
          </Text>
          <Text style={styles.body}>{t("username.body")}</Text>

          <TextInput
            style={styles.input}
            placeholder={t("username.placeholder")}
            placeholderTextColor={colors.textTertiary}
            value={draft}
            onChangeText={(text) => {
              setDraft(text);
              if (error) setError(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={16}
            autoFocus
          />

          {/* Say the rule up front rather than only after a rejection. */}
          <Text style={[styles.rule, trimmed.length > 0 && !valid && styles.ruleBad]}>
            {t("username.rule")}
          </Text>

          {error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.actions}>
            <View style={styles.action}>
              <Button label={t("common.cancel")} onPress={onClose} variant="secondary" disabled={saving} />
            </View>
            <View style={styles.action}>
              <Button
                label={t("common.save")}
                onPress={onSave}
                busy={saving}
                disabled={!valid || trimmed === current}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: colors.scrim,
      justifyContent: "flex-start",
      padding: spacing.lg,
    },
    sheet: {
      backgroundColor: colors.background,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    heading: {
      color: colors.textPrimary,
      fontSize: type.title.fontSize,
      fontWeight: "800",
    },
    body: {
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
      lineHeight: 18,
    },
    input: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: 12,
      color: colors.textPrimary,
      fontSize: type.body.fontSize,
      marginTop: spacing.xs,
    },
    rule: { color: colors.textTertiary, fontSize: type.caption.fontSize },
    ruleBad: { color: colors.warning },
    error: { color: colors.danger, fontSize: type.label.fontSize },
    actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
    action: { flex: 1 },
  });
