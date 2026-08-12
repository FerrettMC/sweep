// app/product/[id].tsx
//
// Product detail: current price, history chart, and the stats that answer the
// only question that matters — is this actually a good price, or does it just
// look like one?

import { useCallback, useState } from "react";
import {
  Image,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import PriceChart from "@/components/PriceChart";
import { Button, ErrorBanner, Loading, Screen, SectionTitle, Stat } from "@/components/ui";
import { colors, radius, spacing, type } from "@/constants/theme";
import {
  ApiError,
  type ProductDetail,
  getProductDetail,
  refreshProduct,
  trackProduct,
  untrackProduct,
} from "@/lib/api";
import {
  formatPrice,
  formatRating,
  formatRelativeTime,
  percentOff,
  retailerColor,
  retailerLabel,
} from "@/lib/format";

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setDetail(await getProductDetail(id));
      setError(null);
    } catch (err) {
      setError((err as ApiError).message);
    }
  }, [id]);

  // The scheduler can update this product's price while the user is on another
  // screen, so re-read on focus rather than once on mount.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onPullRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function onCheckNow() {
    if (!id) return;
    setBusy(true);
    setNotice(null);
    try {
      await refreshProduct(id);
      await load();
      setNotice("Price checked just now.");
    } catch (err) {
      const apiError = err as ApiError;
      setNotice(
        apiError.code === "REFRESH_TOO_SOON"
          ? "Already checked in the last few minutes."
          : apiError.message,
      );
    } finally {
      setBusy(false);
    }
  }

  async function onToggleTracking() {
    if (!detail) return;
    setBusy(true);
    setNotice(null);

    try {
      if (detail.tracking) {
        await untrackProduct(detail.tracking.id);
        router.back();
      } else {
        await trackProduct({
          retailer: detail.product.retailer,
          retailerId: detail.product.retailerId,
        });
        await load();
      }
    } catch (err) {
      setNotice((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  if (!detail && !error) return <Loading />;

  if (!detail) {
    return (
      <Screen>
        <ErrorBanner message={error ?? "Couldn't load this product"} onRetry={load} />
      </Screen>
    );
  }

  const { product, history, stats, historyWindow } = detail;
  const discount = percentOff(product.price, product.listPrice);
  const ratingText = formatRating(product.rating, product.ratingCount);
  const belowAverage = stats.percentBelowAverage;

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: retailerLabel(product.retailer),
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
        }}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onPullRefresh}
            tintColor={colors.accent}
          />
        }
      >
        <View style={styles.hero}>
          {product.imageUrl && (
            <Image
              source={{ uri: product.imageUrl }}
              style={styles.image}
              resizeMode="contain"
            />
          )}
          <View style={styles.retailerRow}>
            <View
              style={[styles.retailerDot, { backgroundColor: retailerColor(product.retailer) }]}
            />
            <Text style={styles.retailerName}>{retailerLabel(product.retailer)}</Text>
            {ratingText && <Text style={styles.rating}>{ratingText}</Text>}
          </View>
          <Text style={styles.title}>{product.title}</Text>

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

          {belowAverage !== null && (
            <Text style={[styles.verdict, belowAverage > 0 ? styles.verdictGood : styles.verdictBad]}>
              {belowAverage > 0
                ? `${belowAverage}% below its average — a genuinely good time to buy`
                : belowAverage === 0
                  ? "Right at its average price"
                  : `${Math.abs(belowAverage)}% above its average — worth waiting`}
            </Text>
          )}

          <Text style={styles.checked}>
            Last checked {formatRelativeTime(product.lastCheckedAt)}
            {product.lastStatus && product.lastStatus !== "success"
              ? " · last check failed"
              : ""}
          </Text>
        </View>

        <View style={styles.section}>
          <SectionTitle>Price history</SectionTitle>
          <PriceChart history={history} currentPrice={product.price} />
          {historyWindow.days !== null && historyWindow.total > historyWindow.shown && (
            <Text style={styles.upsell}>
              Showing the last {historyWindow.days} days. {historyWindow.total - historyWindow.shown}{" "}
              older points are available on Pro.
            </Text>
          )}
        </View>

        <View style={styles.statsRow}>
          <Stat label="Low" value={formatPrice(stats.low)} />
          <Stat label="Average" value={formatPrice(stats.average)} />
          <Stat label="High" value={formatPrice(stats.high)} />
        </View>

        {notice && <Text style={styles.notice}>{notice}</Text>}

        <View style={styles.actions}>
          <Button label="Check price now" onPress={onCheckNow} busy={busy} variant="secondary" />
          <Button
            label={`Open on ${retailerLabel(product.retailer)}`}
            onPress={() => Linking.openURL(product.url)}
            variant="secondary"
          />
          <Button
            label={detail.tracking ? "Stop tracking" : "Track this product"}
            onPress={onToggleTracking}
            variant={detail.tracking ? "danger" : "primary"}
            busy={busy}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl },
  hero: { gap: spacing.xs },
  image: {
    width: "100%",
    height: 180,
    backgroundColor: "#FFFFFF",
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  retailerRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  retailerDot: { width: 8, height: 8, borderRadius: radius.pill },
  retailerName: {
    color: colors.textSecondary,
    fontSize: type.caption.fontSize,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  rating: { color: colors.textTertiary, fontSize: type.caption.fontSize },
  title: {
    color: colors.textPrimary,
    fontSize: type.title.fontSize,
    fontWeight: "800",
    lineHeight: 29,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.sm,
    marginTop: spacing.xs,
    flexWrap: "wrap",
  },
  price: { color: colors.textPrimary, fontSize: 32, fontWeight: "900" },
  listPrice: {
    color: colors.textTertiary,
    fontSize: type.body.fontSize,
    textDecorationLine: "line-through",
  },
  discountPill: {
    backgroundColor: colors.accentMuted,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  discountText: { color: colors.accent, fontSize: type.caption.fontSize, fontWeight: "800" },
  verdict: { fontSize: type.label.fontSize, fontWeight: "700", marginTop: spacing.xs },
  verdictGood: { color: colors.success },
  verdictBad: { color: colors.warning },
  checked: { color: colors.textTertiary, fontSize: type.caption.fontSize, marginTop: 2 },
  section: { gap: spacing.sm },
  upsell: {
    color: colors.textTertiary,
    fontSize: type.caption.fontSize,
    fontStyle: "italic",
  },
  statsRow: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    padding: spacing.md,
  },
  notice: { color: colors.textSecondary, fontSize: type.label.fontSize, textAlign: "center" },
  actions: { gap: spacing.sm },
});
