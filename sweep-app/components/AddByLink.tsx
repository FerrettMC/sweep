// components/AddByLink.tsx
//
// Paste a product link to start tracking it. This is the primary way to add
// something — it costs no search quota, and it's what you actually have in
// hand after hitting Share on a retailer's app.

import { useState } from "react";
import * as Clipboard from "expo-clipboard";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "@/components/ui";
import { colors, radius, spacing, type } from "@/constants/theme";
import { ApiError, type TrackedProduct, trackProduct } from "@/lib/api";

interface Props {
  onTracked: (tracked: TrackedProduct) => void;
  /** Hides the paste box once the user is at their plan's limit. */
  disabled?: boolean;
  disabledReason?: string;
}

export default function AddByLink({ onTracked, disabled, disabledReason }: Props) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPasteFromClipboard() {
    const text = await Clipboard.getStringAsync();
    if (text) {
      setLink(text.trim());
      setError(null);
    }
  }

  async function onAdd() {
    const value = link.trim();
    if (!value || busy) return;

    setBusy(true);
    setError(null);

    try {
      const { tracked } = await trackProduct({ url: value });
      setLink("");
      onTracked(tracked);
    } catch (err) {
      const apiError = err as ApiError;
      // The server distinguishes "not a link", "store we don't support", and
      // "couldn't read the page" — surfacing which one matters, because the
      // user's next action is different for each.
      setError(
        apiError.code === "SCRAPE_FAILED" || apiError.code === "RETAILER_BLOCKED"
          ? `${apiError.message} (${apiError.body?.retailer ?? "store"})`
          : apiError.message,
      );
    } finally {
      setBusy(false);
    }
  }

  if (disabled) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.limitText}>
          {disabledReason ?? "You've reached your tracking limit."}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          placeholder="Paste a product link…"
          placeholderTextColor={colors.textTertiary}
          value={link}
          onChangeText={(text) => {
            setLink(text);
            if (error) setError(null);
          }}
          onSubmitEditing={onAdd}
          returnKeyType="done"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          multiline={false}
        />
        <Button label="Track" onPress={onAdd} busy={busy} disabled={!link.trim()} compact />
      </View>

      <View style={styles.metaRow}>
        <Pressable onPress={onPasteFromClipboard} hitSlop={8}>
          <Text style={styles.pasteLink}>Paste from clipboard</Text>
        </Pressable>
        <Text style={styles.hint}>Amazon · Walmart · Best Buy · Target · eBay</Text>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    gap: spacing.xs,
  },
  row: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    color: colors.textPrimary,
    fontSize: type.body.fontSize,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  pasteLink: {
    color: colors.accent,
    fontSize: type.caption.fontSize,
    fontWeight: "700",
  },
  hint: { color: colors.textTertiary, fontSize: type.caption.fontSize },
  limitText: {
    color: colors.warning,
    fontSize: type.label.fontSize,
    textAlign: "center",
    paddingVertical: spacing.sm,
  },
  error: {
    color: colors.danger,
    fontSize: type.caption.fontSize,
    lineHeight: 15,
  },
});
