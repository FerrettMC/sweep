// app/(tabs)/search.tsx
//
// Compiled multi-site search — one query, results from every retailer side by
// side, so you can see who's actually cheapest before buying.
//
// This screen is comparison ONLY. Tracking happens by pasting a link on the
// Tracking tab, which costs no search quota — see components/AddByLink.tsx.
//
// The quota counter is deliberately prominent: a search is the app's one
// genuinely scarce resource, and a user should never spend their last one
// without knowing it was their last one.

import { useCallback, useEffect, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSweep } from "@/lib/useSweep";
import { useFocusEffect, useRouter } from "expo-router";
import AddToListSheet, { type ListTarget } from "@/components/AddToListSheet";
import SweepSheet from "@/components/SweepSheet";
import CompareTray from "@/components/CompareTray";
import WhyLimitedSheet from "@/components/WhyLimitedSheet";
import HighlightCard from "@/components/HighlightCard";
import ProductCard from "@/components/ProductCard";
import { Button, EmptyState, ErrorBanner, Loading, Screen } from "@/components/ui";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import {
  ApiError,
  type Highlight,
  type Quota,
  type RetailerResult,
  type SearchProduct,
  claimRewardedSearch,
  getAmazonSearchResult,
  getQuota,
  search as runSearch,
} from "@/lib/api";
import {
  ADS_ENABLED,
  countActionAndMaybeShowInterstitial,
  preloadInterstitial,
  showRewardedAd,
} from "@/lib/ads";
import { pluralize, retailerColor } from "@/lib/format";
import { supabase } from "@/lib/supabase";

interface Section {
  title: string;
  retailer: string;
  status: RetailerResult["status"] | "pending";
  message: string | null;
  data: SearchProduct[];
}

/** How often to ask whether Amazon has finished. */
const AMAZON_POLL_MS = 4000;
/** Give up after this. Bright Data's free tier can genuinely take ~3 minutes. */
const AMAZON_MAX_WAIT_MS = 210_000;

