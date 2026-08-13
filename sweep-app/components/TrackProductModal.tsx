// components/TrackProductModal.tsx
//
// Confirm-before-track. A pasted link is scraped first and shown here, so the
// user can check it's the right item — and pick when it gets checked — before
// spending one of their tracking slots on it.

import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button } from "@/components/ui";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import type { ProductPreview } from "@/lib/api";
import {
  formatPrice,
  formatRating,
  percentOff,
  retailerColor,
  retailerLabel,
} from "@/lib/format";

interface Props {
  preview: ProductPreview | null;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function TrackProductModal({
  preview,
  busy,
  error,
  onCancel,
  onConfirm,
}: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  if (!preview) return null;

  const { product, limits, alreadyTracking } = preview;
  const discount = percentOff(product.price, product.listPrice);
  const ratingText = formatRating(product.rating, product.ratingCount);

  const canConfirm = limits.canTrack && !busy;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />

          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.heading}>
              {alreadyTracking ? "Already tracking this" : "Track this product?"}
            </Text>

            <View style={styles.productRow}>
              {product.imageUrl ? (
                <Image
                  source={{ uri: product.imageUrl }}
                  style={styles.image}
                  resizeMode="contain"
                />
              ) : (
                <View style={[styles.image, styles.imageEmpty]} />
              )}

              <View style={styles.productInfo}>
                <View style={styles.retailerRow}>
                  <View
                    style={[
                      styles.retailerDot,
                      { backgroundColor: retailerColor(colors, product.retailer) },
                    ]}
                  />
                  <Text style={styles.retailer}>{retailerLabel(product.retailer)}</Text>
                  {ratingText && <Text style={styles.rating}>{ratingText}</Text>}
                </View>

                <Text style={styles.title} numberOfLines={3}>
                  {product.title}
                </Text>

                <View style={styles.priceRow}>
                  <Text style={styles.price}>{formatPrice(product.price)}</Text>
                  {product.listPrice !== null && discount !== null && (
                    <>
                      <Text style={styles.listPrice}>{formatPrice(product.listPrice)}</Text>
                      <View style={styles.discountPill}>
                        <Text style={styles.discountText}>{discount}% off</Text>
                      </View>
                    </>
                  )}
                </View>
              </View>
            </View>

            {/* No time picking. It was more configuration than value — people
                want to know it's watched, not to schedule it. */}
            <View style={styles.scheduleNote}>
              <Text style={styles.scheduleText}>
                {limits.fixedCheckTimes
                  ? `Checked up to ${limits.checkTimesPerDay}× a day`
                  : limits.checkIntervalMinutes >= 60
                    ? `Checked up to every ${limits.checkIntervalMinutes / 60} hours`
                    : `Checked up to every ${limits.checkIntervalMinutes} minutes`}
                , more often while the price is moving. You'll get an alert as
                soon as it drops.
              </Text>
            </View>

            <Text style={styles.slots}>
              {limits.used} of {limits.maxTrackedProducts} tracking slots used
            </Text>

            {!limits.canTrack && (
              <Text style={styles.blocked}>
                You've filled every slot on your plan. Remove something you're
                tracking to make room.
              </Text>
            )}

            {error && <Text style={styles.error}>{error}</Text>}
          </ScrollView>

          <View style={styles.actions}>
            <View style={styles.actionSlot}>
              <Button
                label="Cancel"
                onPress={onCancel}
                variant="secondary"
                disabled={busy}
              />
            </View>
            <View style={styles.actionSlot}>
              <Button
                label={alreadyTracking ? "Update times" : "Track it"}
                onPress={onConfirm}
                busy={busy}
                disabled={!canConfirm}
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
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      maxHeight: "88%",
      borderTopWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    grabber: {
      alignSelf: "center",
      width: 38,
      height: 4,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceBorder,
      marginTop: spacing.sm,
    },
    content: { padding: spacing.md, gap: spacing.md },
    heading: {
      color: colors.textPrimary,
      fontSize: type.title.fontSize,
      fontWeight: "800",
    },
    productRow: {
      flexDirection: "row",
      gap: spacing.md,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      padding: spacing.md,
    },
    image: {
      width: 84,
      height: 84,
      borderRadius: radius.sm,
      backgroundColor: "#FFFFFF",
    },
    imageEmpty: { backgroundColor: colors.surfaceRaised },
    productInfo: { flex: 1, gap: 3 },
    retailerRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    retailerDot: { width: 7, height: 7, borderRadius: radius.pill },
    retailer: {
      color: colors.textSecondary,
      fontSize: type.caption.fontSize,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    rating: { color: colors.textTertiary, fontSize: type.caption.fontSize },
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
    price: { color: colors.textPrimary, fontSize: 20, fontWeight: "900" },
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
    section: { gap: spacing.xs },
    sectionTitle: {
      color: colors.textPrimary,
      fontSize: type.heading.fontSize,
      fontWeight: "700",
    },
    sectionHint: {
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
      lineHeight: 18,
    },
    hourGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.xs,
      marginTop: spacing.xs,
    },
    hourChip: {
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: radius.sm,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      minWidth: 58,
      alignItems: "center",
    },
    hourChipSelected: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    hourChipPressed: { opacity: 0.7 },
    hourText: {
      color: colors.textSecondary,
      fontSize: type.caption.fontSize,
      fontWeight: "700",
    },
    hourTextSelected: { color: colors.background },
    selectedSummary: {
      color: colors.accent,
      fontSize: type.label.fontSize,
      fontWeight: "700",
      marginTop: spacing.xs,
    },
    scheduleNote: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      padding: spacing.md,
    },
    scheduleText: {
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
      lineHeight: 19,
    },
    slots: { color: colors.textTertiary, fontSize: type.label.fontSize },
    blocked: {
      color: colors.warning,
      fontSize: type.label.fontSize,
      lineHeight: 18,
    },
    error: { color: colors.danger, fontSize: type.label.fontSize },
    actions: {
      flexDirection: "row",
      gap: spacing.sm,
      padding: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.surfaceBorder,
    },
    actionSlot: { flex: 1 },
  });
