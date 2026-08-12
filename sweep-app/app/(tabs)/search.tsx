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
import {
  ActivityIndicator,
  Linking,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import ProductCard from "@/components/ProductCard";
import { Button, EmptyState, ErrorBanner, Loading, Screen } from "@/components/ui";
import { colors, radius, spacing, type } from "@/constants/theme";
import {
  ApiError,
  type Quota,
  type RetailerResult,
  type SearchProduct,
  claimRewardedSearch,
  getAmazonSearchResult,
  getQuota,
  search as runSearch,
} from "@/lib/api";
import { pluralize, retailerColor } from "@/lib/format";

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
  const router = useRouter();

  const [keyword, setKeyword] = useState("");
  const [sections, setSections] = useState<Section[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [amazonJobId, setAmazonJobId] = useState<string | null>(null);

  // Bumped on each new search so an in-flight poll from the previous one can
  // tell it's stale and stop writing results into the current view.
  const searchGeneration = useRef(0);

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

  async function onSearch() {
    const trimmed = keyword.trim();
    if (!trimmed || searching) return;

    setSearching(true);
    setError(null);
    setNotice(null);
    searchGeneration.current += 1;
    setAmazonJobId(null);

    try {
      const response = await runSearch(trimmed);
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

  async function onWatchAd() {
    try {
      // The ad SDK isn't wired yet — this claims the reward directly. When
      // AdMob lands, the rewarded video plays here and the server verifies it
      // via SSV before granting anything.
      const { quota: updated } = await claimRewardedSearch();
      setQuota(updated);
      setError(null);
      setNotice("Extra search unlocked.");
    } catch (err) {
      setError((err as ApiError).message);
    }
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
          onSubmitEditing={onSearch}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button
          label="Search"
          onPress={onSearch}
          busy={searching}
          disabled={!keyword.trim() || outOfSearches}
          compact
        />
      </View>

      {quota && (
        <View style={styles.quotaRow}>
          <Text style={styles.quotaText}>
            {quota.remaining > 0
              ? `${pluralize(quota.remaining, "search")} left today`
              : "No searches left today"}
            {quota.bonus > 0 ? ` · +${quota.bonus} from ads` : ""}
          </Text>
          {quota.canWatchAd && outOfSearches && (
            <Button label="Watch ad for +1" onPress={onWatchAd} variant="secondary" compact />
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
          sections={sections}
          keyExtractor={(item) => `${item.retailer}:${item.retailerId}`}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          // Amazon's section is empty while pending, and its header is the only
          // thing telling the user it's still coming.
          renderSectionFooter={undefined}
          keyboardShouldPersistTaps="handled"
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <View
                style={[styles.sectionDot, { backgroundColor: retailerColor(section.retailer) }]}
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
                // Search is for comparing who's cheapest. Tracking happens by
                // pasting a link on the Tracking tab, which costs no quota.
                action={
                  <Button
                    label="Open"
                    onPress={() => Linking.openURL(item.url)}
                    variant="secondary"
                    compact
                  />
                }
              />
            </View>
          )}
          ListFooterComponent={<View style={styles.footerSpace} />}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
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
  quotaText: {
    color: colors.textSecondary,
    fontSize: type.label.fontSize,
    fontWeight: "600",
    flex: 1,
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
  cardWrap: { marginBottom: spacing.sm },
  footerSpace: { height: spacing.xl },
});
