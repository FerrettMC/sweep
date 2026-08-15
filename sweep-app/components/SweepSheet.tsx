// components/SweepSheet.tsx
//
// The result of "Sweep this deal".
//
// Ordered by trustworthiness, not by flashiness. The verdict on whether the
// sale is real comes first because it's computed from our own recorded prices
// and can't be staged by a retailer — it's the one thing here we can state
// flatly. Cross-retailer matches come second and are hedged in proportion to
// how sure we are, because the cost of a wrong "cheaper elsewhere" is someone
// buying the wrong item.
//
// "Similar" results are visually separated from confident matches on purpose.
// Blurring the two is how a comparison feature loses people's trust.

import { Ionicons } from "@expo/vector-icons";
import {
  ActivityIndicator,
  Image,
  Linking,
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
import { useTranslate } from "@/lib/i18n";
import type { SaleVerdict, SweepAlternative, SweepResult } from "@/lib/api";
import { formatPrice } from "@/lib/format";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

const VERDICT: Record<SaleVerdict, { icon: IoniconName; tone: "good" | "bad" | "neutral" }> = {
  "genuine-low": { icon: "trending-down", tone: "good" },
  "good-price": { icon: "checkmark-circle", tone: "good" },
  "typical-price": { icon: "remove-circle", tone: "bad" },
  "above-usual": { icon: "trending-up", tone: "bad" },
  "no-history": { icon: "help-circle", tone: "neutral" },
};

interface Props {
  visible: boolean;
  busy: boolean;
  result: SweepResult | null;
  error: string | null;
  remaining: number | null;
  onClose: () => void;
}

export default function SweepSheet({
  visible,
  busy,
  result,
  error,
  remaining,
  onClose,
}: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();
  if (!visible) return null;

  const verdict = result ? VERDICT[result.sale.verdict] : null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />

          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.brandRow}>
              <Ionicons name="sparkles" size={15} color={colors.accent} />
              <Text style={styles.brand}>{t("sweep.brand")}</Text>
              {remaining !== null && (
                <Text style={styles.remaining}>
                  {remaining} left today
                </Text>
              )}
            </View>

            {busy && (
              <View style={styles.busy}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.busyText}>
                  Checking every other store and this item's price history…
                </Text>
                <Text style={styles.busySub}>{t("sweep.takesSeconds")}</Text>
              </View>
            )}

            {error && !busy && <Text style={styles.error}>{error}</Text>}

            {result && !busy && (
              <>
                <Text style={styles.headline}>{result.headline}</Text>

                {/* ---- 1. is the sale real? ---- */}
                <View
                  style={[
                    styles.verdictCard,
                    verdict?.tone === "good" && styles.verdictGood,
                    verdict?.tone === "bad" && styles.verdictBad,
                  ]}
                >
                  <View style={styles.verdictHead}>
                    <Ionicons
                      name={verdict!.icon}
                      size={17}
                      color={
                        verdict?.tone === "good"
                          ? colors.success
                          : verdict?.tone === "bad"
                            ? colors.warning
                            : colors.textSecondary
                      }
                    />
                    <Text style={styles.verdictTitle}>{result.sale.headline}</Text>
                  </View>
                  <Text style={styles.verdictDetail}>{result.sale.detail}</Text>

                  {/*
                    The comparison that makes the feature worth paying for: what
                    the store claims, next to what its own history shows.
                  */}
                  {result.sale.claimedPercentOff !== null &&
                    result.sale.realPercentBelowTypical !== null && (
                      <View style={styles.claimRow}>
                        <View style={styles.claim}>
                          <Text style={styles.claimLabel}>{t("sweep.storeClaimsLabel")}</Text>
                          <Text style={styles.claimValue}>
                            {result.sale.claimedPercentOff}% off
                          </Text>
                        </View>
                        <Ionicons name="arrow-forward" size={13} color={colors.textTertiary} />
                        <View style={styles.claim}>
                          <Text style={styles.claimLabel}>{t("sweep.actuallyLabel")}</Text>
                          <Text
                            style={[
                              styles.claimValue,
                              result.sale.realPercentBelowTypical > 0
                                ? styles.good
                                : styles.bad,
                            ]}
                          >
                            {result.sale.realPercentBelowTypical > 0
                              ? `${result.sale.realPercentBelowTypical}% below usual`
                              : "its normal price"}
                          </Text>
                        </View>
                      </View>
                    )}
                </View>

                {/* ---- 2. cheaper elsewhere ---- */}
                {result.cheaperElsewhere.length > 0 && (
                  <View style={styles.block}>
                    <Text style={styles.blockTitle}>{t("sweep.cheaperElsewhere")}</Text>
                    {result.cheaperElsewhere.map((alt) => (
                      <AlternativeRow key={alt.url} alt={alt} styles={styles} colors={colors} />
                    ))}
                  </View>
                )}

                {/* ---- 3. similar, explicitly hedged ---- */}
                {result.similar.length > 0 && (
                  <View style={styles.block}>
                    <Text style={styles.blockTitle}>{t("sweep.worthALook")}</Text>
                    <Text style={styles.blockNote}>
                      These cost less but we're not certain they're identical —
                      check the details before buying.
                    </Text>
                    {result.similar.map((alt) => (
                      <AlternativeRow key={alt.url} alt={alt} styles={styles} colors={colors} />
                    ))}
                  </View>
                )}

                {result.cheaperElsewhere.length === 0 && result.similar.length === 0 && (
                  <Text style={styles.none}>
                    Nothing cheaper found at{" "}
                    {result.unreachable.length > 0 ? "the stores we could reach" : "any other store"}.
                  </Text>
                )}

                {/* ---- 4. price context ---- */}
                {result.history.points > 0 && (
                  <View style={styles.block}>
                    <Text style={styles.blockTitle}>{t("sweep.itsHistory")}</Text>
                    <View style={styles.statRow}>
                      <Stat label={t("sweep.now")} value={formatPrice(result.product.price)} styles={styles} />
                      <Stat label={t("sweep.lowest")} value={formatPrice(result.history.low)} styles={styles} />
                      <Stat label={t("sweep.typical")} value={formatPrice(result.history.average)} styles={styles} />
                      <Stat label={t("sweep.checks")} value={String(result.history.points)} styles={styles} />
                    </View>
                  </View>
                )}

                {/*
                  Named explicitly: silence from a store would otherwise read as
                  "not sold there", which is a different and wrong conclusion.
                */}
                {result.unreachable.length > 0 && (
                  <Text style={styles.unreachable}>
                    Couldn't reach {result.unreachable.join(", ")} this time — there
                    may be cheaper options there.
                  </Text>
                )}
              </>
            )}
          </ScrollView>

          <View style={styles.actions}>
            <Button label={t("common.done")} onPress={onClose} variant="secondary" />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Stat({ label, value, styles }: { label: string; value: string; styles: any }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function AlternativeRow({
  alt,
  styles,
  colors,
}: {
  alt: SweepAlternative;
  styles: any;
  colors: Palette;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.alt, pressed && styles.pressed]}
      onPress={() => Linking.openURL(alt.url)}
    >
      {alt.imageUrl ? (
        <Image source={{ uri: alt.imageUrl }} style={styles.altImage} resizeMode="contain" />
      ) : (
        <View style={[styles.altImage, styles.altImageEmpty]} />
      )}
      <View style={styles.altBody}>
        <Text style={styles.altStore}>{alt.retailerLabel}</Text>
        <Text style={styles.altTitle} numberOfLines={2}>
          {alt.title}
        </Text>
        {alt.caveats.map((caveat) => (
          <Text key={caveat} style={styles.caveat}>
            {caveat}
          </Text>
        ))}
      </View>
      <View style={styles.altPrices}>
        <Text style={styles.altPrice}>{formatPrice(alt.price)}</Text>
        {alt.savings > 0 && (
          <Text style={styles.altSaving}>save {formatPrice(alt.savings)}</Text>
        )}
        <Ionicons name="open-outline" size={13} color={colors.textTertiary} />
      </View>
    </Pressable>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: colors.scrim, justifyContent: "flex-end" },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      maxHeight: "90%",
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
    content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.lg },
    brandRow: { flexDirection: "row", alignItems: "center", gap: 5 },
    brand: {
      flex: 1,
      color: colors.accent,
      fontSize: type.caption.fontSize,
      fontWeight: "900",
      letterSpacing: 0.8,
    },
    remaining: { color: colors.textTertiary, fontSize: type.caption.fontSize },

    busy: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xl },
    busyText: {
      color: colors.textSecondary,
      fontSize: type.body.fontSize,
      textAlign: "center",
    },
    busySub: { color: colors.textTertiary, fontSize: type.caption.fontSize },
    error: { color: colors.danger, fontSize: type.body.fontSize },

    headline: {
      color: colors.textPrimary,
      fontSize: type.heading.fontSize,
      fontWeight: "800",
      lineHeight: 24,
    },

    verdictCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      padding: spacing.md,
      gap: 6,
    },
    verdictGood: { borderColor: colors.success },
    verdictBad: { borderColor: colors.warning },
    verdictHead: { flexDirection: "row", alignItems: "center", gap: 6 },
    verdictTitle: {
      flex: 1,
      color: colors.textPrimary,
      fontSize: type.body.fontSize,
      fontWeight: "800",
    },
    verdictDetail: { color: colors.textSecondary, fontSize: type.label.fontSize, lineHeight: 18 },
    claimRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginTop: spacing.xs,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.surfaceBorder,
    },
    claim: { flex: 1, gap: 1 },
    claimLabel: {
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
      fontWeight: "900",
      letterSpacing: 0.5,
    },
    claimValue: { color: colors.textPrimary, fontSize: type.label.fontSize, fontWeight: "700" },
    good: { color: colors.success },
    bad: { color: colors.warning },

    block: { gap: spacing.sm },
    blockTitle: { color: colors.textPrimary, fontSize: type.body.fontSize, fontWeight: "800" },
    blockNote: { color: colors.textTertiary, fontSize: type.caption.fontSize, lineHeight: 15 },
    none: { color: colors.textSecondary, fontSize: type.label.fontSize },

    alt: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      padding: spacing.sm,
    },
    pressed: { opacity: 0.75 },
    altImage: { width: 46, height: 46, borderRadius: radius.sm, backgroundColor: "#FFFFFF" },
    altImageEmpty: { backgroundColor: colors.surfaceRaised },
    altBody: { flex: 1, gap: 1 },
    altStore: {
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
      fontWeight: "800",
      letterSpacing: 0.4,
    },
    altTitle: { color: colors.textPrimary, fontSize: type.label.fontSize, lineHeight: 17 },
    caveat: { color: colors.warning, fontSize: type.caption.fontSize, lineHeight: 14 },
    altPrices: { alignItems: "flex-end", gap: 2 },
    altPrice: { color: colors.textPrimary, fontSize: type.body.fontSize, fontWeight: "800" },
    altSaving: { color: colors.success, fontSize: type.caption.fontSize, fontWeight: "700" },

    statRow: { flexDirection: "row", gap: spacing.sm },
    stat: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      padding: spacing.sm,
      gap: 1,
    },
    statLabel: { color: colors.textTertiary, fontSize: type.caption.fontSize },
    statValue: { color: colors.textPrimary, fontSize: type.label.fontSize, fontWeight: "800" },

    unreachable: { color: colors.textTertiary, fontSize: type.caption.fontSize, lineHeight: 15 },

    actions: {
      padding: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.surfaceBorder,
    },
  });
