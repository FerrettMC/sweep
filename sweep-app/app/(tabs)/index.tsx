// app/(tabs)/index.tsx
//
// Home — the landing screen, and the app's pitch in one view.
//
// Deliberately led by SEARCH rather than by tracking. Price tracking is a
// commodity — Keepa and CamelCamelCamel have done it for years — so opening on
// a list of tracked items would frame Sweep as a worse version of something
// free. Comparing every store in one query is the part they don't do, so it
// gets the hero slot and tracking sits below it as a supporting feature.

import { useCallback, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Loading, Screen, SectionTitle } from "@/components/ui";
import { colors, radius, spacing, type } from "@/constants/theme";
import {
  type TrackedProduct,
  getNotificationStatus,
  getQuota,
  getTrackedProducts,
} from "@/lib/api";
import {
  formatPrice,
  percentOff,
  pluralize,
  retailerColor,
  retailerLabel,
} from "@/lib/format";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

const TIER_LABEL: Record<string, string> = {
  free: "Free",
  pro: "Pro",
  ultimate: "Ultimate",
};

export default function HomeScreen() {
  const router = useRouter();

  const [tracked, setTracked] = useState<TrackedProduct[]>([]);
  const [tier, setTier] = useState("free");
  const [searchesLeft, setSearchesLeft] = useState<number | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [pushOn, setPushOn] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    // Every one of these is allowed to fail independently — Home should still
    // render something useful if one endpoint is down.
    const [products, quota, push] = await Promise.all([
      getTrackedProducts().catch(() => null),
      getQuota().catch(() => null),
      getNotificationStatus().catch(() => null),
    ]);

    if (products) {
      setTracked(products.tracked);
    }
    if (quota) {
      setTier(quota.tier);
      setSearchesLeft(quota.quota.remaining);
      setIsGuest(quota.isGuest);
    }
    setPushOn(push?.registered ?? null);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (loading) return <Loading />;

  // The single most useful fact on this screen: the best deal you're currently
  // sitting on. If nothing's tracked, that space becomes the call to action.
  const best = [...tracked]
    .map((t) => ({ item: t, off: percentOff(t.product.price, t.product.listPrice) ?? 0 }))
    .sort((a, b) => b.off - a.off)[0];

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
      >
        {/* ---- who we are ---- */}
        <View style={styles.brand}>
          <Text style={styles.brandName}>Sweep</Text>
          <Text style={styles.brandTagline}>Your online shopping buddy</Text>
        </View>

        {/* ---- the pitch: one search, every store ---- */}
        <Pressable
          style={({ pressed }) => [styles.searchHero, pressed && styles.pressed]}
          onPress={() => router.push("/search")}
        >
          <View style={styles.searchHeroTop}>
            <Ionicons name="search" size={20} color={colors.accent} />
            <Text style={styles.searchHeroTitle}>What are you shopping for?</Text>
          </View>
          <Text style={styles.searchHeroBody}>
            Search once and see Amazon, Walmart, Best Buy, eBay, Newegg and ASOS
            side by side — so you know who's actually cheapest before you buy.
          </Text>
          <View style={styles.searchHeroFooter}>
            <View style={styles.storeDots}>
              {(["amazon", "walmart", "bestbuy", "ebay", "newegg", "asos"] as const).map((r) => (
                <View
                  key={r}
                  style={[styles.storeDot, { backgroundColor: retailerColor(r) }]}
                />
              ))}
            </View>
            <Text style={styles.searchHeroMeta}>
              {searchesLeft === null
                ? "5 stores, one search"
                : `${pluralize(searchesLeft, "search")} left today`}
            </Text>
          </View>
        </Pressable>

        {/* ---- what you're watching, kept secondary ---- */}
        {best && best.item.product.price !== null ? (
          <Pressable
            style={({ pressed }) => [styles.watchCard, pressed && styles.pressed]}
            onPress={() => router.push(`/product/${best.item.product.id}`)}
          >
            <View style={styles.watchLeft}>
              <Text style={styles.watchLabel}>
                {best.off >= 20 ? "BIGGEST DROP YOU'RE WATCHING" : "YOU'RE WATCHING"}
              </Text>
              <Text style={styles.watchTitle} numberOfLines={1}>
                {best.item.product.title}
              </Text>
              <View style={styles.watchPriceRow}>
                <Text style={styles.watchPrice}>
                  {formatPrice(best.item.product.price)}
                </Text>
                {best.off > 0 && (
                  <Text style={styles.watchOff}>{best.off}% off</Text>
                )}
                <Text style={styles.watchRetailer}>
                  {retailerLabel(best.item.product.retailer)}
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </Pressable>
        ) : (
          <Pressable
            style={({ pressed }) => [styles.watchEmpty, pressed && styles.pressed]}
            onPress={() => router.push("/tracking")}
          >
            <Ionicons name="pricetag-outline" size={18} color={colors.textSecondary} />
            <Text style={styles.watchEmptyText}>
              Found something? Paste its link to watch the price.
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </Pressable>
        )}

        {/* ---- things that need fixing ---- */}
        {(pushOn === false || isGuest) && (
          <View style={styles.section}>
            <SectionTitle>Needs attention</SectionTitle>

            {isGuest && (
              <ActionCard
                icon="person-add-outline"
                tone="accent"
                title="Create an account"
                body="Guests get one search a day and can't track prices."
                onPress={() => router.push("/auth")}
              />
            )}

            {pushOn === false && !isGuest && (
              <ActionCard
                icon="notifications-off-outline"
                tone="warning"
                title="Price alerts are off"
                body="You won't hear about a drop while it's still live."
                onPress={() => router.push("/profile")}
              />
            )}
          </View>
        )}

        {/* ---- everything that isn't a tab ---- */}
        <View style={styles.section}>
          <SectionTitle>Shortcuts</SectionTitle>
          <View style={styles.shortcutGrid}>
            <Shortcut
              icon="wallet-outline"
              label="Budget"
              hint="Track spending"
              onPress={() => router.push("/budget")}
            />
            <Shortcut icon="list-outline" label="Lists" hint="Gift & wishlists" soon />
            <Shortcut
              icon="trophy-outline"
              label="Leaderboard"
              hint="XP & ranks"
              onPress={() => router.push("/leaderboard")}
            />
            <Shortcut
              icon="person-circle-outline"
              label="Profile"
              hint="Account & stores"
              onPress={() => router.push("/profile")}
            />
          </View>
        </View>

        {/* ---- plan ---- */}
        <Pressable
          style={({ pressed }) => [styles.planCard, pressed && styles.pressed]}
          onPress={() => router.push("/plans")}
        >
          <View style={styles.planLeft}>
            <Text style={styles.planLabel}>YOUR PLAN</Text>
            <Text style={styles.planTier}>{TIER_LABEL[tier] ?? "Free"}</Text>
          </View>
          {tier === "free" ? (
            <View style={styles.upgradePill}>
              <Text style={styles.upgradeText}>See upgrades</Text>
            </View>
          ) : (
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          )}
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

function ActionCard({
  icon,
  title,
  body,
  tone,
  onPress,
}: {
  icon: IoniconName;
  title: string;
  body: string;
  tone: "accent" | "warning";
  onPress: () => void;
}) {
  const accentColor = tone === "warning" ? colors.warning : colors.accent;
  return (
    <Pressable
      style={({ pressed }) => [
        styles.actionCard,
        { borderColor: accentColor },
        pressed && styles.pressed,
      ]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={20} color={accentColor} />
      <View style={styles.actionText}>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionBody}>{body}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
    </Pressable>
  );
}

function Shortcut({
  icon,
  label,
  hint,
  onPress,
  soon,
}: {
  icon: IoniconName;
  label: string;
  hint: string;
  onPress?: () => void;
  soon?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.shortcut,
        soon && styles.shortcutSoon,
        pressed && !soon && styles.pressed,
      ]}
      onPress={onPress}
      disabled={soon}
    >
      <Ionicons
        name={icon}
        size={22}
        color={soon ? colors.textTertiary : colors.accent}
      />
      <Text style={[styles.shortcutLabel, soon && styles.shortcutLabelSoon]}>{label}</Text>
      <Text style={styles.shortcutHint}>{soon ? "Coming soon" : hint}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl },
  pressed: { opacity: 0.75 },

  brand: { gap: 1 },
  brandName: {
    color: colors.textPrimary,
    fontSize: type.display.fontSize,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  brandTagline: {
    color: colors.accent,
    fontSize: type.body.fontSize,
    fontWeight: "600",
  },

  searchHero: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accentMuted,
    padding: spacing.md,
    gap: spacing.sm,
  },
  searchHeroTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  searchHeroTitle: {
    color: colors.textPrimary,
    fontSize: type.heading.fontSize,
    fontWeight: "800",
    flex: 1,
  },
  searchHeroBody: {
    color: colors.textSecondary,
    fontSize: type.label.fontSize,
    lineHeight: 19,
  },
  searchHeroFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.xs,
  },
  storeDots: { flexDirection: "row", gap: 5 },
  storeDot: { width: 9, height: 9, borderRadius: radius.pill },
  searchHeroMeta: {
    color: colors.textTertiary,
    fontSize: type.caption.fontSize,
    fontWeight: "600",
  },

  watchCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    padding: spacing.md,
  },
  watchLeft: { flex: 1, gap: 2 },
  watchLabel: {
    color: colors.textTertiary,
    fontSize: type.caption.fontSize,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  watchTitle: {
    color: colors.textPrimary,
    fontSize: type.body.fontSize,
    fontWeight: "600",
  },
  watchPriceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.sm,
    marginTop: 1,
  },
  watchPrice: { color: colors.textPrimary, fontSize: 17, fontWeight: "800" },
  watchOff: {
    color: colors.success,
    fontSize: type.caption.fontSize,
    fontWeight: "800",
  },
  watchRetailer: { color: colors.textTertiary, fontSize: type.caption.fontSize },

  watchEmpty: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    borderStyle: "dashed",
    padding: spacing.md,
  },
  watchEmptyText: {
    color: colors.textSecondary,
    fontSize: type.label.fontSize,
    flex: 1,
  },

  section: { gap: spacing.xs },

  actionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  actionText: { flex: 1, gap: 1 },
  actionTitle: {
    color: colors.textPrimary,
    fontSize: type.body.fontSize,
    fontWeight: "700",
  },
  actionBody: { color: colors.textSecondary, fontSize: type.caption.fontSize },

  shortcutGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  shortcut: {
    // Two per row, accounting for the gap between them.
    width: "48%",
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    padding: spacing.md,
    gap: 2,
  },
  shortcutSoon: { opacity: 0.55 },
  shortcutLabel: {
    color: colors.textPrimary,
    fontSize: type.body.fontSize,
    fontWeight: "700",
    marginTop: spacing.xs,
  },
  shortcutLabelSoon: { color: colors.textSecondary },
  shortcutHint: { color: colors.textTertiary, fontSize: type.caption.fontSize },

  planCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    padding: spacing.md,
  },
  planLeft: { gap: 2 },
  planLabel: {
    color: colors.textTertiary,
    fontSize: type.caption.fontSize,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  planTier: {
    color: colors.textPrimary,
    fontSize: type.heading.fontSize,
    fontWeight: "800",
  },
  upgradePill: {
    backgroundColor: colors.accentMuted,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  upgradeText: {
    color: colors.accent,
    fontSize: type.caption.fontSize,
    fontWeight: "800",
  },
});
