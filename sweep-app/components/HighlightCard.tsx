// components/HighlightCard.tsx
//
// One "top pick" from a compiled search — cheapest, best reviewed, or biggest
// drop. Sits above the per-store columns to answer the question most people
// actually came with, instead of making them scan twenty rows.

import { Ionicons } from "@expo/vector-icons";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, type } from "@/constants/theme";
import type { Highlight } from "@/lib/api";
import { formatPrice, retailerColor, retailerLabel } from "@/lib/format";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

const ICONS: Record<Highlight["kind"], IoniconName> = {
  cheapest: "pricetag",
  best_rated: "star",
  biggest_discount: "trending-down",
};

export default function HighlightCard({
  highlight,
  onPress,
}: {
  highlight: Highlight;
  onPress: () => void;
}) {
  const { product, label, reason, kind } = highlight;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={onPress}
    >
      <View style={styles.badgeRow}>
        <Ionicons name={ICONS[kind]} size={13} color={colors.accent} />
        <Text style={styles.badge}>{label.toUpperCase()}</Text>
      </View>

      {product.imageUrl ? (
        <Image source={{ uri: product.imageUrl }} style={styles.image} resizeMode="contain" />
      ) : (
        <View style={[styles.image, styles.imageEmpty]} />
      )}

      <Text style={styles.title} numberOfLines={2}>
        {product.title}
      </Text>

      <Text style={styles.price}>{formatPrice(product.price)}</Text>
      <Text style={styles.reason} numberOfLines={2}>
        {reason}
      </Text>

      <View style={styles.storeRow}>
        <View
          style={[styles.storeDot, { backgroundColor: retailerColor(product.retailer) }]}
        />
        <Text style={styles.store}>{retailerLabel(product.retailer)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 176,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accentMuted,
    padding: spacing.sm,
    gap: 4,
  },
  pressed: { opacity: 0.75 },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  badge: {
    color: colors.accent,
    fontSize: type.caption.fontSize,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  image: {
    width: "100%",
    height: 88,
    borderRadius: radius.sm,
    backgroundColor: "#FFFFFF",
    marginVertical: 2,
  },
  imageEmpty: { backgroundColor: colors.surfaceRaised },
  title: {
    color: colors.textPrimary,
    fontSize: type.label.fontSize,
    fontWeight: "600",
    lineHeight: 17,
  },
  price: { color: colors.textPrimary, fontSize: 19, fontWeight: "900" },
  reason: {
    color: colors.textSecondary,
    fontSize: type.caption.fontSize,
    lineHeight: 14,
  },
  storeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 2,
  },
  storeDot: { width: 7, height: 7, borderRadius: radius.pill },
  store: { color: colors.textTertiary, fontSize: type.caption.fontSize },
});
