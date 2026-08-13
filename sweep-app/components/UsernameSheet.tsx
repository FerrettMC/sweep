// components/UsernameSheet.tsx
//
// Setting or changing the public username. Shared by the leaderboard and the
// profile so the rules, the error wording, and the "this is public" framing
// are stated once rather than drifting apart between two screens.

import { useState } from "react";
import { Modal, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "@/components/ui";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
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
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.heading}>
            {current ? "Change username" : "Choose a username"}
          </Text>
          <Text style={styles.body}>
            This is the name other people see on the leaderboard. Your email is
            never shown.
          </Text>

          <TextInput
            style={styles.input}
            placeholder="3–16 characters"
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
            Letters, numbers and underscores only.
          </Text>

          {error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.actions}>
            <View style={styles.action}>
              <Button label="Cancel" onPress={onClose} variant="secondary" disabled={saving} />
            </View>
            <View style={styles.action}>
              <Button
                label="Save"
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
      justifyContent: "center",
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
