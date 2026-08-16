// components/CompareTray.tsx
//
// The items you've starred, lined up by price so the comparison is the whole
// point rather than something you have to do in your head.
//
// Deliberately keyed by retailer + id and kept for the whole session, so you
// can search one thing, star a result, search something else, and still compare
// the two. That's the case a per-search selection would quietly break.

import { Ionicons } from "@expo/vector-icons";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { useTranslate } from "@/lib/i18n";
import type { SearchProduct } from "@/lib/api";
import { formatPrice, percentOff, retailerColor, retailerLabel } from "@/lib/format";

interface Props {
  items: SearchProduct[];
  onOpen: (product: SearchProduct) => void;
  onRemove: (product: SearchProduct) => void;
  onClear: () => void;
  /** Show the "what is this" hint when nothing has been added yet. */
  showHint?: boolean;
}

export default function CompareTray({ items, onOpen, onRemove, onClear, showHint }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();
  // Before the feature has ever been used, say what it does. A control nobody
  // understands may as well not exist.
  if (items.length === 0) {
    return showHint ? (
      <View style={styles.hint}>
        <Ionicons name="star-outline" size={15} color={colors.accent} />
        {/* One string rather than a sentence assembled around an inline
            <Text>: word order moves between languages, so a hardcoded
            "Tap X on any result" can't be translated without breaking. */}
        <Text style={styles.hintText}>{t("compare.hintFull")}</Text>
      </View>
    ) : null;
  }

  // Unpriced items can't be compared on price, so they sit at the bottom
  // rather than pretending to be the cheapest.
  const sorted = [...items].sort((a, b) => {
    if (a.price === null) return 1;
    if (b.price === null) return -1;
    return a.price - b.price;
  });

  const cheapest = sorted.find((p) => p.price !== null)?.price ?? null;
  const dearest = [...sorted].reverse().find((p) => p.price !== null)?.price ?? null;
  const spread = cheapest !== null && dearest !== null ? dearest - cheapest : 0;

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>Comparing {items.length}</Text>
        <Pressable onPress={onClear} hitSlop={8}>
          <Text style={styles.clear}>{t("compare.clear")}</Text>
        </Pressable>
      </View>

      {spread > 0 ? (
        <Text style={styles.spread}>
          {formatPrice(spread)} between cheapest and priciest
        </Text>
      ) : (
        // One item on its own isn't a comparison — say what's missing rather
        // than showing a lone row that looks like a bug.
        items.length === 1 && (
          <Text style={styles.spreadMuted}>{t("compare.addAnother")}</Text>
        )
      )}

      <View style={styles.card}>
        {sorted.map((product, index) => {
          const isCheapest = product.price !== null && product.price === cheapest;
          const delta =
            product.price !== null && cheapest !== null ? product.price - cheapest : null;
          const off = percentOff(product.price, product.listPrice);

          return (
            <Pressable
              key={`${product.retailer}:${product.retailerId}`}
              onPress={() => onOpen(product)}
              style={({ pressed }) => [
                styles.row,
                index > 0 && styles.rowDivided,
                pressed && styles.pressed,
              ]}
            >
              {product.imageUrl ? (
                <Image
                  source={{ uri: product.imageUrl }}
                  style={styles.thumb}
                  resizeMode="contain"
                />
              ) : (
                <View style={[styles.thumb, styles.thumbEmpty]} />
              )}

              <View style={styles.info}>
                <View style={styles.storeRow}>
                  <View
                    style={[styles.dot, { backgroundColor: retailerColor(colors, product.retailer) }]}
                  />
                  <Text style={styles.store}>{retailerLabel(product.retailer)}</Text>
                  {off !== null && <Text style={styles.off}>{off}% off</Text>}
                </View>
                <Text style={styles.title} numberOfLines={2}>
                  {product.title}
                </Text>
              </View>

              <View style={styles.priceCol}>
                <Text style={[styles.price, isCheapest && styles.priceCheapest]}>
                  {formatPrice(product.price)}
                </Text>
                {isCheapest ? (
                  <Text style={styles.cheapestTag}>{t("compare.cheapest")}</Text>
                ) : delta !== null && delta > 0 ? (
                  <Text style={styles.delta}>+{formatPrice(delta)}</Text>
                ) : null}
              </View>

              <Pressable
                onPress={() => onRemove(product)}
                hitSlop={10}
                style={({ pressed }) => pressed && styles.pressed}
              >
                <Ionicons name="close" size={16} color={colors.textTertiary} />
              </Pressable>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    wrap: { gap: spacing.xs, marginTop: spacing.sm },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    heading: {
      color: colors.textPrimary,
      fontSize: type.heading.fontSize,
      fontWeight: "800",
    },
    clear: {
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
      fontWeight: "700",
    },
    spread: { color: colors.accent, fontSize: type.caption.fontSize, fontWeight: "700" },
    spreadMuted: {
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
      fontWeight: "600",
    },
    hint: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderStyle: "dashed",
      padding: spacing.sm,
      marginTop: spacing.sm,
    },
    hintText: {
      flex: 1,
      color: colors.textSecondary,
      fontSize: type.caption.fontSize,
      lineHeight: 16,
    },
    hintStrong: { color: colors.textPrimary, fontWeight: "800" },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.accentMuted,
      marginTop: 2,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      padding: spacing.sm,
    },
    rowDivided: { borderTopWidth: 1, borderTopColor: colors.surfaceBorder },
    pressed: { opacity: 0.7 },
    thumb: {
      width: 40,
      height: 40,
      borderRadius: radius.sm,
      backgroundColor: "#FFFFFF",
    },
    thumbEmpty: { backgroundColor: colors.surfaceRaised },
    info: { flex: 1, gap: 1 },
    storeRow: { flexDirection: "row", alignItems: "center", gap: 5 },
    dot: { width: 6, height: 6, borderRadius: radius.pill },
    store: {
      color: colors.textSecondary,
      fontSize: type.caption.fontSize,
      fontWeight: "700",
    },
    off: { color: colors.success, fontSize: type.caption.fontSize, fontWeight: "700" },
    title: { color: colors.textPrimary, fontSize: type.label.fontSize, fontWeight: "600" },
    priceCol: { alignItems: "flex-end", gap: 1 },
    price: { color: colors.textPrimary, fontSize: type.body.fontSize, fontWeight: "800" },
    priceCheapest: { color: colors.success },
    cheapestTag: {
      color: colors.success,
      fontSize: type.caption.fontSize,
      fontWeight: "800",
    },
    delta: { color: colors.textTertiary, fontSize: type.caption.fontSize },
  });
