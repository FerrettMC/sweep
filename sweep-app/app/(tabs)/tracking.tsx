// app/(tabs)/tracking.tsx
//
// Everything the user is watching, sorted by how good a deal each one is right
// now rather than by when it was added.

import AddByLink from "@/components/AddByLink";
import AddToListSheet, { type ListTarget } from "@/components/AddToListSheet";
import BudgetEntrySheet, { type EntryDraft } from "@/components/BudgetEntrySheet";
import ConfirmDialog from "@/components/ConfirmDialog";
import SweepSheet from "@/components/SweepSheet";
import ProductCard from "@/components/ProductCard";
import TrackedItemSheet from "@/components/TrackedItemSheet";
import {
  Button,
  EmptyState,
  ErrorBanner,
  Loading,
  Screen,
} from "@/components/ui";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { useTranslate } from "@/lib/i18n";
import { maybeAskForReview } from "@/lib/reviewPrompt";
import { storeListPhrase } from "@/lib/format";
import {
  ApiError,
  type Schedule,
  type TrackedProduct,
  getSchedule,
  getTrackedProducts,
  untrackProduct,
  getBudget,
  getBudgetPrefill,
} from "@/lib/api";
import { formatPrice, percentOff } from "@/lib/format";
import { useSweep } from "@/lib/useSweep";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";

export default function TrackingScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();
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
  const [listTarget, setListTarget] = useState<ListTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [boughtDraft, setBoughtDraft] = useState<EntryDraft | null>(null);
  const [budgetCategories, setBudgetCategories] = useState<string[]>([]);
  const [canCustomCategories, setCanCustomCategories] = useState(false);
  // Remembered so the "stop tracking it too?" prompt after logging knows which
  // tracked row to remove.
  const [boughtItem, setBoughtItem] = useState<TrackedProduct | null>(null);
  // The tracked row the "stop tracking too?" dialog is asking about.
  const [confirmUntrack, setConfirmUntrack] = useState<TrackedProduct | null>(null);
  const sweep = useSweep();

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

  /**
   * "I bought this" — opens the log sheet prefilled from the product.
   *
   * The prefill is a server call because the price and a category guess both
   * live there; if it fails we still open the sheet, just empty. Refusing to
   * log a purchase because a guess didn't load would be absurd.
   */
  async function openBought(item: TrackedProduct) {
    setBoughtItem(item);
    setBoughtDraft({
      amount: item.product.price,
      category: "Other",
      description: item.product.title,
      productId: item.product.id,
      productTitle: item.product.title,
    });

    try {
      const [prefill, budget] = await Promise.all([
        getBudgetPrefill(item.product.id),
        getBudget(),
      ]);
      setBudgetCategories(budget.availableCategories);
      setCanCustomCategories(budget.limits.canUseCustomCategories);
      setBoughtDraft({
        amount: prefill.amount,
        category: prefill.category,
        description: prefill.description,
        productId: item.product.id,
        productTitle: item.product.title,
      });
    } catch {
      // Keep the local draft above.
    }
  }

  /**
   * Once something is bought, watching its price is usually pointless — and a
   * tracking slot is a scarce thing on the free tier. Offered, never automatic:
   * people do track items they've already bought, to watch for a price-drop
   * refund window.
   */
  function offerUntrack(item: TrackedProduct) {
    setConfirmUntrack(item);
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
      {notice && <Text style={styles.notice}>{notice}</Text>}

      {limits && (
        <View style={styles.limitRow}>
          <Text style={styles.limitText}>
            {limits.used} of {limits.maxTrackedProducts} tracked
            {tier !== "free" ? ` · ${tier}` : ""}
          </Text>
          {atLimit && <Text style={styles.limitFull}>{t("tracking.limitReached")}</Text>}
        </View>
      )}

      <AddByLink
        disabled={atLimit}
        disabledReason={
          limits
            ? t("tracking.limitBody", { count: limits.maxTrackedProducts })
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

          // A moment the app has just been useful, which is the only kind
          // worth asking on. Fire-and-forget: it decides for itself whether
          // this is the right time, and stays silent when it isn't.
          void maybeAskForReview((tracked ?? []).length + (isNew ? 1 : 0));

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
            title={t("tracking.empty")}
            // Named Target, which Sweep doesn't support, and left out two
            // stores it does.
            body={t("tracking.emptyBody", { stores: storeListPhrase() })}
            action={
              <Button
                label={t("tracking.compareInstead")}
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
                actions={[
                  {
                    key: "list",
                    icon: "list-outline",
                    label: "List",
                    onPress: () =>
                      setListTarget({
                        retailer: item.product.retailer,
                        retailerId: item.product.retailerId,
                        title: item.product.title,
                        url: item.product.url,
                      }),
                  },
                  // Tracked items have real history, so the sale verdict here
                  // is far stronger than it can be for a cold search result.
                  sweep.available && {
                    key: "sweep",
                    icon: "sparkles",
                    label: "Sweep",
                    tone: "accent" as const,
                    onPress: () => sweep.sweep({ productId: item.product.id }),
                  },
                  {
                    key: "bought",
                    icon: "cart-outline",
                    label: "Bought",
                    onPress: () => openBought(item),
                  },
                  {
                    key: "edit",
                    icon: "options-outline",
                    label: "Edit",
                    busy: removing === item.id,
                    onPress: () => setEditing(item),
                  },
                ]}
              />
              {item.product.lastStatus &&
                item.product.lastStatus !== "success" && (
                  <Text style={styles.staleWarning}>
                    {item.product.lastStatus === "blocked"
                      ? t("tracking.storeBlocking")
                      : t("tracking.checkFailed")}
                  </Text>
                )}
            </View>
          );
        }}
      />
      <AddToListSheet
        product={listTarget}
        onClose={() => setListTarget(null)}
        onAdded={(name) => setNotice(`Added to ${name}.`)}
      />

      <BudgetEntrySheet
        draft={boughtDraft}
        categories={budgetCategories}
        canUseCustomCategories={canCustomCategories}
        onClose={() => setBoughtDraft(null)}
        onSaved={() => {
          const item = boughtItem;
          setNotice(t("tracking.addedToBudget"));
          if (item) offerUntrack(item);
        }}
      />

      <SweepSheet
        visible={sweep.open}
        busy={sweep.busy}
        result={sweep.result}
        error={sweep.error}
        remaining={sweep.quota?.remaining ?? null}
        onClose={sweep.close}
      />

      <ConfirmDialog
        content={
          confirmUntrack && {
            icon: "checkmark-circle",
            title: t("tracking.loggedIt"),
            body: t("tracking.stopToo"),
            subject: {
              title: confirmUntrack.product.title,
              imageUrl: confirmUntrack.product.imageUrl,
              caption: `Tracking since ${new Date(confirmUntrack.addedAt).toLocaleDateString(
                undefined,
                { month: "short", day: "numeric" },
              )}`,
            },
            confirmLabel: t("tracking.stopTracking"),
            cancelLabel: t("tracking.keepTracking"),
          }
        }
        onCancel={() => setConfirmUntrack(null)}
        onConfirm={() => {
          const item = confirmUntrack;
          setConfirmUntrack(null);
          if (item) void onUntrack(item);
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

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
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
    notice: {
      color: colors.success,
      fontSize: type.label.fontSize,
      fontWeight: "700",
      paddingHorizontal: spacing.md,
      paddingTop: spacing.xs,
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
