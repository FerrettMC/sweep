// components/ProductCard.tsx
//
// One product row, used by both the tracking list and compiled search results.
// Same component in both places so a price can't render one way on one screen
// and differently on another.

import { colors, radius, spacing, type } from "@/constants/theme";
import {
  formatPrice,
  formatRating,
  formatRelativeTime,
  formatSellerRating,
  percentOff,
  retailerColor,
  retailerLabel,
} from "@/lib/format";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

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
  /** Rendered under the price — e.g. "Down $30 since you started". */
  note?: string | null;
  /** Colours the note. Movement isn't always good news. */
  noteTone?: "good" | "bad" | "neutral";
  onPress?: () => void;
  /** Right-hand slot: a track button in search, a chevron in the list. */
  action?: React.ReactNode;
  /**
   * Optional star, for pulling a result into the compare tray. Omitted on
   * screens where comparing makes no sense (the tracking list).
   */
  starred?: boolean;
  onToggleStar?: () => void;
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
  noteTone = "good",
  onPress,
  action,
  starred,
  onToggleStar,
}: Props) {
  // A failed image should fall back to the placeholder, not leave a blank white
  // square that's indistinguishable from a product photo on a white background.
  const [imageFailed, setImageFailed] = useState(false);

  const discount = percentOff(price, listPrice);
  // Prefer a real product rating; fall back to seller feedback where that's
  // all the retailer publishes.
  const ratingText = formatRating(rating ?? null, ratingCount ?? null);
  const sellerText = ratingText
    ? null
    : formatSellerRating(sellerRating ?? null, sellerRatingCount ?? null);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        pressed && onPress && styles.pressed,
      ]}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={styles.thumbWrap}>
        {imageUrl && !imageFailed ? (
          <Image
            source={{ uri: imageUrl }}
            style={styles.thumb}
            resizeMode="contain"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty]}>
            <Ionicons
              name="image-outline"
              size={20}
              color={colors.textTertiary}
            />
          </View>
        )}
      </View>

      <View style={styles.body}>
        <View style={styles.badgeRow}>
          <View
            style={[
              styles.retailerDot,
              { backgroundColor: retailerColor(retailer) },
            ]}
          />
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
                <Text style={styles.discountText}>{discount}% off list</Text>
              </View>
            </>
          )}
        </View>

        {note && (
          <Text
            style={[
              styles.note,
              noteTone === "bad" && styles.noteBad,
              noteTone === "neutral" && styles.noteNeutral,
            ]}
          >
            {note}
          </Text>
        )}
        {lastCheckedAt !== undefined && lastCheckedAt !== null && (
          <Text style={styles.checked}>
            Checked {formatRelativeTime(lastCheckedAt)}
          </Text>
        )}
      </View>

      {(action || onToggleStar) && (
        <View style={styles.action}>
          {/*
            A bare star icon gave no clue what it did. Labelling it costs a
            little width and removes the guesswork entirely.
          */}
          {onToggleStar && (
            <Pressable
              onPress={onToggleStar}
              hitSlop={6}
              style={({ pressed }) => [
                styles.compareToggle,
                starred && styles.compareToggleOn,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons
                name={starred ? "star" : "star-outline"}
                size={13}
                color={starred ? colors.background : colors.textSecondary}
              />
              <Text
                style={[styles.compareLabel, starred && styles.compareLabelOn]}
              >
                {starred ? "Added" : "Compare"}
              </Text>
            </Pressable>
          )}
          {action}
        </View>
      )}
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
  note: {
    color: colors.success,
    fontSize: type.caption.fontSize,
    fontWeight: "700",
  },
  noteBad: { color: colors.warning },
  noteNeutral: { color: colors.accent, fontWeight: "600" },
  checked: { color: colors.textTertiary, fontSize: type.caption.fontSize },
  action: { justifyContent: "center", alignItems: "stretch", gap: spacing.xs },
  compareToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    backgroundColor: colors.surfaceRaised,
  },
  compareToggleOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  compareLabel: {
    color: colors.textSecondary,
    fontSize: type.caption.fontSize,
    fontWeight: "800",
  },
  compareLabelOn: { color: colors.background },
});
