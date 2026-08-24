// components/RedeemCode.tsx
//
// "Have a code?" — redeeming a promo code for time on a paid tier.
//
// Shared by Plans and Profile rather than written twice. Plans is where someone
// goes when they're thinking about paying, which is exactly the moment a code
// in their hand is worth spending; Profile is where they check what they
// already have. Both are the right place, and neither wants its own copy of
// the redemption rules.
//
// A grant is not a subscription and the copy here says so. Someone who already
// pays and redeems a code changes nothing today — the server stores the grant
// as a fallback for if their subscription ends, and says as much in `message`.

import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { useTranslate } from "@/lib/i18n";
import { redeemPromoCode } from "@/lib/api";

export default function RedeemCode({
  onRedeemed,
}: {
  /** Called after a successful redemption, so the caller can re-read the tier. */
  onRedeemed?: () => void | Promise<void>;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);

  async function onSubmit() {
    const entered = code.trim();
    if (!entered || busy) return;

    setBusy(true);
    setNote(null);
    try {
      const result = await redeemPromoCode(entered);
      if (result.ok) {
        setCode("");
        setNote({ text: result.message, bad: false });
        // The caller re-reads rather than being handed the new tier: what
        // matters is whatever the server now says, which may be higher than
        // what this particular code granted.
        await onRedeemed?.();
      } else {
        setNote({ text: result.message, bad: true });
      }
    } catch {
      setNote({ text: t("profile.codeOffline"), bad: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.label}>{t("profile.haveACode")}</Text>
      <Text style={styles.sub}>{t("profile.haveACodeBody")}</Text>
      <View style={styles.row}>
        <TextInput
          value={code}
          onChangeText={(text) => {
            setCode(text);
            setNote(null);
          }}
          placeholder={t("profile.codePlaceholder")}
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="characters"
          autoCorrect={false}
          editable={!busy}
          style={styles.input}
          onSubmitEditing={onSubmit}
          returnKeyType="go"
        />
        <Pressable
          onPress={onSubmit}
          disabled={busy || !code.trim()}
          style={[styles.button, (busy || !code.trim()) && styles.buttonDisabled]}
        >
          <Text style={styles.buttonText}>
            {busy ? t("profile.redeeming") : t("profile.redeem")}
          </Text>
        </Pressable>
      </View>
      {note && <Text style={[styles.note, note.bad && styles.noteBad]}>{note.text}</Text>}
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      padding: spacing.lg,
      marginBottom: spacing.md,
    },
    label: {
      color: colors.textPrimary,
      fontSize: type.label.fontSize,
      fontWeight: "700",
    },
    sub: {
      color: colors.textSecondary,
      fontSize: type.caption.fontSize,
      marginTop: spacing.xs,
      lineHeight: 18,
    },
    row: {
      flexDirection: "row",
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    input: {
      flex: 1,
      backgroundColor: colors.surfaceRaised,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      color: colors.textPrimary,
      fontSize: type.body.fontSize,
      // Codes are read off a screen and typed in; the extra tracking makes it
      // much easier to check a character against the source.
      letterSpacing: 1.5,
    },
    button: {
      backgroundColor: colors.accent,
      borderRadius: radius.md,
      paddingHorizontal: spacing.lg,
      justifyContent: "center",
    },
    buttonDisabled: { opacity: 0.5 },
    buttonText: {
      color: colors.background,
      fontWeight: "800",
      fontSize: type.label.fontSize,
    },
    note: {
      color: colors.success,
      fontSize: type.caption.fontSize,
      fontWeight: "600",
      marginTop: spacing.sm,
    },
    noteBad: { color: colors.danger },
  });
