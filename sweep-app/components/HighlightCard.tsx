// components/HighlightCard.tsx
//
// One "top pick" from a compiled search — cheapest, best reviewed, or biggest
// drop. Sits above the per-store columns to answer the question most people
// actually came with, instead of making them scan twenty rows.

import { Ionicons } from "@expo/vector-icons";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { useTranslate } from "@/lib/i18n";
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
  starred,
  onToggleStar,
  onDetails,
}: {
  highlight: Highlight;
  onPress: () => void;
  starred?: boolean;
  onToggleStar?: () => void;
  /** Opens the lookup page for this product. */
  onDetails?: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();
  const { product, label, reason, kind, confidence } = highlight;

  // An accent badge and a falling-price arrow both read as "good news". When
  // the server can't vouch for the discount, this shouldn't celebrate it — so
  // the badge goes amber and the arrow becomes a question mark. Undefined
  // confidence means an older server that never sends it: render as before.
  const doubtful = confidence === "unverified";
  const icon: IoniconName = doubtful ? "help-circle" : ICONS[kind];
  const badgeColor = doubtful ? colors.warning : colors.accent;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={onPress}
    >
      <View style={styles.badgeRow}>
        <Ionicons name={icon} size={13} color={badgeColor} />
        <Text style={[styles.badge, { color: badgeColor }]}>
          {label.toUpperCase()}
        </Text>
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
          style={[styles.storeDot, { backgroundColor: retailerColor(colors, product.retailer) }]}
        />
        <Text style={styles.store}>{retailerLabel(product.retailer)}</Text>
      </View>

      {/*
        A top pick is the result most people act on, so the actions they'd
        otherwise scroll down and hunt for in the store column below are here.

        Details rather than List, because they are answers to different
        questions. Saving to a list is for later; a top pick is the thing
        someone is deciding about right now, and the next thing they want is
        the ratings, the real reviews and the price history — not another
        place to file it away.
      */}
      {(onToggleStar || onDetails) && (
        <View style={styles.actions}>
          {onToggleStar && (
            <Pressable
              onPress={onToggleStar}
              hitSlop={6}
              style={({ pressed }) => [
                styles.button,
                styles.compare,
                starred && styles.compareOn,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons
                name={starred ? "star" : "star-outline"}
                size={12}
                color={starred ? colors.background : colors.textSecondary}
              />
              <Text style={[styles.buttonLabel, starred && styles.buttonLabelOn]}>
                {starred ? t("card.added") : t("card.compare")}
              </Text>
            </Pressable>
          )}
          {onDetails && (
            <Pressable
              onPress={onDetails}
              hitSlop={6}
              style={({ pressed }) => [
                styles.button,
                styles.details,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
            >
              <Ionicons name="reader-outline" size={13} color={colors.accent} />
              <Text style={[styles.buttonLabel, styles.detailsLabel]}>
                {t("search.details")}
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </Pressable>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
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
    actions: { flexDirection: "row", gap: 5, marginTop: spacing.xs },
    button: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 3,
      paddingHorizontal: 7,
      paddingVertical: 6,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surfaceRaised,
    },
    // Compare takes the slack so the pair fills the card's width evenly.
    compare: { flex: 1 },
    compareOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    // Tinted rather than filled: it sits next to Compare, and two solid
    // buttons on one card is two things shouting at each other.
    details: { flex: 1, borderColor: colors.accent },
    detailsLabel: { color: colors.accent },
    buttonLabel: {
      color: colors.textSecondary,
      fontSize: type.caption.fontSize,
      fontWeight: "800",
    },
    buttonLabelOn: { color: colors.background },
  });
