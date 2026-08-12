// app/(tabs)/tracking.tsx
//
// Everything the user is watching, sorted by how good a deal each one is right
// now rather than by when it was added.

import AddByLink from "@/components/AddByLink";
import ProductCard from "@/components/ProductCard";
import TrackedItemSheet from "@/components/TrackedItemSheet";
import {
  Button,
  EmptyState,
  ErrorBanner,
  Loading,
  Screen,
} from "@/components/ui";
import { colors, radius, spacing, type } from "@/constants/theme";
import {
  ApiError,
  type Schedule,
  type TrackedProduct,
  getSchedule,
  getTrackedProducts,
  untrackProduct,
} from "@/lib/api";
import { formatPrice, percentOff } from "@/lib/format";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";

export default function TrackingScreen() {
  const router = useRouter();

  const [tracked, setTracked] = useState<TrackedProduct[] | null>(null);
  const [limits, setLimits] = useState<{
    maxTrackedProducts: number;
    used: number;
  } | null>(null);
  const [tier, setTier] = useState("free");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [editing, setEditing] = useState<TrackedProduct | null>(null);
  const [schedule, setSchedule] = useState<Schedule | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await getTrackedProducts();
      setTracked(result.tracked);
      setLimits(result.limits);
      setTier(result.tier);
      setError(null);
      // Needed by the edit sheet: how many check times this plan allows, and
      // whether it uses fixed times at all.
      setSchedule(await getSchedule().catch(() => null));
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

  const sorted = [...(tracked ?? [])].sort(
    (a, b) => dealScore(b) - dealScore(a),
  );
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
        contentContainerStyle={
          sorted.length === 0 ? styles.emptyList : styles.list
        }
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
          // What's happened since THIS user started watching — the number that
          // actually answers "was tracking it worth it?". Retailer list price
          // is a marketing claim; this is measured.
          const since = movementSinceTracking(
            item.product.price,
            item.priceAtTracking,
          );
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
                note={since?.text ?? null}
                noteTone={since?.tone}
                onPress={() => router.push(`/product/${item.product.id}`)}
                action={
                  <Button
                    label="Edit"
                    onPress={() => setEditing(item)}
                    variant="secondary"
                    busy={removing === item.id}
                    compact
                  />
                }
              />
              {item.product.lastStatus &&
                item.product.lastStatus !== "success" && (
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
      <TrackedItemSheet
        item={editing}
        schedule={schedule}
        // Threshold editing is Pro and above; the server enforces it too.
        canSetThreshold={tier === "pro" || tier === "ultimate"}
        onClose={() => setEditing(null)}
        onChanged={load}
        onRemove={onUntrack}
      />
    </Screen>
  );
}

/**
 * Movement since this user started watching.
 *
 * ALWAYS shown when we have an anchor, including "no change" — because the
 * card also displays the retailer's own "23% off list" badge, and those two
 * numbers are easy to confuse. If you start tracking something already
 * discounted, the badge says 23% off while nothing has actually moved since1
 * you started. Saying so explicitly is the only way to tell them apart.
 */
function movementSinceTracking(
  current: number | null,
  atTracking: number | null,
): { text: string; tone: "good" | "bad" | "neutral" } | null {
  if (current === null || atTracking === null || atTracking <= 0) return null;

  const delta = atTracking - current;
  const percent = Math.round((Math.abs(delta) / atTracking) * 100);

  // Sub-1% movement rounds to 0% and would read as a contradiction.
  if (delta === 0 || percent < 1) {
    return {
      text: `Same as when you started (${formatPrice(atTracking)})`,
      tone: "neutral",
    };
  }

  return delta > 0
    ? {
        text: `Down ${formatPrice(delta)} (${percent}%) since you started`,
        tone: "good",
      }
    : {
        text: `Up ${formatPrice(-delta)} (${percent}%) since you started`,
        tone: "bad",
      };
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
