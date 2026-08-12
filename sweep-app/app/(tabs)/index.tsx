// app/(tabs)/index.tsx
//
// Tracking — the home tab. Everything the user is watching, cheapest-first by
// how good a deal it is right now rather than by when it was added.

import { useCallback, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import AddByLink from "@/components/AddByLink";
import ProductCard from "@/components/ProductCard";
import { Button, EmptyState, ErrorBanner, Loading, Screen } from "@/components/ui";
import { colors, radius, spacing, type } from "@/constants/theme";
import {
  ApiError,
  type TrackedProduct,
  getTrackedProducts,
  untrackProduct,
} from "@/lib/api";
import { percentOff, pluralize } from "@/lib/format";

export default function TrackingScreen() {
  const router = useRouter();

  const [tracked, setTracked] = useState<TrackedProduct[] | null>(null);
  const [limits, setLimits] = useState<{ maxTrackedProducts: number; used: number } | null>(
    null,
  );
  const [tier, setTier] = useState("free");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await getTrackedProducts();
      setTracked(result.tracked);
      setLimits(result.limits);
      setTier(result.tier);
      setError(null);
    } catch (err) {
      const apiError = err as ApiError;
      // A guest landing here has no account — send them to sign up rather than
      // showing a bare 401.
      if (apiError.status === 401) {
        setTracked([]);
        setError(null);
      } else {
        setError(apiError.message);
      }
    }
  }, []);

  // Prices update in the background while the user is elsewhere in the app, so
  // this re-reads on focus rather than once on mount.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      load().finally(() => {
        if (cancelled) return;
      });
      return () => {
        cancelled = true;
      };
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function onUntrack(item: TrackedProduct) {
    setRemoving(item.id);
    // Optimistic: the row disappears immediately, and comes back if the server
    // rejects it.
    const previous = tracked;
    setTracked((current) => current?.filter((t) => t.id !== item.id) ?? null);

    try {
      await untrackProduct(item.id);
      setLimits((current) =>
        current ? { ...current, used: Math.max(0, current.used - 1) } : current,
      );
    } catch (err) {
      setTracked(previous);
      setError((err as ApiError).message);
    } finally {
      setRemoving(null);
    }
  }

  if (tracked === null && !error) return <Loading />;

  const sorted = [...(tracked ?? [])].sort((a, b) => dealScore(b) - dealScore(a));
  const atLimit = limits ? limits.used >= limits.maxTrackedProducts : false;

  return (
    <Screen>
      {error && <ErrorBanner message={error} onRetry={load} />}

      {limits && (
        <View style={styles.limitRow}>
          <Text style={styles.limitText}>
            {limits.used} of {limits.maxTrackedProducts} tracked
            {tier !== "free" ? ` · ${tier}` : ""}
          </Text>
          {atLimit && <Text style={styles.limitFull}>Limit reached</Text>}
        </View>
      )}

      <AddByLink
        disabled={atLimit}
        disabledReason={
          limits
            ? `You're tracking ${limits.maxTrackedProducts} products — remove one to add another.`
            : undefined
        }
        onTracked={(added) => {
          setError(null);

          // Tracking is idempotent server-side, so pasting a link for something
          // already in the list must not double-count against the plan limit.
          const isNew = !(tracked ?? []).some((t) => t.id === added.id);

          // Prepend rather than refetch: the server already returned the full
          // record, so a round trip would only add latency.
          setTracked((current) => [
            added,
            ...(current ?? []).filter((t) => t.id !== added.id),
          ]);
          if (isNew) {
            setLimits((current) =>
              current ? { ...current, used: current.used + 1 } : current,
            );
          }

          router.push(`/product/${added.product.id}`);
        }}
      />

      <FlatList
        data={sorted}
        keyExtractor={(item) => item.id}
        contentContainerStyle={sorted.length === 0 ? styles.emptyList : styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
          />
        }
        ListEmptyComponent={
          <EmptyState
            title="Nothing tracked yet"
            body="Copy a product link from Amazon, Walmart, Best Buy, Target or eBay and paste it above. Sweep will watch the price and tell you when it drops."
            action={
              <Button
                label="Compare prices instead"
                onPress={() => router.push("/search")}
                variant="secondary"
              />
            }
          />
        }
        renderItem={({ item }) => {
          const drop = percentOff(item.product.price, item.product.listPrice);
          return (
            <View style={styles.cardWrap}>
              <ProductCard
                title={item.product.title}
                retailer={item.product.retailer}
                price={item.product.price}
                listPrice={item.product.listPrice}
                imageUrl={item.product.imageUrl}
                rating={item.product.rating}
                ratingCount={item.product.ratingCount}
                lastCheckedAt={item.product.lastCheckedAt}
                note={drop !== null && drop >= 20 ? `${drop}% below list — good time to buy` : null}
                onPress={() => router.push(`/product/${item.product.id}`)}
                action={
                  <Button
                    label="Remove"
                    onPress={() => onUntrack(item)}
                    variant="danger"
                    busy={removing === item.id}
                    compact
                  />
                }
              />
              {item.product.lastStatus && item.product.lastStatus !== "success" && (
                <Text style={styles.staleWarning}>
                  {item.product.lastStatus === "blocked"
                    ? "This store is blocking price checks right now — showing the last known price."
                    : "Last price check failed — showing the last known price."}
                </Text>
              )}
            </View>
          );
        }}
      />
    </Screen>
  );
}

/**
 * Sort key: how good a deal this is right now. Discount off list is the honest
 * signal we have on this screen — the deeper "% below historical average" needs
 * the full history, which lives on the detail screen.
 */
function dealScore(item: TrackedProduct): number {
  return percentOff(item.product.price, item.product.listPrice) ?? 0;
}

const styles = StyleSheet.create({
  limitRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  limitText: {
    color: colors.textSecondary,
    fontSize: type.label.fontSize,
    fontWeight: "600",
  },
  limitFull: {
    color: colors.warning,
    fontSize: type.caption.fontSize,
    fontWeight: "800",
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: "hidden",
  },
  list: { padding: spacing.md, gap: spacing.sm },
  emptyList: { flexGrow: 1 },
  cardWrap: { marginBottom: spacing.sm },
  staleWarning: {
    color: colors.warning,
    fontSize: type.caption.fontSize,
    paddingHorizontal: spacing.sm,
    paddingTop: 4,
  },
});
