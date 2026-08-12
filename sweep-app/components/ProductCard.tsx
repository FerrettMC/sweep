// components/ProductCard.tsx
//
// One product row, used by both the tracking list and compiled search results.
// Same component in both places so a price can't render one way on one screen
// and differently on another.

import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, type } from "@/constants/theme";
import {
  formatPrice,
  formatRating,
  formatSellerRating,
  formatRelativeTime,
  percentOff,
  retailerColor,
  retailerLabel,
} from "@/lib/format";

interface Props {
  title: string;
  retailer: string;
  price: number | null;
  listPrice: number | null;
  imageUrl: string | null;
  rating?: number | null;
  ratingCount?: number | null;
  /** eBay only — seller feedback percentage, shown when no product rating exists. */
  sellerRating?: number | null;
  sellerRatingCount?: number | null;
  lastCheckedAt?: string | null;
  /** Rendered under the price — e.g. "12% below average". */
  note?: string | null;
  onPress?: () => void;
  /** Right-hand slot: a track button in search, a chevron in the list. */
  action?: React.ReactNode;
}

export default function ProductCard({
  title,
  retailer,
  price,
  listPrice,
  imageUrl,
  rating,
  ratingCount,
  sellerRating,
  sellerRatingCount,
  lastCheckedAt,
  note,
  onPress,
  action,
}: Props) {
  const discount = percentOff(price, listPrice);
  // Prefer a real product rating; fall back to seller feedback where that's
  // all the retailer publishes.
  const ratingText = formatRating(rating ?? null, ratingCount ?? null);
  const sellerText = ratingText
    ? null
    : formatSellerRating(sellerRating ?? null, sellerRatingCount ?? null);

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && onPress && styles.pressed]}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={styles.thumbWrap}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.thumb} resizeMode="contain" />
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty]}>
            <Text style={styles.thumbEmptyText}>?</Text>
          </View>
        )}
      </View>

      <View style={styles.body}>
        <View style={styles.badgeRow}>
          <View style={[styles.retailerDot, { backgroundColor: retailerColor(retailer) }]} />
          <Text style={styles.retailer}>{retailerLabel(retailer)}</Text>
          {ratingText && <Text style={styles.rating}>{ratingText}</Text>}
          {sellerText && <Text style={styles.sellerRating}>{sellerText}</Text>}
        </View>

        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>

        <View style={styles.priceRow}>
          <Text style={[styles.price, price === null && styles.priceMissing]}>
            {price === null ? "No price" : formatPrice(price)}
          </Text>
          {listPrice !== null && discount !== null && (
            <>
              <Text style={styles.listPrice}>{formatPrice(listPrice)}</Text>
              <View style={styles.discountPill}>
                <Text style={styles.discountText}>{discount}% off</Text>
              </View>
            </>
          )}
        </View>

        {note && <Text style={styles.note}>{note}</Text>}
        {lastCheckedAt !== undefined && lastCheckedAt !== null && (
          <Text style={styles.checked}>Checked {formatRelativeTime(lastCheckedAt)}</Text>
        )}
      </View>

      {action && <View style={styles.action}>{action}</View>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    padding: spacing.md,
    gap: spacing.md,
    alignItems: "center",
  },
  pressed: { opacity: 0.7 },
  thumbWrap: {
    width: 64,
    height: 64,
    borderRadius: radius.sm,
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
  },
  thumb: { width: "100%", height: "100%" },
  thumbEmpty: {
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  thumbEmptyText: { color: colors.textTertiary, fontSize: 22, fontWeight: "700" },
  body: { flex: 1, gap: 3 },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  retailerDot: { width: 7, height: 7, borderRadius: radius.pill },
  retailer: {
    color: colors.textSecondary,
    fontSize: type.caption.fontSize,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  rating: { color: colors.textTertiary, fontSize: type.caption.fontSize },
  // Visually distinct from a star rating, because it isn't one.
  sellerRating: {
    color: colors.textTertiary,
    fontSize: type.caption.fontSize,
    fontStyle: "italic",
  },
  title: {
    color: colors.textPrimary,
    fontSize: type.body.fontSize,
    fontWeight: "600",
    lineHeight: 19,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.xs,
    marginTop: 2,
    flexWrap: "wrap",
  },
  price: { color: colors.textPrimary, fontSize: 17, fontWeight: "800" },
  priceMissing: { color: colors.textTertiary, fontSize: type.body.fontSize },
  listPrice: {
    color: colors.textTertiary,
    fontSize: type.label.fontSize,
    textDecorationLine: "line-through",
  },
  discountPill: {
    backgroundColor: colors.accentMuted,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  discountText: {
    color: colors.accent,
    fontSize: type.caption.fontSize,
    fontWeight: "800",
  },
  note: { color: colors.success, fontSize: type.caption.fontSize, fontWeight: "700" },
  checked: { color: colors.textTertiary, fontSize: type.caption.fontSize },
  action: { justifyContent: "center" },
});
