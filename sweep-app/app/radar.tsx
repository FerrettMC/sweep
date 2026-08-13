// app/radar.tsx
//
// Deal Radar — standing searches for things you haven't found yet.
//
// Tracking answers "tell me when THIS gets cheaper". A radar answers "tell me
// when ANYTHING matching this shows up under $X", which is the question you
// actually have before you've picked a listing.
//
// The free tier's radar is fully functional but runs by hand, so this screen
// has to make the refresh button feel like the point rather than a limitation —
// hence the remaining count sits on the button itself rather than hiding in a
// tier-limit notice somewhere below.

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
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button, EmptyState, ErrorBanner, Loading, Screen } from "@/components/ui";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import {
  ApiError,
  type RadarMatch,
  type RadarRefreshes,
  type SavedSearch,
  createRadar,
  deleteRadar,
  getRadar,
  refreshRadar,
} from "@/lib/api";
import { formatPrice, formatRelativeTime, retailerColor } from "@/lib/format";

export default function RadarScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const [searches, setSearches] = useState<SavedSearch[] | null>(null);
  const [limits, setLimits] = useState<{
    maxSavedSearches: number;
    used: number;
    intervalMinutes: number;
    autoChecks: boolean;
  } | null>(null);
  const [refreshes, setRefreshes] = useState<RadarRefreshes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);

  const [keyword, setKeyword] = useState("");
  const [target, setTarget] = useState("");
  const [creating, setCreating] = useState(false);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, RadarMatch[]>>({});
  const [unreachable, setUnreachable] = useState<Record<string, string[]>>({});
  const [deleting, setDeleting] = useState<SavedSearch | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await getRadar();
      setSearches(result.searches);
      setLimits(result.limits);
      setRefreshes(result.refreshes);
      setError(null);
    } catch (err) {
      setError((err as ApiError).message);
      setSearches([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function onCreate() {
    if (keyword.trim().length < 2) return;
    setCreating(true);
    setError(null);
    try {
      const cents = Math.round(Number(target.replace(/[^0-9.]/g, "")) * 100);
      await createRadar(
        keyword.trim(),
        Number.isFinite(cents) && cents > 0 ? cents : null,
      );
      setKeyword("");
      setTarget("");
      await load();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setCreating(false);
    }
  }

  async function onRefresh(search: SavedSearch) {
    setBusyId(search.id);
    setError(null);
    try {
      const result = await refreshRadar(search.id);
      setResults((current) => ({ ...current, [search.id]: result.matches }));
      setUnreachable((current) => ({ ...current, [search.id]: result.unreachable }));
      setRefreshes(result.refreshes);
      await load();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusyId(null);
    }
  }

  async function onDelete(search: SavedSearch) {
    setDeleting(null);
    try {
      await deleteRadar(search.id);
      await load();
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  if (searches === null) return <Loading />;

  const atLimit = limits ? limits.used >= limits.maxSavedSearches : false;
  const outOfRefreshes =
    refreshes?.remaining !== null && refreshes?.remaining !== undefined
      ? refreshes.remaining <= 0
      : false;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            onRefresh={async () => {
              setPulling(true);
              await load();
              setPulling(false);
            }}
            tintColor={colors.accent}
          />
        }
      >
        {/*
          Always visible rather than behind a tap. "How is this different from
          search?" is the first thought anyone has on this screen, and a radar
          nobody understands is a radar nobody sets up.
        */}
        <View style={styles.explainer}>
          <View style={styles.compareRow}>
            <Ionicons name="search" size={15} color={colors.textSecondary} />
            <Text style={styles.compareLabel}>Search</Text>
            <Text style={styles.compareText}>you look, once, right now</Text>
          </View>
          <View style={styles.compareRow}>
            <Ionicons name="radio-outline" size={15} color={colors.accent} />
            <Text style={[styles.compareLabel, styles.compareLabelOn]}>Radar</Text>
            <Text style={styles.compareText}>Sweep keeps looking, for weeks</Text>
          </View>

          <View style={styles.cadence}>
            <Ionicons
              name={limits?.autoChecks ? "time-outline" : "hand-left-outline"}
              size={14}
              color={colors.textTertiary}
            />
            <Text style={styles.cadenceText}>{cadenceCopy(limits, refreshes)}</Text>
          </View>
        </View>

        {error && <ErrorBanner message={error} />}

        {/* ---- create ---- */}
        {!atLimit ? (
          <View style={styles.createCard}>
            <TextInput
              style={styles.input}
              value={keyword}
              onChangeText={setKeyword}
              placeholder="What are you looking for?"
              placeholderTextColor={colors.textTertiary}
              maxLength={80}
            />
            <View style={styles.targetRow}>
              <View style={styles.targetField}>
                <Text style={styles.currency}>$</Text>
                <TextInput
                  style={styles.targetInput}
                  value={target}
                  onChangeText={setTarget}
                  placeholder="Target price (optional)"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="decimal-pad"
                />
              </View>
              <Button
                label="Watch"
                onPress={onCreate}
                busy={creating}
                disabled={keyword.trim().length < 2}
                compact
              />
            </View>
          </View>
        ) : (
          <Pressable style={styles.limitCard} onPress={() => router.push("/plans")}>
            <Ionicons name="lock-closed" size={14} color={colors.accent} />
            <Text style={styles.limitText}>
              You're watching {limits?.maxSavedSearches}{" "}
              {limits?.maxSavedSearches === 1 ? "search" : "searches"} — the most
              your plan allows. Tap to see the others.
            </Text>
          </Pressable>
        )}

        {searches.length === 0 ? (
          <EmptyState
            title="Nothing on the radar"
            body="Add something above — 'airpods pro' under $180, say — and Sweep will look for it across every store."
          />
        ) : (
          searches.map((search) => {
            const matches = results[search.id];
            const stores = unreachable[search.id] ?? [];
            return (
              <View key={search.id} style={styles.card}>
                <View style={styles.cardHead}>
                  <View style={styles.cardText}>
                    <Text style={styles.keyword}>{search.keyword}</Text>
                    <Text style={styles.meta}>
                      {search.targetPrice !== null
                        ? `under ${formatPrice(search.targetPrice)}`
                        : "any notable price"}
                      {search.lastCheckedAt
                        ? ` · checked ${formatRelativeTime(search.lastCheckedAt)}`
                        : " · not checked yet"}
                    </Text>
                  </View>
                  <Pressable onPress={() => setDeleting(search)} hitSlop={10}>
                    <Ionicons name="close" size={16} color={colors.textTertiary} />
                  </Pressable>
                </View>

                {search.lastBestPrice !== null && (
                  <Text style={styles.best}>
                    Best seen: {formatPrice(search.lastBestPrice)}
                  </Text>
                )}

                <Pressable
                  onPress={() => onRefresh(search)}
                  disabled={busyId === search.id || outOfRefreshes}
                  style={({ pressed }) => [
                    styles.refresh,
                    pressed && styles.pressed,
                    (busyId === search.id || outOfRefreshes) && styles.refreshOff,
                  ]}
                >
                  <Ionicons
                    name={busyId === search.id ? "hourglass-outline" : "refresh"}
                    size={14}
                    color={colors.accent}
                  />
                  <Text style={styles.refreshText}>
                    {busyId === search.id
                      ? "Checking every store…"
                      : outOfRefreshes
                        ? "No refreshes left today"
                        : "Refresh"}
                  </Text>
                  {refreshes?.remaining !== null &&
                    refreshes?.remaining !== undefined &&
                    busyId !== search.id && (
                      <Text style={styles.refreshCount}>
                        {refreshes.remaining} left
                      </Text>
                    )}
                </Pressable>

                {matches !== undefined && (
                  <View style={styles.matches}>
                    {matches.length === 0 ? (
                      <Text style={styles.noMatch}>
                        Nothing under your target right now.
                      </Text>
                    ) : (
                      matches.slice(0, 5).map((match) => (
                        <Pressable
                          key={match.url}
                          style={({ pressed }) => [styles.match, pressed && styles.pressed]}
                          onPress={() => Linking.openURL(match.url)}
                        >
                          <View
                            style={[
                              styles.dot,
                              { backgroundColor: retailerColor(colors, match.retailer) },
                            ]}
                          />
                          <View style={styles.matchBody}>
                            <Text style={styles.matchTitle} numberOfLines={1}>
                              {match.title}
                            </Text>
                            <Text style={styles.matchStore}>{match.retailerLabel}</Text>
                          </View>
                          <Text style={styles.matchPrice}>{formatPrice(match.price)}</Text>
                          <Ionicons
                            name="open-outline"
                            size={13}
                            color={colors.textTertiary}
                          />
                        </Pressable>
                      ))
                    )}
                    {stores.length > 0 && (
                      <Text style={styles.unreachable}>
                        Couldn't reach {stores.join(", ")} this time.
                      </Text>
                    )}
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

      <ConfirmDialog
        content={
          deleting && {
            icon: "trash-outline",
            destructive: true,
            title: "Stop watching this?",
            body: "Sweep will no longer look for it.",
            subject: {
              title: deleting.keyword,
              caption:
                deleting.targetPrice !== null
                  ? `under ${formatPrice(deleting.targetPrice)}`
                  : "any notable price",
            },
            confirmLabel: "Delete",
            cancelLabel: "Keep it",
          }
        }
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && void onDelete(deleting)}
      />
    </Screen>
  );
}

/**
 * How often this user's radars actually run, in their own terms.
 *
 * "Up to" throughout, and not as hedging: radars back off when they keep
 * finding nothing, exactly like tracked products do, so the interval is a
 * ceiling rather than a promise.
 */
function cadenceCopy(
  limits: { autoChecks: boolean; intervalMinutes: number } | null,
  refreshes: RadarRefreshes | null,
): string {
  if (!limits) return "";

  if (limits.autoChecks) {
    const hours = Math.round(limits.intervalMinutes / 60);
    return `Sweep re-runs these on its own, up to every ${hours} hours, and notifies you when something beats the best price it has found so far.`;
  }

  const allowance =
    refreshes?.limit === null || refreshes?.limit === undefined
      ? "whenever you like"
      : `${refreshes.limit} times a day`;
  return `On your plan radars run when you tap Refresh — ${allowance}. Pro and Ultimate re-run them in the background and send a notification.`;
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
    explainer: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      padding: spacing.md,
      gap: 7,
    },
    compareRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    compareLabel: {
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
      fontWeight: "800",
      width: 52,
    },
    compareLabelOn: { color: colors.accent },
    compareText: { flex: 1, color: colors.textSecondary, fontSize: type.label.fontSize },
    cadence: {
      flexDirection: "row",
      gap: spacing.sm,
      alignItems: "flex-start",
      marginTop: spacing.xs,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.surfaceBorder,
    },
    cadenceText: {
      flex: 1,
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
      lineHeight: 16,
    },

    createCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      padding: spacing.sm,
      gap: spacing.sm,
    },
    input: {
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: 11,
      color: colors.textPrimary,
      fontSize: type.body.fontSize,
    },
    targetRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
    targetField: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
    },
    currency: { color: colors.textSecondary, fontSize: type.body.fontSize, fontWeight: "800" },
    targetInput: {
      flex: 1,
      color: colors.textPrimary,
      fontSize: type.body.fontSize,
      paddingVertical: 11,
    },

    limitCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.accentMuted,
      padding: spacing.md,
    },
    limitText: { flex: 1, color: colors.textSecondary, fontSize: type.label.fontSize, lineHeight: 18 },

    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      padding: spacing.md,
      gap: spacing.sm,
    },
    cardHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
    cardText: { flex: 1, gap: 2 },
    keyword: { color: colors.textPrimary, fontSize: type.body.fontSize, fontWeight: "800" },
    meta: { color: colors.textTertiary, fontSize: type.caption.fontSize },
    best: { color: colors.success, fontSize: type.label.fontSize, fontWeight: "700" },

    refresh: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      borderWidth: 1,
      borderColor: colors.accent,
      backgroundColor: colors.accentMuted,
      borderRadius: radius.md,
      paddingVertical: 10,
    },
    refreshOff: { opacity: 0.5 },
    pressed: { opacity: 0.7 },
    refreshText: { color: colors.accent, fontSize: type.label.fontSize, fontWeight: "800" },
    refreshCount: { color: colors.accent, fontSize: type.caption.fontSize, opacity: 0.8 },

    matches: { gap: 6, marginTop: 2 },
    noMatch: { color: colors.textTertiary, fontSize: type.label.fontSize },
    match: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: colors.background,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      padding: spacing.sm,
    },
    dot: { width: 7, height: 7, borderRadius: radius.pill },
    matchBody: { flex: 1, gap: 1 },
    matchTitle: { color: colors.textPrimary, fontSize: type.label.fontSize },
    matchStore: { color: colors.textTertiary, fontSize: type.caption.fontSize },
    matchPrice: { color: colors.textPrimary, fontSize: type.label.fontSize, fontWeight: "800" },
    unreachable: { color: colors.textTertiary, fontSize: type.caption.fontSize },
  });
