// components/StorePicker.tsx
//
// Choosing which stores a search asks.
//
// Not about limiting anyone — it's about relevance and speed. Someone hunting
// a graphics card has no use for Etsy in their results, and a search that skips
// three stores comes back sooner. The default stays "all", because the reason
// to open this app is not knowing where something is cheapest.
//
// Stores that are currently unavailable are shown and disabled rather than
// hidden. A store quietly vanishing from the list looks like we dropped it;
// showing it greyed out with the rest says what's actually going on.

import { Ionicons } from "@expo/vector-icons";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { retailerColor, retailerLabel, type Retailer } from "@/lib/format";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { useTranslate } from "@/lib/i18n";
import { isOffered } from "@/lib/liveStores";

export interface StoreOption {
  retailer: Retailer;
  available: boolean;
  /**
   * False when the store is switched off server-side.
   *
   * Optional: an older server doesn't send it, and absent must mean "no
   * opinion" rather than "off", or the picker empties against one.
   */
  enabled?: boolean;
}

export default function StorePicker({
  visible,
  stores,
  selected,
  onChange,
  onClose,
}: {
  visible: boolean;
  stores: StoreOption[];
  /** Empty means every store — the same thing, but it survives the list changing. */
  selected: Retailer[];
  onChange: (next: Retailer[]) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();

  if (!visible) return null;

  // Stores we've switched off aren't choices — listing them greyed out as
  // "Unavailable" made the picker look like half of Sweep was broken, when in
  // fact they were never on offer. A store that IS on and currently failing
  // still appears, greyed, because that one is genuinely temporary and worth
  // explaining.
  const offered = stores.filter(isOffered);
  const usable = offered.filter((store) => store.available);
  const allOn = selected.length === 0;

  function toggle(retailer: Retailer) {
    // From "all stores", tapping one means "just this one" — which is what
    // anyone tapping a single store in a list is asking for. Treating the
    // all-state as a literal list to subtract from instead selected every
    // *other* store, so tapping Amazon left you searching eBay.
    if (allOn) {
      onChange([retailer]);
      return;
    }

    const next = selected.includes(retailer)
      ? selected.filter((r) => r !== retailer)
      : [...selected, retailer];

    // Deselecting the last one, or ticking every one, both mean "all" — and an
    // empty search is never what someone meant.
    onChange(next.length === 0 || next.length === usable.length ? [] : next);
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.dismissArea} onPress={onClose} />
        <View style={styles.sheet}>
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.heading}>{t("search.stores")}</Text>
            <Text style={styles.body}>{t("search.storesHelp")}</Text>

            <Pressable
              onPress={() => onChange([])}
              style={({ pressed }) => [
                styles.row,
                allOn && styles.rowOn,
                pressed && styles.pressed,
              ]}
            >
              <View style={[styles.dot, { backgroundColor: colors.accent }]} />
              <Text style={[styles.label, allOn && styles.labelOn]}>
                {t("search.allStores")}
              </Text>
              {allOn && <Ionicons name="checkmark" size={17} color={colors.accent} />}
            </Pressable>

            {offered.map((store) => {
              const on = !allOn && selected.includes(store.retailer);
              return (
                <Pressable
                  key={store.retailer}
                  onPress={() => store.available && toggle(store.retailer)}
                  disabled={!store.available}
                  style={({ pressed }) => [
                    styles.row,
                    on && styles.rowOn,
                    !store.available && styles.rowOff,
                    pressed && store.available && styles.pressed,
                  ]}
                >
                  <View
                    style={[
                      styles.dot,
                      { backgroundColor: retailerColor(colors, store.retailer) },
                    ]}
                  />
                  <Text style={[styles.label, on && styles.labelOn]}>
                    {retailerLabel(store.retailer)}
                  </Text>
                  {!store.available && (
                    <Text style={styles.unavailable}>{t("profile.unavailable")}</Text>
                  )}
                  {on && <Ionicons name="checkmark" size={17} color={colors.accent} />}
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.actions}>
            <Button label={t("whyLimited.gotIt")} onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: colors.scrim, justifyContent: "flex-end" },
    dismissArea: { flex: 1 },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      borderTopWidth: 1,
      borderColor: colors.surfaceBorder,
      maxHeight: "80%",
    },
    content: { padding: spacing.md, gap: 2 },
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
    rowOff: { opacity: 0.45 },
    pressed: { opacity: 0.7 },
    dot: { width: 9, height: 9, borderRadius: radius.pill },
    label: {
      flex: 1,
      color: colors.textPrimary,
      fontSize: type.body.fontSize,
      fontWeight: "700",
    },
    labelOn: { color: colors.accent },
    unavailable: {
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
    },
    actions: {
      padding: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.surfaceBorder,
    },
  });
