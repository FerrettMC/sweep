// components/AddByLink.tsx
//
// Paste a product link to start tracking it. This is the primary way to add
// something — it costs no search quota, and it's what you actually have in
// hand after hitting Share on a retailer's app.
//
// Pasting doesn't track immediately: it scrapes the product and shows a
// confirm sheet first, so the user can check it's the right item and choose
// when it gets checked before spending a tracking slot.

import { useEffect, useRef, useState } from "react";
import * as Clipboard from "expo-clipboard";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import TrackProductModal from "@/components/TrackProductModal";
import { Button } from "@/components/ui";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { useTranslate } from "@/lib/i18n";
import {
  ApiError,
  type ProductPreview,
  type TrackedProduct,
  previewProduct,
  trackProduct,
} from "@/lib/api";

interface Props {
  onTracked: (tracked: TrackedProduct) => void;
  /** Hides the paste box once the user is at their plan's limit. */
  disabled?: boolean;
  disabledReason?: string;
  /**
   * A link to look up as soon as this mounts, for arrivals from elsewhere —
   * "Track price" on the product lookup page sends one.
   *
   * Without this, that button navigated here and stopped: the field was empty
   * and the person had to find and paste the link they had just been looking
   * at, which is worse than not offering the button.
   */
  initialUrl?: string;
}

export default function AddByLink({
  onTracked,
  disabled,
  disabledReason,
  initialUrl,
}: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [preview, setPreview] = useState<ProductPreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  async function onPasteFromClipboard() {
    const text = await Clipboard.getStringAsync();
    if (text) {
      setLink(text.trim());
      setError(null);
    }
  }

  /**
   * Run the lookup for a link handed to us, once.
   *
   * Guarded on the url itself rather than a boolean so that arriving with a
   * different product later still works, while a re-render with the same one
   * doesn't scrape twice.
   */
  const handled = useRef<string | null>(null);
  useEffect(() => {
    const value = initialUrl?.trim();
    if (!value || disabled || handled.current === value) return;
    handled.current = value;
    setLink(value);
    void lookUp(value);
  }, [initialUrl, disabled]);

  /** Step 1 — scrape the link and show what we found. Nothing is tracked yet. */
  async function onLookUp() {
    await lookUp(link);
  }

  async function lookUp(raw: string) {
    const value = raw.trim();
    if (!value || busy) return;

    setBusy(true);
    setError(null);

    try {
      setPreview(await previewProduct(value));
    } catch (err) {
      const apiError = err as ApiError;
      // The server distinguishes "not a link", "store we don't support", and
      // "couldn't read the page" — which one matters, because the user's next
      // action is different for each.
      setError(apiError.message);
    } finally {
      setBusy(false);
    }
  }

  /** Step 2 — the user confirmed, so commit it. */
  async function onConfirm() {
    if (!preview) return;

    setConfirming(true);
    setModalError(null);

    try {
      const { tracked } = await trackProduct(
        {
          retailer: preview.product.retailer,
          retailerId: preview.product.retailerId,
        },
        // Still send the timezone: check times are no longer user-chosen, but
        // the defaults are still interpreted in the user's local time.
        { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      );
      setPreview(null);
      setLink("");
      onTracked(tracked);
    } catch (err) {
      setModalError((err as ApiError).message);
    } finally {
      setConfirming(false);
    }
  }

  if (disabled) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.limitText}>
          {disabledReason ?? t("addLink.limitReached")}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          placeholder={t("addLink.placeholder")}
          placeholderTextColor={colors.textTertiary}
          value={link}
          onChangeText={(text) => {
            setLink(text);
            if (error) setError(null);
          }}
          onSubmitEditing={onLookUp}
          returnKeyType="done"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          multiline={false}
        />
        <Button
          label={t("addLink.lookUp")}
          onPress={onLookUp}
          busy={busy}
          disabled={!link.trim()}
          compact
        />
      </View>

      <View style={styles.metaRow}>
        <Pressable onPress={onPasteFromClipboard} hitSlop={8}>
          <Text style={styles.pasteLink}>{t("addLink.pasteFromClipboard")}</Text>
        </Pressable>
        {/* Was the full store list, which ran to six names and collided with
            the paste link on a narrow screen. It was also drifting: the app's
            copy of storeListPhrase doesn't know which stores are switched off
            server-side, so it named ones that aren't live. A phrase says the
            true thing and can't go stale. */}
        <Text style={styles.hint} numberOfLines={1}>
          {t("addLink.anyStore")}
        </Text>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <TrackProductModal
        preview={preview}
        busy={confirming}
        error={modalError}
        onCancel={() => {
          setPreview(null);
          setModalError(null);
          // Forget that we handled the incoming link, so coming back from the
          // product page and tapping "Track price" on the SAME item works a
          // second time. Otherwise dismissing once would make the button
          // permanently do nothing for that product — the bug this whole
          // change exists to fix, in a subtler form.
          handled.current = null;
        }}
        onConfirm={onConfirm}
      />
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
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
      // Gap plus a shrinkable hint, so the two can never sit on top of each
      // other however long the translated string turns out to be.
      gap: spacing.sm,
    },
    pasteLink: {
      color: colors.accent,
      fontSize: type.caption.fontSize,
      fontWeight: "700",
    },
    hint: {
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
      // The paste link keeps its width; this yields.
      flexShrink: 1,
    },
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
