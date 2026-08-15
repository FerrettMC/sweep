// components/ProductCard.tsx
//
// One product row, used by the tracking list and compiled search results. Same
// component in both places so a price can't render one way on one screen and
// differently on another.
//
// ---- on the layout ----
//
// Actions live in a toolbar under the content, not in a column beside it. They
// started as one button and grew to five (compare, list, sweep, bought, plus a
// per-screen primary), and a stack of five in a right-hand column squeezed the
// title and price — the parts people actually read — into whatever width was
// left. A full-width strip gives each control room and keeps the product
// itself the widest thing on the card.
//
// Actions are declared as data rather than passed as elements so every screen
// renders them identically. Handing in a <Button> was how the card ended up
// with two different visual languages for "things you can do here".

import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { useTranslate } from "@/lib/i18n";
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

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

export interface CardAction {
  key: string;
  icon: IoniconName;
  label: string;
  onPress: () => void;
  /** Tints the control — for the one action that's special on this screen. */
  tone?: "accent";
  /** Toggled-on state, e.g. Compare becoming Added. */
  active?: boolean;
  activeIcon?: IoniconName;
  activeLabel?: string;
  busy?: boolean;
}

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
  /** Toolbar under the card. Undefined entries are dropped, so a screen can
   *  write `sweepAvailable ? sweepAction : null` inline. */
  actions?: (CardAction | null | undefined | false)[];
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
  actions,
}: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();
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

  const visible = (actions ?? []).filter((a): a is CardAction => Boolean(a));

  return (
    <View style={styles.card}>
      <Pressable
        style={({ pressed }) => [styles.main, pressed && onPress && styles.pressed]}
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
              <Ionicons name="image-outline" size={20} color={colors.textTertiary} />
            </View>
          )}
        </View>

        <View style={styles.body}>
          <View style={styles.badgeRow}>
            <View
              style={[
                styles.retailerDot,
                { backgroundColor: retailerColor(colors, retailer) },
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
              {price === null ? t("card.noPrice") : formatPrice(price)}
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

        {onPress && (
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        )}
      </Pressable>

      {visible.length > 0 && (
        <View style={styles.toolbar}>
          {visible.map((item) => {
            const on = Boolean(item.active);
            return (
              <Pressable
                key={item.key}
                onPress={item.onPress}
                disabled={item.busy}
                style={({ pressed }) => [
                  styles.tool,
                  pressed && styles.toolPressed,
                  item.busy && styles.toolBusy,
                ]}
              >
                <Ionicons
                  name={on ? (item.activeIcon ?? item.icon) : item.icon}
                  size={17}
                  color={
                    on || item.tone === "accent" ? colors.accent : colors.textSecondary
                  }
                />
                <Text
                  style={[
                    styles.toolLabel,
                    (on || item.tone === "accent") && styles.toolLabelAccent,
                  ]}
                  numberOfLines={1}
                >
                  {on ? (item.activeLabel ?? item.label) : item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      overflow: "hidden",
    },
    main: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      padding: spacing.md,
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

    toolbar: {
      flexDirection: "row",
      borderTopWidth: 1,
      borderTopColor: colors.surfaceBorder,
      backgroundColor: colors.background,
    },
    // Icon over label: at four across on a narrow phone, side-by-side runs out
    // of width and truncates the labels that make the icons legible.
    tool: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 3,
      paddingVertical: 9,
      paddingHorizontal: 2,
    },
    toolPressed: { backgroundColor: colors.surfaceRaised },
    toolBusy: { opacity: 0.4 },
    toolLabel: {
      color: colors.textSecondary,
      fontSize: type.caption.fontSize,
      fontWeight: "700",
    },
    toolLabelAccent: { color: colors.accent },
  });
