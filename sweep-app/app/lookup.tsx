// app/lookup.tsx
//
// Product lookup — one page about one product.
//
// This replaced "Sweep this deal", and the reason is worth stating: the
// clearest signal from competitor reviews was that product pages are hard to
// read. Sweep answered "is it cheaper elsewhere?", which is a good question
// nobody was asking often enough to justify 1/day. This answers "what am I
// actually looking at?", which is what people open a shopping app to find out.
//
// The rule the whole screen is built on: SHOW WHAT EXISTS, OMIT WHAT DOESN'T.
// Stores differ enormously — Amazon returns a review summary with per-topic
// sentiment and buyer photos, eBay returns seller feedback and a delivery
// window and no product reviews at all, Etsy returns little of either. Every
// section below renders only if its data arrived. An empty panel would imply
// we looked and found nothing; a missing panel says we were never told.

import { useCallback, useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  Image,
  Keyboard,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import PriceChart from "@/components/PriceChart";
import { Button, ErrorBanner, Loading, Screen, SectionTitle } from "@/components/ui";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { useTranslate } from "@/lib/i18n";
import {
  type ApiError,
  type LookupQuota,
  type LookupResult,
  getLookupQuota,
  lookUpProduct,
} from "@/lib/api";
import {
  formatPrice,
  formatRelativeTime,
  percentOff,
  retailerColor,
  retailerLabel,
} from "@/lib/format";
import { maybeAskForReview } from "@/lib/reviewPrompt";

export default function LookupScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();
  const router = useRouter();
  const params = useLocalSearchParams<{
    productId?: string;
    url?: string;
    retailer?: string;
    retailerId?: string;
  }>();

  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quota, setQuota] = useState<LookupQuota | null>(null);

  const refreshQuota = useCallback(async () => {
    try {
      setQuota((await getLookupQuota()).quota);
    } catch {
      // A missing quota only hides the counter; the button still works and the
      // server refuses if there's nothing left.
      setQuota(null);
    }
  }, []);

  const run = useCallback(
    async (target: Parameters<typeof lookUpProduct>[0]) => {
      Keyboard.dismiss();
      setBusy(true);
      setError(null);
      try {
        const response = await lookUpProduct(target);
        setResult(response);
        setQuota(response.quota);
        // A lookup that returned something is a real completed action, which
        // is what the rating prompt counts.
        void maybeAskForReview();
      } catch (err) {
        setError((err as ApiError).message);
        void refreshQuota();
      } finally {
        setBusy(false);
      }
    },
    [refreshQuota],
  );

  useEffect(() => {
    void refreshQuota();
  }, [refreshQuota]);

  // Arriving from a product card or a shared link runs immediately — the user
  // already chose the product, so making them press another button is friction
  // with no decision behind it.
  useEffect(() => {
    if (params.productId) void run({ productId: params.productId });
    else if (params.url) void run({ url: params.url });
    else if (params.retailer && params.retailerId) {
      void run({ retailer: params.retailer, retailerId: params.retailerId });
    }
    // Deliberately keyed on the params only: re-running because `run` was
    // recreated would spend another lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.productId, params.url, params.retailer, params.retailerId]);

  const detail = result?.detail;
  const remaining = quota?.remaining ?? null;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* The paste field stays available even after a result, so looking up
            a second product doesn't mean navigating away and back. */}
        <View style={styles.searchCard}>
          <Text style={styles.searchLabel}>{t("lookup.pasteLabel")}</Text>
          <View style={styles.searchRow}>
            <TextInput
              style={styles.input}
              value={link}
              onChangeText={setLink}
              placeholder={t("lookup.placeholder")}
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={() => link.trim() && run({ url: link.trim() })}
            />
            <Button
              label={t("lookup.go")}
              onPress={() => link.trim() && run({ url: link.trim() })}
              disabled={busy || !link.trim()}
            />
          </View>
          {remaining !== null && (
            <Text style={styles.quota}>
              {t("lookup.remaining", { count: remaining })}
            </Text>
          )}
        </View>

        {error && <ErrorBanner message={error} />}
        {busy && <Loading label={t("lookup.loading")} />}

        {!busy && !result && !error && (
          <View style={styles.intro}>
            <Ionicons name="reader-outline" size={26} color={colors.textTertiary} />
            <Text style={styles.introTitle}>{t("lookup.introTitle")}</Text>
            <Text style={styles.introBody}>{t("lookup.introBody")}</Text>
          </View>
        )}

        {!busy && result && detail && (
          <>
            {/* Said plainly rather than hidden: a cached page is still useful,
                but presenting stale numbers as live is the one thing a price
                app cannot do. */}
            {!result.fresh && (
              <View style={styles.staleBanner}>
                <Ionicons name="cloud-offline-outline" size={15} color={colors.warning} />
                <Text style={styles.staleText}>
                  {result.staleReason === "blocked"
                    ? t("lookup.staleBlocked")
                    : t("lookup.staleFailed")}
                </Text>
              </View>
            )}

            {detail.images.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.gallery}
              >
                {detail.images.slice(0, 8).map((uri) => (
                  <Image key={uri} source={{ uri }} style={styles.galleryImage} />
                ))}
              </ScrollView>
            )}

            <View style={styles.card}>
              <View style={styles.storeRow}>
                <View
                  style={[
                    styles.storeDot,
                    { backgroundColor: retailerColor(colors, detail.retailer) },
                  ]}
                />
                <Text style={styles.storeName}>{retailerLabel(detail.retailer)}</Text>
                {detail.condition && (
                  <Text style={styles.condition}>{detail.condition}</Text>
                )}
              </View>

              <Text style={styles.title}>{detail.title}</Text>
              {detail.brand && <Text style={styles.brand}>{detail.brand}</Text>}

              <View style={styles.priceRow}>
                <Text style={styles.price}>{formatPrice(detail.price)}</Text>
                {detail.listPrice !== null && detail.price !== null && (
                  <>
                    <Text style={styles.listPrice}>{formatPrice(detail.listPrice)}</Text>
                    {percentOff(detail.price, detail.listPrice) !== null && (
                      <Text style={styles.off}>
                        {t("lookup.percentOff", {
                          percent: percentOff(detail.price, detail.listPrice)!,
                        })}
                      </Text>
                    )}
                  </>
                )}
              </View>

              {detail.inStock === false && (
                <Text style={styles.outOfStock}>{t("lookup.outOfStock")}</Text>
              )}

              {detail.rating !== null && (
                <View style={styles.ratingRow}>
                  <Ionicons name="star" size={14} color={colors.warning} />
                  <Text style={styles.ratingValue}>{detail.rating.toFixed(1)}</Text>
                  {detail.ratingCount !== null && (
                    <Text style={styles.ratingCount}>
                      {t("lookup.ratingCount", { count: detail.ratingCount })}
                    </Text>
                  )}
                </View>
              )}

              {detail.coupon && (
                <View style={styles.coupon}>
                  <Ionicons name="pricetag" size={14} color={colors.success} />
                  <Text style={styles.couponText}>{detail.coupon}</Text>
                </View>
              )}

              <View style={styles.actions}>
                <Button
                  label={t("lookup.openStore")}
                  onPress={() => void Linking.openURL(detail.url)}
                />
                {!result.isTracked && (
                  <Button
                    label={t("lookup.track")}
                    variant="secondary"
                    onPress={() =>
                      router.push(
                        `/(tabs)/tracking?addUrl=${encodeURIComponent(detail.url)}`,
                      )
                    }
                  />
                )}
              </View>
              <Text style={styles.fetched}>
                {t("lookup.checked", { when: formatRelativeTime(detail.fetchedAt) })}
              </Text>
            </View>

            {/* Trust signals first, because "frequently returned" changes a
                buying decision more than any spec does and is buried on the
                store's own page. */}
            {result.detail.trust && <TrustPanel trust={result.detail.trust} />}

            {result.sale && (
              <View style={styles.card}>
                <SectionTitle>{t("lookup.saleTitle")}</SectionTitle>
                <Text style={styles.verdictHeadline}>{result.sale.headline}</Text>
                <Text style={styles.verdictDetail}>{result.sale.detail}</Text>
              </View>
            )}

            <View style={styles.card}>
              <SectionTitle>{t("lookup.historyTitle")}</SectionTitle>
              <PriceChart history={result.history} currentPrice={detail.price} />
            </View>

            {/* Three states, not two. A store that never returns reviews shows
                nothing at all (the closing note explains why); a store that
                does, on an item with none, says so — otherwise "no reviews
                yet" and "we can't see reviews here" look identical. */}
            {result.detail.reviews ? (
              <ReviewPanel reviews={result.detail.reviews} />
            ) : (
              result.coverage.reviews && (
                <View style={styles.card}>
                  <SectionTitle>{t("lookup.reviewsTitle")}</SectionTitle>
                  <Text style={styles.emptySection}>{t("lookup.noReviews")}</Text>
                </View>
              )
            )}

            {result.detail.seller && <SellerPanel seller={result.detail.seller} />}

            {result.detail.shipping ? (
              <ShippingPanel shipping={result.detail.shipping} />
            ) : (
              result.coverage.shipping && (
                <View style={styles.card}>
                  <SectionTitle>{t("lookup.shippingTitle")}</SectionTitle>
                  <Text style={styles.emptySection}>
                    {t("lookup.shippingNotListed")}
                  </Text>
                </View>
              )
            )}

            {detail.features.length > 0 && (
              <View style={styles.card}>
                <SectionTitle>{t("lookup.featuresTitle")}</SectionTitle>
                {detail.features.map((feature) => (
                  <View key={feature} style={styles.bulletRow}>
                    <Text style={styles.bullet}>•</Text>
                    <Text style={styles.bulletText}>{feature}</Text>
                  </View>
                ))}
              </View>
            )}

            {detail.specs.length > 0 && (
              <View style={styles.card}>
                <SectionTitle>{t("lookup.specsTitle")}</SectionTitle>
                {detail.specs.map((spec) => (
                  <View key={spec.label} style={styles.specRow}>
                    <Text style={styles.specLabel}>{spec.label}</Text>
                    <Text style={styles.specValue}>{spec.value}</Text>
                  </View>
                ))}
              </View>
            )}

            {detail.description && <DescriptionPanel text={detail.description} />}

            {/* Named explicitly so a thin page reads as a limit of the store,
                not as a product with nothing to say about it. */}
            <MissingNote coverage={result.coverage} store={retailerLabel(detail.retailer)} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function TrustPanel({ trust }: { trust: NonNullable<LookupResult["detail"]["trust"]> }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();

  return (
    <View style={styles.card}>
      {trust.frequentlyReturned && (
        <View style={styles.warnRow}>
          <Ionicons name="alert-circle" size={16} color={colors.danger} />
          <Text style={styles.warnText}>
            {trust.frequentlyReturnedNote ?? t("lookup.frequentlyReturned")}
          </Text>
        </View>
      )}
      <View style={styles.chipRow}>
        {trust.amazonChoice && (
          <Text style={styles.chipGood}>{t("lookup.amazonChoice")}</Text>
        )}
        {trust.badge && <Text style={styles.chipGood}>{trust.badge}</Text>}
        {trust.boughtRecently && (
          <Text style={styles.chip}>{trust.boughtRecently}</Text>
        )}
        {trust.bestSellerRank !== null && (
          <Text style={styles.chip}>
            {t("lookup.bestSeller", { rank: trust.bestSellerRank })}
            {trust.bestSellerCategory ? ` · ${trust.bestSellerCategory}` : ""}
          </Text>
        )}
      </View>
    </View>
  );
}

function ReviewPanel({
  reviews,
}: {
  reviews: NonNullable<LookupResult["detail"]["reviews"]>;
}) {
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();
  const [expanded, setExpanded] = useState(false);
  const topics = expanded ? reviews.topics : reviews.topics.slice(0, 3);

  return (
    <View style={styles.card}>
      <SectionTitle>{t("lookup.reviewsTitle")}</SectionTitle>

      {reviews.text && <Text style={styles.reviewSummary}>{reviews.text}</Text>}

      {/* Three separate lists, never merged into a score. "Mixed" is real
          information — buyers disagreeing about the fit is different from
          nobody mentioning it — and averaging it away would lose that. */}
      <View style={styles.chipRow}>
        {reviews.positive.map((word) => (
          <Text key={word} style={styles.chipGood}>
            {word}
          </Text>
        ))}
        {reviews.mixed.map((word) => (
          <Text key={word} style={styles.chipMixed}>
            {word}
          </Text>
        ))}
        {reviews.negative.map((word) => (
          <Text key={word} style={styles.chipBad}>
            {word}
          </Text>
        ))}
      </View>

      {topics.map((topic) => (
        <View key={topic.topic} style={styles.topic}>
          <View style={styles.topicHeader}>
            <Text style={styles.topicName}>{topic.topic}</Text>
            {/* Counts shown as counts, never as a percentage: the store gives
                positive and negative mentions but no reliable total, so a
                share would be invented. */}
            <Text style={styles.topicCounts}>
              {t("lookup.mentions", {
                positive: topic.positiveMentions,
                negative: topic.negativeMentions,
              })}
            </Text>
          </View>
          {topic.description && (
            <Text style={styles.topicDesc}>{topic.description}</Text>
          )}
          {topic.quotes[0] && (
            <Text style={styles.quote}>“{topic.quotes[0]}”</Text>
          )}
        </View>
      ))}

      {reviews.topics.length > 3 && (
        <Pressable onPress={() => setExpanded((v) => !v)}>
          <Text style={styles.expand}>
            {expanded ? t("lookup.showLess") : t("lookup.showAllTopics")}
          </Text>
        </Pressable>
      )}

      {reviews.images.length > 0 && (
        <>
          <Text style={styles.photoLabel}>{t("lookup.buyerPhotos")}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.photoRow}>
              {reviews.images.slice(0, 12).map((uri) => (
                <Image key={uri} source={{ uri }} style={styles.photo} />
              ))}
            </View>
          </ScrollView>
        </>
      )}
    </View>
  );
}

function SellerPanel({
  seller,
}: {
  seller: NonNullable<LookupResult["detail"]["seller"]>;
}) {
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();

  return (
    <View style={styles.card}>
      <SectionTitle>{t("lookup.sellerTitle")}</SectionTitle>
      {seller.name && <Text style={styles.sellerName}>{seller.name}</Text>}
      {seller.ratingPercent !== null && (
        <Text style={styles.sellerRating}>
          {t("lookup.sellerFeedback", {
            percent: seller.ratingPercent,
            count: seller.ratingCount ?? 0,
          })}
        </Text>
      )}
      {seller.offerCount !== null && seller.offerCount > 1 && (
        <Text style={styles.sellerMeta}>
          {t("lookup.otherSellers", { count: seller.offerCount })}
        </Text>
      )}
    </View>
  );
}

function ShippingPanel({
  shipping,
}: {
  shipping: NonNullable<LookupResult["detail"]["shipping"]>;
}) {
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();

  const when =
    shipping.earliest && shipping.latest
      ? `${formatDeliveryDate(shipping.earliest)} – ${formatDeliveryDate(shipping.latest)}`
      : null;

  return (
    <View style={styles.card}>
      <SectionTitle>{t("lookup.shippingTitle")}</SectionTitle>
      {/* Zero and null are different claims and are worded differently: one is
          free shipping, the other is a quote we were never given. */}
      <Text style={styles.shippingCost}>
        {shipping.costCents === null
          ? t("lookup.shippingUnknown")
          : shipping.costCents === 0
            ? t("lookup.shippingFree")
            : formatPrice(shipping.costCents)}
      </Text>
      {when && <Text style={styles.sellerMeta}>{t("lookup.arrives", { when })}</Text>}
    </View>
  );
}

function DescriptionPanel({ text }: { text: string }) {
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.card}>
      <SectionTitle>{t("lookup.aboutTitle")}</SectionTitle>
      <Text style={styles.description} numberOfLines={open ? undefined : 6}>
        {text}
      </Text>
      <Pressable onPress={() => setOpen((v) => !v)}>
        <Text style={styles.expand}>
          {open ? t("lookup.showLess") : t("lookup.showMore")}
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * What this store simply doesn't publish.
 *
 * Without this, an eBay page with no review section looks like a product
 * nobody has reviewed, and an Etsy page looks broken. Naming the gap moves it
 * from "Sweep is missing something" to "this store doesn't share that", which
 * is both true and the more useful thing to know.
 */
function MissingNote({
  coverage,
  store,
}: {
  coverage: LookupResult["coverage"];
  store: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();

  const missing = [
    !coverage.reviews && t("lookup.missingReviews"),
    !coverage.shipping && t("lookup.missingShipping"),
    !coverage.seller && t("lookup.missingSeller"),
  ].filter(Boolean) as string[];

  if (missing.length === 0) return null;

  return (
    <Text style={styles.missing}>
      {t("lookup.missingNote", { store, items: missing.join(", ") })}
    </Text>
  );
}

function formatDeliveryDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },

    searchCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.md,
      gap: spacing.sm,
    },
    searchLabel: {
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
      fontWeight: "700",
    },
    searchRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
    input: {
      flex: 1,
      backgroundColor: colors.background,
      borderRadius: radius.md,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      color: colors.textPrimary,
      fontSize: type.body.fontSize,
    },
    quota: { color: colors.textTertiary, fontSize: type.caption.fontSize },

    intro: { alignItems: "center", gap: spacing.xs, paddingVertical: spacing.xl },
    introTitle: {
      color: colors.textPrimary,
      fontSize: type.heading.fontSize,
      fontWeight: "800",
    },
    introBody: {
      color: colors.textSecondary,
      fontSize: type.body.fontSize,
      textAlign: "center",
      paddingHorizontal: spacing.lg,
    },

    staleBanner: {
      flexDirection: "row",
      gap: spacing.xs,
      alignItems: "center",
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.sm,
    },
    staleText: { color: colors.textSecondary, fontSize: type.caption.fontSize, flex: 1 },

    gallery: { gap: spacing.sm },
    galleryImage: {
      width: 140,
      height: 140,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      resizeMode: "contain",
    },

    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.md,
      gap: spacing.sm,
    },

    storeRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    storeDot: { width: 8, height: 8, borderRadius: 4 },
    storeName: {
      color: colors.textSecondary,
      fontSize: type.caption.fontSize,
      fontWeight: "700",
    },
    condition: { color: colors.textTertiary, fontSize: type.caption.fontSize },

    title: { color: colors.textPrimary, fontSize: type.heading.fontSize, fontWeight: "800" },
    brand: { color: colors.textSecondary, fontSize: type.caption.fontSize },

    priceRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
    price: { color: colors.textPrimary, fontSize: type.title.fontSize, fontWeight: "800" },
    listPrice: {
      color: colors.textTertiary,
      fontSize: type.body.fontSize,
      textDecorationLine: "line-through",
    },
    off: { color: colors.success, fontSize: type.body.fontSize, fontWeight: "700" },
    outOfStock: { color: colors.danger, fontSize: type.caption.fontSize, fontWeight: "700" },

    ratingRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    ratingValue: { color: colors.textPrimary, fontSize: type.body.fontSize, fontWeight: "700" },
    ratingCount: { color: colors.textTertiary, fontSize: type.caption.fontSize },

    coupon: {
      flexDirection: "row",
      gap: spacing.xs,
      alignItems: "center",
      backgroundColor: colors.background,
      borderRadius: radius.md,
      padding: spacing.sm,
    },
    couponText: { color: colors.success, fontSize: type.caption.fontSize, flex: 1 },

    actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
    fetched: { color: colors.textTertiary, fontSize: type.caption.fontSize },

    warnRow: { flexDirection: "row", gap: spacing.xs, alignItems: "flex-start" },
    warnText: { color: colors.danger, fontSize: type.caption.fontSize, flex: 1, fontWeight: "600" },

    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
    chip: {
      color: colors.textSecondary,
      fontSize: type.caption.fontSize,
      backgroundColor: colors.background,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      overflow: "hidden",
    },
    chipGood: {
      color: colors.success,
      fontSize: type.caption.fontSize,
      backgroundColor: colors.background,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      overflow: "hidden",
      fontWeight: "600",
    },
    chipMixed: {
      color: colors.warning,
      fontSize: type.caption.fontSize,
      backgroundColor: colors.background,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      overflow: "hidden",
      fontWeight: "600",
    },
    chipBad: {
      color: colors.danger,
      fontSize: type.caption.fontSize,
      backgroundColor: colors.background,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      overflow: "hidden",
      fontWeight: "600",
    },

    verdictHeadline: {
      color: colors.textPrimary,
      fontSize: type.body.fontSize,
      fontWeight: "800",
    },
    verdictDetail: { color: colors.textSecondary, fontSize: type.caption.fontSize },

    reviewSummary: {
      color: colors.textSecondary,
      fontSize: type.body.fontSize,
      lineHeight: 20,
    },

    topic: { gap: 2, marginTop: spacing.xs },
    topicHeader: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
    topicName: { color: colors.textPrimary, fontSize: type.body.fontSize, fontWeight: "700" },
    topicCounts: { color: colors.textTertiary, fontSize: type.caption.fontSize },
    topicDesc: { color: colors.textSecondary, fontSize: type.caption.fontSize },
    quote: {
      color: colors.textSecondary,
      fontSize: type.caption.fontSize,
      fontStyle: "italic",
      borderLeftWidth: 2,
      borderLeftColor: colors.surfaceBorder,
      paddingLeft: spacing.sm,
      marginTop: 4,
    },
    expand: { color: colors.accent, fontSize: type.label.fontSize, fontWeight: "700" },

    photoLabel: {
      color: colors.textSecondary,
      fontSize: type.caption.fontSize,
      fontWeight: "700",
      marginTop: spacing.xs,
    },
    photoRow: { flexDirection: "row", gap: spacing.xs },
    photo: {
      width: 72,
      height: 72,
      borderRadius: radius.sm,
      backgroundColor: colors.background,
    },

    sellerName: { color: colors.textPrimary, fontSize: type.body.fontSize, fontWeight: "700" },
    sellerRating: { color: colors.textSecondary, fontSize: type.caption.fontSize },
    sellerMeta: { color: colors.textTertiary, fontSize: type.caption.fontSize },

    shippingCost: { color: colors.textPrimary, fontSize: type.body.fontSize, fontWeight: "700" },

    bulletRow: { flexDirection: "row", gap: spacing.xs },
    bullet: { color: colors.textTertiary, fontSize: type.caption.fontSize },
    bulletText: { color: colors.textSecondary, fontSize: type.caption.fontSize, flex: 1, lineHeight: 18 },

    specRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: spacing.md,
      paddingVertical: 3,
    },
    specLabel: { color: colors.textTertiary, fontSize: type.caption.fontSize, flex: 1 },
    specValue: {
      color: colors.textSecondary,
      fontSize: type.caption.fontSize,
      flex: 1,
      textAlign: "right",
    },

    description: { color: colors.textSecondary, fontSize: type.caption.fontSize, lineHeight: 18 },

    emptySection: { color: colors.textTertiary, fontSize: type.caption.fontSize },

    missing: {
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
      textAlign: "center",
      paddingHorizontal: spacing.md,
    },
  });
