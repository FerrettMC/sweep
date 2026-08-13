// app/budget.tsx
//
// Where the month actually went.
//
// Scope is shopping spend, not household finance — this sits next to price
// tracking rather than competing with a real budget app. The most useful thing
// it can do that a standalone budget app can't is log a purchase straight from
// something you were already watching, so that path is a single tap.
//
// The screen answers three questions in order, which is why it's laid out this
// way: how much have I spent, against what budget, and on what.

import { useCallback, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import BudgetEntrySheet, { type EntryDraft } from "@/components/BudgetEntrySheet";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button, EmptyState, ErrorBanner, Loading, Screen } from "@/components/ui";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import {
  ApiError,
  type BudgetEntry,
  type BudgetMonth,
  deleteBudgetEntry,
  getBudget,
  setBudgetLimit,
} from "@/lib/api";
import { formatPrice, retailerLabel } from "@/lib/format";

/** Shift a "2026-08" string by n months. */
function shiftMonth(month: string, delta: number): string {
  const [year, index] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, index - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const [year, index] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, index - 1, 1));
  const now = new Date();
  const isThisYear = year === now.getUTCFullYear();
  return date.toLocaleDateString(undefined, {
    month: "long",
    ...(isThisYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

function thisMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default function BudgetScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<BudgetMonth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState("");
  // The entry the delete dialog is asking about.
  const [deleting, setDeleting] = useState<BudgetEntry | null>(null);

  const load = useCallback(
    async (target: string) => {
      try {
        const result = await getBudget(target);
        setData(result);
        setError(null);
      } catch (err) {
        const apiError = err as ApiError;
        setError(apiError.message);
        // A month past the plan's history window isn't a broken screen, so
        // keep whatever was on it rather than blanking out.
        if (apiError.code !== "HISTORY_LIMIT_REACHED") setData(null);
      }
    },
    [],
  );

  useFocusEffect(
    useCallback(() => {
      void load(month);
    }, [load, month]),
  );

  function goToMonth(delta: number) {
    const target = shiftMonth(month, delta);
    // Never navigate into the future — there's nothing there to see.
    if (delta > 0 && target > thisMonth()) return;
    setMonth(target);
  }

  async function onSaveBudget() {
    const cents = Math.round(Number(budgetInput.replace(/[^0-9.]/g, "")) * 100);
    try {
      await setBudgetLimit(null, Number.isFinite(cents) && cents > 0 ? cents : null);
      setEditingBudget(false);
      await load(month);
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  async function onDelete(entry: BudgetEntry) {
    setDeleting(null);
    try {
      await deleteBudgetEntry(entry.id);
      await load(month);
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  if (!data && !error) return <Loading />;

  const isCurrentMonth = month === thisMonth();
  const canGoBack =
    !data?.limits.earliestMonth || shiftMonth(month, -1) >= data.limits.earliestMonth;

  const spent = data?.total ?? 0;
  const budget = data?.budget ?? null;
  const percent = budget ? Math.min(spent / budget, 1) : 0;
  const overBudget = budget !== null && spent > budget;
  const nearBudget = budget !== null && !overBudget && spent >= budget * 0.8;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load(month);
              setRefreshing(false);
            }}
            tintColor={colors.accent}
          />
        }
      >
        {/* ---- month switcher ---- */}
        <View style={styles.monthRow}>
          <Pressable
            onPress={() => goToMonth(-1)}
            disabled={!canGoBack}
            hitSlop={8}
            style={[styles.monthArrow, !canGoBack && styles.monthArrowOff]}
          >
            <Ionicons name="chevron-back" size={18} color={colors.textSecondary} />
          </Pressable>
          <Text style={styles.monthLabel}>{monthLabel(month)}</Text>
          <Pressable
            onPress={() => goToMonth(1)}
            disabled={isCurrentMonth}
            hitSlop={8}
            style={[styles.monthArrow, isCurrentMonth && styles.monthArrowOff]}
          >
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </Pressable>
        </View>

        {error && <ErrorBanner message={error} />}

        {data && (
          <>
            {/* ---- the headline number ---- */}
            <View style={styles.hero}>
              <Text style={styles.heroLabel}>SPENT THIS MONTH</Text>
              <Text style={styles.heroValue}>{formatPrice(spent)}</Text>

              {budget !== null ? (
                <>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.barFill,
                        { width: `${percent * 100}%` },
                        overBudget && styles.barOver,
                        nearBudget && styles.barNear,
                      ]}
                    />
                  </View>
                  <View style={styles.budgetRow}>
                    <Text
                      style={[
                        styles.budgetText,
                        overBudget && styles.budgetOver,
                        nearBudget && styles.budgetNear,
                      ]}
                    >
                      {overBudget
                        ? `${formatPrice(spent - budget)} over your ${formatPrice(budget)} budget`
                        : `${formatPrice(budget - spent)} left of ${formatPrice(budget)}`}
                    </Text>
                    <Pressable
                      onPress={() => {
                        setBudgetInput((budget / 100).toFixed(2));
                        setEditingBudget(true);
                      }}
                      hitSlop={8}
                    >
                      <Text style={styles.budgetEdit}>Edit</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <Pressable
                  onPress={() => {
                    setBudgetInput("");
                    setEditingBudget(true);
                  }}
                  style={styles.setBudget}
                >
                  <Ionicons name="flag-outline" size={14} color={colors.accent} />
                  <Text style={styles.setBudgetText}>Set a monthly budget</Text>
                </Pressable>
              )}

              {editingBudget && (
                <View style={styles.budgetEditor}>
                  <TextInput
                    style={styles.budgetInput}
                    value={budgetInput}
                    onChangeText={setBudgetInput}
                    keyboardType="decimal-pad"
                    placeholder="Monthly budget"
                    placeholderTextColor={colors.textTertiary}
                    autoFocus
                  />
                  <Button label="Save" onPress={onSaveBudget} compact />
                  <Button
                    label="Cancel"
                    onPress={() => setEditingBudget(false)}
                    variant="secondary"
                    compact
                  />
                </View>
              )}
            </View>

            <Button label="Log a purchase" onPress={() => setDraft(emptyDraft())} />

            {/* ---- where it went ---- */}
            {data.categories.length > 0 && (
              <View style={styles.block}>
                <Text style={styles.blockTitle}>Where it went</Text>
                {data.categories.map((row) => {
                  const share = spent > 0 ? row.spent / spent : 0;
                  const over = row.limit !== null && row.spent > row.limit;
                  return (
                    <View key={row.category} style={styles.categoryRow}>
                      <View style={styles.categoryHead}>
                        <Text style={styles.categoryName}>{row.category}</Text>
                        <Text style={[styles.categoryAmount, over && styles.budgetOver]}>
                          {formatPrice(row.spent)}
                          {row.limit !== null && (
                            <Text style={styles.categoryLimit}>
                              {" "}
                              / {formatPrice(row.limit)}
                            </Text>
                          )}
                        </Text>
                      </View>
                      <View style={styles.categoryTrack}>
                        <View
                          style={[
                            styles.categoryFill,
                            {
                              width: `${
                                (row.limit !== null
                                  ? Math.min(row.spent / row.limit, 1)
                                  : share) * 100
                              }%`,
                            },
                            over && styles.barOver,
                          ]}
                        />
                      </View>
                    </View>
                  );
                })}

                {!data.limits.canSetCategoryLimits && (
                  <Pressable onPress={() => router.push("/plans")} style={styles.upsell}>
                    <Ionicons name="lock-closed" size={12} color={colors.textTertiary} />
                    <Text style={styles.upsellText}>
                      Set a limit per category with Pro
                    </Text>
                  </Pressable>
                )}
              </View>
            )}

            {/* ---- the entries ---- */}
            <View style={styles.block}>
              <Text style={styles.blockTitle}>
                {data.entries.length} {data.entries.length === 1 ? "purchase" : "purchases"}
              </Text>

              {data.entries.length === 0 ? (
                <EmptyState
                  title="Nothing logged yet"
                  body={
                    isCurrentMonth
                      ? "Log what you spend and it'll add up here. Bought something you were tracking? There's a button on it."
                      : "Nothing was logged this month."
                  }
                />
              ) : (
                data.entries.map((entry) => (
                  <Pressable
                    key={entry.id}
                    style={styles.entry}
                    onPress={() =>
                      setDraft({
                        id: entry.id,
                        amount: entry.amount,
                        category: entry.category,
                        description: entry.description ?? "",
                      })
                    }
                    onLongPress={() => setDeleting(entry)}
                  >
                    <View style={styles.entryBody}>
                      <Text style={styles.entryTitle} numberOfLines={1}>
                        {entry.description || entry.category}
                      </Text>
                      <Text style={styles.entryMeta}>
                        {entry.category}
                        {" · "}
                        {new Date(entry.spentAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                        {entry.product ? ` · ${retailerLabel(entry.product.retailer)}` : ""}
                      </Text>
                    </View>
                    {entry.product && (
                      <Pressable
                        onPress={() => Linking.openURL(entry.product!.url)}
                        hitSlop={8}
                        style={styles.entryLink}
                      >
                        <Ionicons name="open-outline" size={14} color={colors.textTertiary} />
                      </Pressable>
                    )}
                    <Text style={styles.entryAmount}>{formatPrice(entry.amount)}</Text>
                  </Pressable>
                ))
              )}
            </View>

            {data.entries.length > 0 && (
              <Text style={styles.hint}>Tap an entry to edit it, hold to delete.</Text>
            )}
          </>
        )}
      </ScrollView>

      <ConfirmDialog
        content={
          deleting && {
            icon: "trash-outline",
            destructive: true,
            title: "Delete this purchase?",
            // Says what it does to the number on the screen above, which is
            // the thing someone is actually deciding about.
            body: `Your ${monthLabel(month)} total drops to ${formatPrice(
              (data?.total ?? 0) - deleting.amount,
            )}.`,
            subject: {
              title: deleting.description || deleting.category,
              imageUrl: deleting.product?.imageUrl,
              caption: `${formatPrice(deleting.amount)} · ${deleting.category}`,
            },
            confirmLabel: "Delete",
            cancelLabel: "Keep it",
          }
        }
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && void onDelete(deleting)}
      />

      <BudgetEntrySheet
        draft={draft}
        categories={data?.availableCategories ?? []}
        canUseCustomCategories={data?.limits.canUseCustomCategories ?? false}
        onClose={() => setDraft(null)}
        onSaved={() => load(month)}
      />
    </Screen>
  );
}

function emptyDraft(): EntryDraft {
  return { amount: null, category: "Other", description: "" };
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },

    monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.md },
    monthArrow: {
      padding: 4,
      borderRadius: radius.sm,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    monthArrowOff: { opacity: 0.3 },
    monthLabel: {
      color: colors.textPrimary,
      fontSize: type.title.fontSize,
      fontWeight: "800",
      minWidth: 130,
      textAlign: "center",
    },

    hero: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      padding: spacing.md,
      gap: spacing.xs,
    },
    heroLabel: {
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
      fontWeight: "900",
      letterSpacing: 0.6,
    },
    heroValue: { color: colors.textPrimary, fontSize: 34, fontWeight: "900" },
    barTrack: {
      height: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceRaised,
      overflow: "hidden",
      marginTop: spacing.xs,
    },
    barFill: { height: "100%", borderRadius: radius.pill, backgroundColor: colors.success },
    barNear: { backgroundColor: colors.warning },
    barOver: { backgroundColor: colors.danger },
    budgetRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    budgetText: { color: colors.textSecondary, fontSize: type.label.fontSize },
    budgetNear: { color: colors.warning, fontWeight: "700" },
    budgetOver: { color: colors.danger, fontWeight: "700" },
    budgetEdit: { color: colors.accent, fontSize: type.label.fontSize, fontWeight: "700" },
    setBudget: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: spacing.xs },
    setBudgetText: { color: colors.accent, fontSize: type.label.fontSize, fontWeight: "700" },
    budgetEditor: { flexDirection: "row", gap: spacing.xs, alignItems: "center", marginTop: spacing.sm },
    budgetInput: {
      flex: 1,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: 9,
      color: colors.textPrimary,
      fontSize: type.body.fontSize,
    },

    block: { gap: spacing.sm },
    blockTitle: {
      color: colors.textPrimary,
      fontSize: type.body.fontSize,
      fontWeight: "800",
    },

    categoryRow: { gap: 4 },
    categoryHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
    categoryName: { color: colors.textSecondary, fontSize: type.label.fontSize },
    categoryAmount: { color: colors.textPrimary, fontSize: type.label.fontSize, fontWeight: "700" },
    categoryLimit: { color: colors.textTertiary, fontWeight: "400" },
    categoryTrack: {
      height: 5,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceRaised,
      overflow: "hidden",
    },
    categoryFill: { height: "100%", borderRadius: radius.pill, backgroundColor: colors.accent },

    upsell: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
    upsellText: { color: colors.textTertiary, fontSize: type.caption.fontSize },

    entry: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      padding: spacing.md,
    },
    entryBody: { flex: 1, gap: 1 },
    entryTitle: { color: colors.textPrimary, fontSize: type.body.fontSize, fontWeight: "600" },
    entryMeta: { color: colors.textTertiary, fontSize: type.caption.fontSize },
    entryLink: { padding: 2 },
    entryAmount: { color: colors.textPrimary, fontSize: type.body.fontSize, fontWeight: "800" },

    hint: {
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
      textAlign: "center",
    },
  });
