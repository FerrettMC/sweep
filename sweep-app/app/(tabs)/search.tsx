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
import ResultsMenu from "@/components/ResultsMenu";
import WhyLimitedSheet from "@/components/WhyLimitedSheet";
import HighlightCard from "@/components/HighlightCard";
import ProductCard from "@/components/ProductCard";
import { Button, EmptyState, ErrorBanner, Loading, Screen } from "@/components/ui";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { useTranslate } from "@/lib/i18n";
import { storeListPhrase } from "@/lib/format";
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
/**
 * Sections in the order they're worth reading.
 *
 * Amazon first, then stores that actually returned something, then stores that
 * came back empty, then the ones that failed. Previously a failed store sat
 * wherever the server happened to list it, pushing real results below the fold
 * — the least useful thing on screen taking the best position.
 */
function orderSections(sections: Section[]): Section[] {
  const rank = (section: Section) => {
    if (section.retailer === "amazon") return 0;
    if (section.status === "pending") return 1;
    if (section.status === "success" && section.data.length > 0) return 2;
    if (section.status === "success") return 3;
    return 4;
  };
  return [...sections].sort((a, b) => rank(a) - rank(b));
}

const AMAZON_MAX_WAIT_MS = 210_000;

export default function SearchScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();
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
  const [resultsRange, setResultsRange] = useState<{
    min: number;
    max: number;
    default: number;
  } | null>(null);
  const [resultsPref, setResultsPref] = useState<number | null>(null);
  const [showResultsMenu, setShowResultsMenu] = useState(false);

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
          ? // Amazon leads, even while it's still running. It's the store most
            // people check by default, so burying it under four others reads as
            // "Amazon isn't included". Pending is a one-line header, not a
            // blocking spinner — everything below it is already usable.
            orderSections([
              {
                title: "Amazon",
                retailer: "amazon",
                status: "pending",
                message: null,
                data: [],
              },
              ...fast,
            ])
          : orderSections(fast),
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
            finish("failed", [], t("search.amazonSlow"));
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
            ? t("search.amazonExpired")
            : t("search.amazonFailed"),
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
        setError(t("search.signInForMore"));
        return;
      }

      const outcome = await showRewardedAd(userId);

      if (outcome.status === "dismissed") {
        setNotice(t("search.adClosedEarly"));
        return;
      }

      if (outcome.status === "failed") {
        // In development there's no real ad inventory, so fall back to the
        // dev-only endpoint rather than blocking the flow entirely.
        if (__DEV__) {
          const { quota: updated } = await claimRewardedSearch();
          setQuota(updated);
          setNotice(t("search.adDev"));
          return;
        }
        setError(`Couldn't load an ad: ${outcome.reason}`);
        return;
      }

      // Reward earned. The server credits it from AdMob's verification
      // callback, which can land a moment after the ad closes — so poll the
      // quota briefly rather than assuming it's already there.
      setNotice(t("search.adFinishing"));
      const updated = await waitForBonus(quota?.bonus ?? 0);

      if (updated) {
        setQuota(updated);
        setNotice(t("search.adUnlocked"));
      } else {
        setNotice(t("search.adPending"));
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
          placeholder={t("search.placeholder")}
          placeholderTextColor={colors.textTertiary}
          value={keyword}
          onChangeText={setKeyword}
          onSubmitEditing={() => void onSearch()}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button
          label={t("search.button")}
          onPress={() => void onSearch()}
          busy={searching}
          disabled={!keyword.trim() || outOfSearches}
          compact
        />
      </View>

      {quota && (
        <View style={styles.quotaRow}>
          <Pressable
            onPress={() => setShowWhy(true)}
            hitSlop={8}
            style={styles.quotaTextRow}
          >
            <Text style={styles.quotaText}>
              {quota.remaining > 0
                ? t(
                    quota.remaining === 1
                      ? "search.searchLeftShort"
                      : "search.searchesLeftShort",
                    { count: quota.remaining },
                  )
                : t("common.noSearchesLeft")}
              {quota.bonus > 0 ? t("search.fromAds", { count: quota.bonus }) : ""}
            </Text>
            <Ionicons
              name="help-circle-outline"
              size={15}
              color={colors.textTertiary}
            />
          </Pressable>
          {/*
            Sits on the quota row rather than a row of its own: it's a small
            setting, and giving it a full-width strip above "searches left"
            made it read as more important than the search box.
          */}
          {resultsRange && (
            <Pressable
              onPress={() => setShowResultsMenu(true)}
              hitSlop={8}
              style={({ pressed }) => [styles.resultsButton, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.resultsButtonText}>
                {resultsPref ?? resultsRange.default} per store
              </Text>
              <Ionicons name="chevron-down" size={13} color={colors.textSecondary} />
            </Pressable>
          )}

          {/*
            Three states, not two. Silently hiding the button once the daily ad
            cap is hit looks identical to the feature being broken, so say why.
          */}
          {outOfSearches && quota.canWatchAd && ADS_ENABLED && (
            <Button
              label={t("search.watchAd")}
              onPress={onWatchAd}
              busy={watchingAd}
              variant="secondary"
              compact
            />
          )}
          {outOfSearches && !quota.canWatchAd && !isGuest && (
            <Text style={styles.capNote}>{t("search.noAdSearches")}</Text>
          )}
        </View>
      )}

      {notice && <Text style={styles.notice}>{notice}</Text>}

      {error && <ErrorBanner message={error} onRetry={outOfSearches ? undefined : onSearch} />}

      {isGuest && (
        <View style={styles.guestBanner}>
          <Text style={styles.guestText}>{t("search.guestBanner")}</Text>
          <Button
            label={t("search.createAccount")}
            onPress={() => router.push("/auth")}
            variant="secondary"
            compact
          />
        </View>
      )}

      {searching && !sections && <Loading label={t("search.checkingStores")} />}

      {!searching && !sections && (
        <EmptyState
          title={t("search.emptyTitle")}
          // Was a hardcoded list that named Target, which Sweep doesn't
          // support, and omitted two stores that it does.
          body={t("search.emptyBody", { stores: storeListPhrase() })}
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
                  <Text style={styles.highlightHeading}>{t("search.topPicks")}</Text>
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
                <Text style={styles.byStoreHeading}>{t("search.byStore")}</Text>
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
                <Text style={styles.sectionStatus}>{t("search.noMatches")}</Text>
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

      <ResultsMenu
        visible={showResultsMenu}
        range={resultsRange}
        value={resultsPref}
        onPick={(count) => {
          setResultsPref(count);
          setShowResultsMenu(false);
        }}
        onClose={() => setShowResultsMenu(false)}
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
    resultsButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      paddingHorizontal: 9,
      paddingVertical: 5,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surface,
    },
    resultsButtonText: {
      color: colors.textSecondary,
      fontSize: type.caption.fontSize,
      fontWeight: "700",
    },
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