export default function SearchScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();

  const [keyword, setKeyword] = useState("");
  const [sections, setSections] = useState<Section[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [amazonJobId, setAmazonJobId] = useState<string | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [skipped, setSkipped] = useState<{ retailer: string; label: string }[]>([]);

  // Starred results, kept as a map so they survive a new search — that's what
  // makes comparing across two different queries possible.
  const [starred, setStarred] = useState<Record<string, SearchProduct>>({});
  const [watchingAd, setWatchingAd] = useState(false);
  const [showAds, setShowAds] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const [listTarget, setListTarget] = useState<ListTarget | null>(null);
  const sweep = useSweep();
  // Null until a search tells us what this tier allows. Persisted so the choice
  // survives a restart — it's a preference, not a per-search decision.
  const [resultsRange, setResultsRange] = useState<{ min: number; max: number } | null>(null);
  const [resultsPref, setResultsPref] = useState<number | null>(null);

  // Bumped on each new search so an in-flight poll from the previous one can
  // tell it's stale and stop writing results into the current view.
  const searchGeneration = useRef(0);
  const listRef = useRef<SectionList<SearchProduct, Section>>(null);

  // useFocusEffect, not useEffect: the quota changes while the user is on other
  // screens (it resets at midnight, and tracking flows can spend one), so the
  // counter has to re-read every time this screen comes forward.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      getQuota()
        .then((result) => {
          if (cancelled) return;
          setQuota(result.quota);
          setIsGuest(result.isGuest);
          // Only the free tier is ad-supported; canWatchAd already encodes
          // that, so reuse it rather than duplicating the tier rules here.
          setShowAds(result.tier === "free" && !result.isGuest);
          // Known before the first search, so the picker can be chosen from
          // rather than discovered afterwards.
          const range = result.resultsRange;
          if (range && range.min !== range.max) {
            setResultsRange(range);
            setResultsPref((current) => current ?? range.default);
          } else {
            setResultsRange(null);
          }
          if (result.tier === "free" && !result.isGuest) preloadInterstitial();
        })
        .catch(() => {
          // A quota read failing shouldn't block searching — the server
          // enforces the real limit regardless of what we managed to display.
        });

      return () => {
        cancelled = true;
      };
    }, []),
  );

  // Takes an explicit count so changing the picker can re-run immediately,
  // without waiting for the state update to land.
  async function onSearch(overrideResults?: number) {
    const trimmed = keyword.trim();
    if (!trimmed || searching) return;

    setSearching(true);
    setError(null);
    setNotice(null);
    searchGeneration.current += 1;
    setAmazonJobId(null);
    setHighlights([]);
    setSkipped([]);

    try {
      const response = await runSearch(
        trimmed,
        undefined,
        overrideResults ?? resultsPref ?? undefined,
      );
      setQuota(response.quota);

      const fast: Section[] = response.results.map((result) => ({
        title: result.label,
        retailer: result.retailer,
        status: result.status,
        message: result.message,
        data: result.products,
      }));

      // Amazon goes last and starts as pending — it's fetched out-of-band
      // because Bright Data's free tier can take minutes.
      // A new search reuses the same scrolled list, so without this you land
      // partway down the previous results and think nothing happened.
      listRef.current?.getScrollResponder()?.scrollTo({ y: 0, animated: false });

      setHighlights(response.highlights);
      setSkipped(response.skipped);

      // A finished search is the natural interstitial moment — the user has
      // what they asked for, so an interruption here doesn't block anything.
      // Paid tiers pass showAds=false and never see one.
      countActionAndMaybeShowInterstitial(showAds);
      setSections(
        response.amazonJobId
          ? [
              ...fast,
              {
                title: "Amazon",
                retailer: "amazon",
                status: "pending",
                message: null,
                data: [],
              },
            ]
          : fast,
      );
      setAmazonJobId(response.amazonJobId);
    } catch (err) {
      const apiError = err as ApiError;
      setError(apiError.message);
      if (apiError.code === "SEARCH_LIMIT_REACHED") {
        setQuota(apiError.body?.quota ?? null);
      }
    } finally {
      setSearching(false);
    }
  }

  // Poll the Amazon leg until it lands, fails, or we give up. Runs as an
  // effect so it's torn down on unmount and on every new search.
  useEffect(() => {
    if (!amazonJobId) return;

    const generation = searchGeneration.current;
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    function finish(status: Section["status"], products: SearchProduct[], message: string | null) {
      // A stale poll must not overwrite results from a newer search.
      if (stopped || searchGeneration.current !== generation) return;
      setSections((current) =>
        (current ?? []).map((section) =>
          section.retailer === "amazon"
            ? { ...section, status, data: products, message }
            : section,
        ),
      );
      setAmazonJobId(null);
    }

    async function poll() {
      if (stopped || searchGeneration.current !== generation) return;

      try {
        const result = await getAmazonSearchResult(amazonJobId!);

        if (result.status === "pending") {
          if (Date.now() - startedAt > AMAZON_MAX_WAIT_MS) {
            finish("failed", [], "Amazon took too long — try again later.");
            return;
          }
          timer = setTimeout(poll, AMAZON_POLL_MS);
          return;
        }

        finish(
          result.status === "success" ? "success" : result.status,
          result.products,
          result.message,
        );
      } catch (err) {
        const apiError = err as ApiError;
        // A dropped job (server restart) or a network blip — either way there's
        // nothing to keep waiting for.
        finish(
          "failed",
          [],
          apiError.code === "SEARCH_JOB_NOT_FOUND"
            ? "Amazon results expired — search again."
            : "Couldn't load Amazon results.",
        );
      }
    }

    timer = setTimeout(poll, AMAZON_POLL_MS);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [amazonJobId]);

  const productKey = (p: SearchProduct) => `${p.retailer}:${p.retailerId}`;

  function toggleStar(product: SearchProduct) {
    setStarred((current) => {
      const key = productKey(product);
      if (current[key]) {
        const { [key]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [key]: product };
    });
  }

  async function onWatchAd() {
    setWatchingAd(true);
    setError(null);
    setNotice(null);

    try {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user.id;
      if (!userId) {
        setError("Sign in to unlock extra searches.");
        return;
      }

      const outcome = await showRewardedAd(userId);

      if (outcome.status === "dismissed") {
        setNotice("Ad closed early — no extra search this time.");
        return;
      }

      if (outcome.status === "failed") {
        // In development there's no real ad inventory, so fall back to the
        // dev-only endpoint rather than blocking the flow entirely.
        if (__DEV__) {
          const { quota: updated } = await claimRewardedSearch();
          setQuota(updated);
          setNotice("Extra search unlocked (dev — no real ad).");
          return;
        }
        setError(`Couldn't load an ad: ${outcome.reason}`);
        return;
      }

      // Reward earned. The server credits it from AdMob's verification
      // callback, which can land a moment after the ad closes — so poll the
      // quota briefly rather than assuming it's already there.
      setNotice("Ad finished — unlocking your search…");
      const updated = await waitForBonus(quota?.bonus ?? 0);

      if (updated) {
        setQuota(updated);
        setNotice("Extra search unlocked.");
      } else {
        setNotice("Reward is taking a moment to land. Pull to refresh shortly.");
      }
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setWatchingAd(false);
    }
  }

  /**
   * Poll until the bonus count goes up. AdMob's callback hits our server
   * independently of the app, so there's a short window where the ad is done
   * but the credit hasn't arrived.
   */
  async function waitForBonus(previousBonus: number): Promise<Quota | null> {
    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const result = await getQuota();
        if (result.quota.bonus > previousBonus) return result.quota;
      } catch {
        // Keep trying — a transient failure here isn't worth surfacing.
      }
    }
    return null;
  }

  const outOfSearches = quota !== null && quota.remaining <= 0;

  return (
    <Screen>
      <View style={styles.searchBar}>
        <TextInput
          style={styles.input}
          placeholder="Search every store at once…"
          placeholderTextColor={colors.textTertiary}
          value={keyword}
          onChangeText={setKeyword}
          onSubmitEditing={() => void onSearch()}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button
          label="Search"
          onPress={() => void onSearch()}
          busy={searching}
          disabled={!keyword.trim() || outOfSearches}
          compact
        />
      </View>

      {/*
        Above the results and outside them: this is a setting for the search
        you are about to run. Shown only when the tier has a real choice — a
        picker with one option is a label that looks tappable.
      */}
      {resultsRange && (
        <View style={styles.resultsPicker}>
          <Text style={styles.resultsLabel}>Results per store</Text>
          <View style={styles.resultsOptions}>
            {Array.from(
              { length: resultsRange.max - resultsRange.min + 1 },
              (_, i) => resultsRange.min + i,
            ).map((count) => {
              const on = (resultsPref ?? resultsRange.min) === count;
              return (
                <Pressable
                  key={count}
                  onPress={() => setResultsPref(count)}
                  style={[styles.resultsChip, on && styles.resultsChipOn]}
                >
                  <Text style={[styles.resultsChipText, on && styles.resultsChipTextOn]}>
                    {count}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      {quota && (
        <View style={styles.quotaRow}>
          <Pressable
            onPress={() => setShowWhy(true)}
            hitSlop={8}
            style={styles.quotaTextRow}
          >
            <Text style={styles.quotaText}>
              {quota.remaining > 0
                ? `${pluralize(quota.remaining, "search")} left today`
                : "No searches left today"}
              {quota.bonus > 0 ? ` · +${quota.bonus} from ads` : ""}
            </Text>
            <Ionicons
              name="help-circle-outline"
              size={15}
              color={colors.textTertiary}
            />
          </Pressable>
          {/*
            Three states, not two. Silently hiding the button once the daily ad
            cap is hit looks identical to the feature being broken, so say why.
          */}
          {outOfSearches && quota.canWatchAd && ADS_ENABLED && (
            <Button
              label="Watch ad for +1"
              onPress={onWatchAd}
              busy={watchingAd}
              variant="secondary"
              compact
            />
          )}
          {outOfSearches && !quota.canWatchAd && !isGuest && (
            <Text style={styles.capNote}>No more ad searches today</Text>
          )}
        </View>
      )}

      {notice && <Text style={styles.notice}>{notice}</Text>}

      {error && <ErrorBanner message={error} onRetry={outOfSearches ? undefined : onSearch} />}

      {isGuest && (
        <View style={styles.guestBanner}>
          <Text style={styles.guestText}>
            You're browsing as a guest — one search a day. Sign up to track
            prices and get drop alerts.
          </Text>
          <Button
            label="Create account"
            onPress={() => router.push("/auth")}
            variant="secondary"
            compact
          />
        </View>
      )}

      {searching && !sections && <Loading label="Checking every store…" />}

      {!searching && !sections && (
        <EmptyState
          title="One search, every store"
          body="Search once and Sweep checks Amazon, Walmart, Target, Best Buy and eBay together, so you can see who's actually cheapest before you buy."
        />
      )}

      {sections && (
        <SectionList
          ref={listRef}
          sections={sections}
          keyExtractor={(item) => `${item.retailer}:${item.retailerId}`}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          // Amazon's section is empty while pending, and its header is the only
          // thing telling the user it's still coming.
          renderSectionFooter={undefined}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <>
              <CompareTray
                items={Object.values(starred)}
                onOpen={(p) => Linking.openURL(p.url)}
                onRemove={toggleStar}
                onClear={() => setStarred({})}
                // Only worth explaining while there are results to try it on.
                showHint={sections.length > 0}
              />

              {highlights.length > 0 && (
                <View style={styles.highlightBlock}>
                  <Text style={styles.highlightHeading}>Top picks</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.highlightRow}
                  >
                    {highlights.map((h) => (
                      <HighlightCard
                        key={`${h.kind}:${h.product.retailer}:${h.product.retailerId}`}
                        highlight={h}
                        onPress={() => Linking.openURL(h.product.url)}
                        // Shares the compare tray with the per-store rows, so
                        // starring a pick here and starring the same item below
                        // are the same action rather than two separate ones.
                        starred={Boolean(starred[productKey(h.product)])}
                        onToggleStar={() => toggleStar(h.product)}
                        onAddToList={() =>
                          setListTarget({
                            retailer: h.product.retailer,
                            retailerId: h.product.retailerId,
                            title: h.product.title,
                            url: h.product.url,
                          })
                        }
                      />
                    ))}
                  </ScrollView>
                </View>
              )}
              {skipped.length > 0 && (
                <Text style={styles.skippedNote}>
                  Skipped {skipped.map((s) => s.label).join(", ")} — they don't sell
                  this kind of thing.
                </Text>
              )}
              {sections.length > 0 && (
                <Text style={styles.byStoreHeading}>By store</Text>
              )}
            </>
          }
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <View
                style={[styles.sectionDot, { backgroundColor: retailerColor(colors, section.retailer) }]}
              />
              <Text style={styles.sectionTitle}>{section.title}</Text>
              {section.status === "pending" && (
                <View style={styles.pendingRow}>
                  <ActivityIndicator size="small" color={colors.textSecondary} />
                  <Text style={styles.sectionStatus}>
                    still loading — can take up to 3 min
                  </Text>
                </View>
              )}
              {section.status !== "success" && section.status !== "pending" && (
                <Text style={styles.sectionStatus}>{section.message}</Text>
              )}
              {section.status === "success" && section.data.length === 0 && (
                <Text style={styles.sectionStatus}>No matches</Text>
              )}
            </View>
          )}
          renderItem={({ item }) => (
            <View style={styles.cardWrap}>
              <ProductCard
                title={item.title}
                retailer={item.retailer}
                price={item.price}
                listPrice={item.listPrice}
                imageUrl={item.imageUrl}
                rating={item.rating}
                ratingCount={item.ratingCount}
                sellerRating={item.sellerRating}
                sellerRatingCount={item.sellerRatingCount}
                actions={[
                  {
                    key: "compare",
                    icon: "star-outline",
                    activeIcon: "star",
                    label: "Compare",
                    activeLabel: "Added",
                    active: Boolean(starred[productKey(item)]),
                    onPress: () => toggleStar(item),
                  },
                  {
                    key: "list",
                    icon: "list-outline",
                    label: "List",
                    onPress: () =>
                      setListTarget({
                        retailer: item.retailer,
                        retailerId: item.retailerId,
                        title: item.title,
                        url: item.url,
                      }),
                  },
                  // Dropped entirely on tiers without the feature, rather than
                  // shown-and-refused: a dead button is worse than no button.
                  sweep.available && {
                    key: "sweep",
                    icon: "sparkles",
                    label: "Sweep",
                    tone: "accent" as const,
                    onPress: () => sweep.sweep({ url: item.url }),
                  },
                  // Search is for comparing who's cheapest. Tracking happens by
                  // pasting a link on the Tracking tab, which costs no quota.
                  {
                    key: "open",
                    icon: "open-outline",
                    label: "Open",
                    onPress: () => Linking.openURL(item.url),
                  },
                ]}
              />
            </View>
          )}
          ListFooterComponent={<View style={styles.footerSpace} />}
        />
      )}
      <SweepSheet
        visible={sweep.open}
        busy={sweep.busy}
        result={sweep.result}
        error={sweep.error}
        remaining={sweep.quota?.remaining ?? null}
        onClose={sweep.close}
      />

      <AddToListSheet
        product={listTarget}
        onClose={() => setListTarget(null)}
        onAdded={(name) => setNotice(`Added to ${name}.`)}
      />

      <WhyLimitedSheet
        visible={showWhy}
        onClose={() => setShowWhy(false)}
        onSeePlans={() => {
          setShowWhy(false);
          router.push("/plans");
        }}
      />
    </Screen>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    searchBar: {
      flexDirection: "row",
      gap: spacing.sm,
      padding: spacing.md,
      alignItems: "center",
    },
    input: {
      flex: 1,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: 12,
      color: colors.textPrimary,
      fontSize: type.body.fontSize,
    },
    quotaRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
      gap: spacing.sm,
    },
    quotaTextRow: { flexDirection: "row", alignItems: "center", gap: 5, flex: 1 },
    quotaText: {
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
      fontWeight: "600",
      flex: 1,
    },
    capNote: {
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
      fontWeight: "600",
    },
    notice: {
      color: colors.success,
      fontSize: type.label.fontSize,
      fontWeight: "700",
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
    },
    guestBanner: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.accentMuted,
      borderRadius: radius.md,
      padding: spacing.md,
      marginHorizontal: spacing.md,
      marginBottom: spacing.sm,
      gap: spacing.sm,
    },
    guestText: {
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
      lineHeight: 19,
    },
    list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    sectionDot: { width: 8, height: 8, borderRadius: radius.pill },
    sectionTitle: {
      color: colors.textPrimary,
      fontSize: type.label.fontSize,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    sectionStatus: {
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
      flex: 1,
    },
    pendingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      flex: 1,
    },
    resultsPicker: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    resultsLabel: {
      flex: 1,
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
    },
    resultsOptions: { flexDirection: "row", gap: 5 },
    resultsChip: {
      minWidth: 32,
      alignItems: "center",
      paddingVertical: 5,
      paddingHorizontal: 8,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surface,
    },
    resultsChipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    resultsChipText: {
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
      fontWeight: "800",
    },
    resultsChipTextOn: { color: colors.background },
    highlightBlock: { gap: spacing.sm, marginTop: spacing.sm },
    highlightHeading: {
      color: colors.textPrimary,
      fontSize: type.heading.fontSize,
      fontWeight: "800",
    },
    highlightRow: { gap: spacing.sm, paddingRight: spacing.md, paddingBottom: 2 },
    skippedNote: {
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
      marginTop: spacing.md,
      lineHeight: 15,
    },
    byStoreHeading: {
      color: colors.textPrimary,
      fontSize: type.heading.fontSize,
      fontWeight: "800",
      marginTop: spacing.lg,
    },
    cardWrap: { marginBottom: spacing.sm },
    footerSpace: { height: spacing.xl },
  });
