// app/(tabs)/deals.tsx
//
// "Best Deals Found" — real drops other people are watching, credited to
// whoever spotted each one first.
//
// Guests can browse this. It's the one screen that demonstrates the app's
// value before signing up, so gating it would throw away the best argument
// for creating an account.

import { useCallback, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  FlatList,
  Image,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Button, EmptyState, Loading, Screen } from "@/components/ui";
import { colors, radius, spacing, type } from "@/constants/theme";
import { type Deal, getDeals } from "@/lib/api";
import {
  formatPrice,
  formatRelativeTime,
  retailerColor,
  retailerLabel,
} from "@/lib/format";

export default function DealsScreen() {
  const router = useRouter();

  const [deals, setDeals] = useState<Deal[] | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await getDeals();
      setDeals(result.deals);
      setIsGuest(result.isGuest);
    } catch {
      setDeals([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (deals === null) return <Loading />;

  return (
    <Screen>
      <FlatList
        data={deals}
        keyExtractor={(item) => item.id}
        contentContainerStyle={deals.length === 0 ? styles.emptyList : styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
            tintColor={colors.accent}
          />
        }
        ListHeaderComponent={
          deals.length > 0 ? (
            <Text style={styles.intro}>
              Real drops on products people are tracking right now, biggest
              first.
            </Text>
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            title="No deals yet"
            body="When something anyone tracks falls well below its usual price, it shows up here — with credit to whoever found it first."
            action={
              isGuest ? (
                <Button label="Create an account" onPress={() => router.push("/auth")} />
              ) : (
                <Button
                  label="Track something"
                  onPress={() => router.push("/tracking")}
                  variant="secondary"
                />
              )
            }
          />
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.card, pressed && styles.pressed]}
            onPress={() =>
              isGuest
                ? Linking.openURL(item.product.url)
                : router.push(`/product/${item.product.id}`)
            }
          >
            <View style={styles.top}>
              {item.product.imageUrl ? (
                <Image
                  source={{ uri: item.product.imageUrl }}
                  style={styles.thumb}
                  resizeMode="contain"
                />
              ) : (
                <View style={[styles.thumb, styles.thumbEmpty]} />
              )}

              <View style={styles.info}>
                <View style={styles.storeRow}>
                  <View
                    style={[
                      styles.dot,
                      { backgroundColor: retailerColor(item.product.retailer) },
                    ]}
                  />
                  <Text style={styles.store}>
                    {retailerLabel(item.product.retailer)}
                  </Text>
                  <Text style={styles.when}>{formatRelativeTime(item.foundAt)}</Text>
                </View>

                <Text style={styles.title} numberOfLines={2}>
                  {item.product.title}
                </Text>

                <View style={styles.priceRow}>
                  <Text style={styles.price}>{formatPrice(item.newPrice)}</Text>
                  <Text style={styles.wasPrice}>
                    {formatPrice(item.averagePrice)}
                  </Text>
                  <View style={styles.offPill}>
                    <Text style={styles.offText}>
                      {item.percentBelowAverage}% below avg
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            <View style={styles.footer}>
              {/* The social hook: who spotted it. */}
              <View style={styles.finderRow}>
                <Ionicons
                  name={item.foundByMe ? "trophy" : "person-circle-outline"}
                  size={14}
                  color={item.foundByMe ? colors.accent : colors.textTertiary}
                />
                <Text style={[styles.finder, item.foundByMe && styles.finderMe]}>
                  {item.foundByMe
                    ? "You found this"
                    : item.finder
                      ? `Found by ${item.finder}`
                      : "Found by a former member"}
                </Text>
              </View>

              {/* The recorded price can go stale — say so rather than letting
                  someone chase a number that's already gone. */}
              {item.product.currentPrice !== null &&
                item.product.currentPrice !== item.newPrice && (
                  <Text style={styles.nowPrice}>
                    now {formatPrice(item.product.currentPrice)}
                  </Text>
                )}

              {item.isTracking && (
                <View style={styles.trackingPill}>
                  <Text style={styles.trackingText}>Tracking</Text>
                </View>
              )}
            </View>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.md, gap: spacing.sm },
  emptyList: { flexGrow: 1 },
  intro: {
    color: colors.textSecondary,
    fontSize: type.label.fontSize,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  pressed: { opacity: 0.75 },
  top: { flexDirection: "row", gap: spacing.md },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: radius.sm,
    backgroundColor: "#FFFFFF",
  },
  thumbEmpty: { backgroundColor: colors.surfaceRaised },
  info: { flex: 1, gap: 3 },
  storeRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  dot: { width: 7, height: 7, borderRadius: radius.pill },
  store: {
    color: colors.textSecondary,
    fontSize: type.caption.fontSize,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  when: { color: colors.textTertiary, fontSize: type.caption.fontSize },
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
  price: { color: colors.success, fontSize: 18, fontWeight: "900" },
  wasPrice: {
    color: colors.textTertiary,
    fontSize: type.label.fontSize,
    textDecorationLine: "line-through",
  },
  offPill: {
    backgroundColor: colors.accentMuted,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  offText: {
    color: colors.accent,
    fontSize: type.caption.fontSize,
    fontWeight: "800",
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceBorder,
    paddingTop: spacing.sm,
  },
  finderRow: { flexDirection: "row", alignItems: "center", gap: 5, flex: 1 },
  finder: { color: colors.textTertiary, fontSize: type.caption.fontSize },
  finderMe: { color: colors.accent, fontWeight: "800" },
  nowPrice: { color: colors.textTertiary, fontSize: type.caption.fontSize },
  trackingPill: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  trackingText: {
    color: colors.textSecondary,
    fontSize: type.caption.fontSize,
    fontWeight: "700",
  },
});
