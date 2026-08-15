// app/onboarding.tsx
//
// The first-run tour.
//
// Ordered as a story rather than a feature list — find it, watch it, judge it,
// plan it — because "here are our six features" is what people skip. Each slide
// shows a small mock of the real UI instead of describing it, since a picture
// of a price comparison explains a price comparison faster than a sentence can.
//
// The last slide is the honest one: what you actually get for free. Putting the
// limits in the tour rather than discovering them at the first refusal is the
// difference between a cap that feels fair and one that feels like a trap. Its
// numbers come from the API, so they can't drift from what the server enforces.
//
// Skippable from the first frame. Someone reinstalling, or who just wants in,
// shouldn't have to swipe past six screens to reach a login form.

import { useCallback, useEffect, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/ui";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { storeListPhrase } from "@/lib/format";
import { getPlans } from "@/lib/api";
import { markOnboardingSeen } from "@/lib/onboarding";
import { type Translate, useTranslate } from "@/lib/i18n";
import { isGuestMode } from "@/lib/guestMode";
import { supabase } from "@/lib/supabase";
import LanguageMenu, { LanguageButton } from "@/components/LanguageMenu";

type Styles = ReturnType<typeof makeStyles>;

export default function Onboarding() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { width } = useWindowDimensions();
  // The header sat at a fixed 48px from the top, which on a punch-hole display
  // puts Skip under the camera and its tap target partly off-screen.
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList>(null);

  const [index, setIndex] = useState(0);
  // Real free-tier numbers, so the tour can't promise something the server
  // then refuses. Falls back to prose if the API isn't reachable.
  const [freeLimits, setFreeLimits] = useState<string[] | null>(null);
  // Offered here and not only in Profile, because someone who cannot read the
  // tour cannot get through the tour to reach Profile.
  const [languageOpen, setLanguageOpen] = useState(false);
  const t = useTranslate();

  useEffect(() => {
    getPlans()
      .then(({ plans }) => {
        const free = plans.find((p) => p.tier === "free");
        if (!free) return;
        setFreeLimits(
          free.upgrades
            // "—" means the tier doesn't get it at all; a green tick beside
            // that would be a lie, and this is the honesty slide.
            .filter((u) => u.to !== "—")
            // Jargon to someone who hasn't opened the app yet. Matched on the
            // stable id, because `label` arrives in the user's language.
            .filter((u) => u.id !== "dial.manual")
            .map((u) => `${u.label}: ${u.to}`),
        );
      })
      .catch(() => setFreeLimits(null));
  }, []);

  const finish = useCallback(async () => {
    await markOnboardingSeen();

    // Anyone already signed in (or browsing as a guest) got here by replaying
    // the tour from Profile — sending them to a login form they don't need
    // would be a jarring way to end it.
    const [{ data }, guest] = await Promise.all([
      supabase.auth.getSession(),
      isGuestMode(),
    ]);
    router.replace(data.session || guest ? "/(tabs)" : "/auth");
  }, [router]);

  const slides = buildSlides(styles, colors, freeLimits, t);
  const isLast = index === slides.length - 1;

  function next() {
    if (isLast) return void finish();
    listRef.current?.scrollToIndex({ index: index + 1, animated: true });
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.top, { paddingTop: insets.top + spacing.md }]}>
        <LanguageButton onPress={() => setLanguageOpen(true)} />

        <View style={styles.dots}>
          {slides.map((slide, i) => (
            <View key={slide.key} style={[styles.dot, i === index && styles.dotOn]} />
          ))}
        </View>
        {/* Available from the first frame, not revealed at the end. */}
        {/* Padded rather than bare text: a 13px word is a poor tap target, and
            this is the control someone reaches for when they're impatient. */}
        <Pressable
          onPress={finish}
          hitSlop={16}
          style={({ pressed }) => [styles.skipButton, pressed && styles.skipPressed]}
        >
          <Text style={styles.skip}>{t("onboarding.skip")}</Text>
        </Pressable>
      </View>

      <LanguageMenu visible={languageOpen} onClose={() => setLanguageOpen(false)} />

      <FlatList
        ref={listRef}
        data={slides}
        keyExtractor={(slide) => slide.key}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(event) =>
          setIndex(Math.round(event.nativeEvent.contentOffset.x / width))
        }
        renderItem={({ item }) => (
          <View style={[styles.slide, { width }]}>
            <View style={styles.visual}>{item.visual}</View>
            <Text style={styles.eyebrow}>{item.eyebrow}</Text>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.body}>{item.body}</Text>
          </View>
        )}
      />

      <View style={styles.bottom}>
        <Button
          label={isLast ? t("onboarding.getStarted") : t("onboarding.next")}
          onPress={next}
        />
        {isLast && (
          <Pressable onPress={finish} hitSlop={8} style={styles.already}>
            <Text style={styles.alreadyText}>{t("onboarding.haveAccount")}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// ---- slides ----------------------------------------------------------------

interface Slide {
  key: string;
  eyebrow: string;
  title: string;
  body: string;
  visual: React.ReactNode;
}

function buildSlides(
  styles: Styles,
  colors: Palette,
  freeLimits: string[] | null,
  t: Translate,
): Slide[] {
  return [
    {
      key: "welcome",
      eyebrow: t("onboarding.welcomeEyebrow"),
      title: t("onboarding.welcomeTitle"),
      body: t("onboarding.welcomeBody"),
      visual: (
        <Image
          source={require("@/assets/images/splash-icon.png")}
          style={styles.logo}
          resizeMode="contain"
        />
      ),
    },
    {
      key: "find",
      eyebrow: t("onboarding.findEyebrow"),
      title: t("onboarding.findTitle"),
      // The store list is built from live retailer status, so it stays a
      // placeholder rather than being baked into the sentence.
      body: t("onboarding.findBody", { stores: storeListPhrase() }),
      visual: <FindVisual styles={styles} colors={colors} />,
    },
    {
      key: "watch",
      eyebrow: t("onboarding.watchEyebrow"),
      title: t("onboarding.watchTitle"),
      body: t("onboarding.watchBody"),
      visual: <WatchVisual styles={styles} colors={colors} />,
    },
    {
      key: "judge",
      eyebrow: t("onboarding.judgeEyebrow"),
      title: t("onboarding.judgeTitle"),
      body: t("onboarding.judgeBody"),
      visual: <JudgeVisual styles={styles} colors={colors} />,
    },
    {
      key: "plan",
      eyebrow: t("onboarding.planEyebrow"),
      title: t("onboarding.planTitle"),
      body: t("onboarding.planBody"),
      visual: <PlanVisual styles={styles} colors={colors} />,
    },
    {
      key: "free",
      eyebrow: t("onboarding.freeEyebrow"),
      title: t("onboarding.freeTitle"),
      body: t("onboarding.freeBody"),
      visual: (
        <FreeVisual styles={styles} colors={colors} limits={freeLimits} t={t} />
      ),
    },
  ];
}

// ---- little mocks of the real UI -------------------------------------------

function FindVisual({ styles, colors }: { styles: Styles; colors: Palette }) {
  const rows: [string, string, string, boolean][] = [
    ["Walmart", "#0071DC", "$148.99", true],
    ["Amazon", "#FF9900", "$169.00", false],
    ["Best Buy", "#FFE000", "$179.99", false],
  ];
  return (
    <View style={styles.mock}>
      {rows.map(([store, dot, price, best]) => (
        <View key={store} style={[styles.mockRow, best && styles.mockRowBest]}>
          <View style={[styles.mockDot, { backgroundColor: dot }]} />
          <Text style={styles.mockStore}>{store}</Text>
          <Text style={[styles.mockPrice, best && styles.mockPriceBest]}>{price}</Text>
          {best && (
            <View style={styles.mockTag}>
              <Text style={styles.mockTagText}>CHEAPEST</Text>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

function WatchVisual({ styles, colors }: { styles: Styles; colors: Palette }) {
  const t = useTranslate();
  // A falling price, drawn as bars so it needs no charting library.
  const bars = [40, 44, 38, 41, 30, 26, 18];
  return (
    <View style={styles.mock}>
      <View style={styles.chart}>
        {bars.map((height, i) => (
          <View
            key={i}
            style={[
              styles.bar,
              { height: height * 1.5 },
              i === bars.length - 1 && styles.barLast,
            ]}
          />
        ))}
      </View>
      <View style={styles.notification}>
        <Ionicons name="notifications" size={15} color={colors.accent} />
        <View style={styles.notificationText}>
          <Text style={styles.notificationTitle}>{t("onboarding.mockPriceDrop")}</Text>
          <Text style={styles.notificationBody}>Down 17% to $148.99</Text>
        </View>
      </View>
    </View>
  );
}

function JudgeVisual({ styles, colors }: { styles: Styles; colors: Palette }) {
  return (
    <View style={styles.mock}>
      <View style={styles.verdict}>
        <View style={styles.verdictHalf}>
          <Text style={styles.verdictLabel}>STORE CLAIMS</Text>
          <Text style={styles.verdictClaim}>40% off</Text>
        </View>
        <Ionicons name="arrow-forward" size={14} color={colors.textTertiary} />
        <View style={styles.verdictHalf}>
          <Text style={styles.verdictLabel}>ACTUALLY</Text>
          <Text style={styles.verdictReal}>its normal price</Text>
        </View>
      </View>
      <View style={styles.sweptRow}>
        <Ionicons name="sparkles" size={14} color={colors.accent} />
        <Text style={styles.sweptText}>Swept! $14.21 less at Newegg.</Text>
      </View>
    </View>
  );
}

function PlanVisual({ styles, colors }: { styles: Styles; colors: Palette }) {
  const t = useTranslate();
  return (
    <View style={styles.mock}>
      {["Mum's birthday", "Desk setup"].map((name, i) => (
        <View key={name} style={styles.mockRow}>
          <Ionicons name="list-outline" size={15} color={colors.accent} />
          <Text style={styles.mockStore}>{name}</Text>
          <Text style={styles.mockCount}>{i === 0 ? "4 items" : "7 items"}</Text>
        </View>
      ))}
      <View style={styles.budget}>
        <View style={styles.budgetHead}>
          <Text style={styles.budgetLabel}>{t("onboarding.mockThisMonth")}</Text>
          <Text style={styles.budgetValue}>$212 of $400</Text>
        </View>
        <View style={styles.budgetTrack}>
          <View style={styles.budgetFill} />
        </View>
      </View>
    </View>
  );
}

function FreeVisual({
  styles,
  colors,
  limits,
  t,
}: {
  styles: Styles;
  colors: Palette;
  limits: string[] | null;
  t: Translate;
}) {
  // The live list comes from the API already translated; these stand in only
  // when it can't be reached.
  const lines = limits ?? [
    t("onboarding.freeFallbackTrack"),
    t("onboarding.freeFallbackAlerts"),
    t("onboarding.freeFallbackTools"),
  ];
  return (
    <View style={styles.mock}>
      {lines.slice(0, 6).map((line) => (
        <View key={line} style={styles.freeRow}>
          <Ionicons name="checkmark-circle" size={15} color={colors.success} />
          <Text style={styles.freeText}>{line}</Text>
        </View>
      ))}
      <Text style={styles.freeNote}>{t("onboarding.freeNote")}</Text>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    top: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
    },
    dots: { flexDirection: "row", gap: 6, flex: 1, justifyContent: "center" },
    dot: {
      width: 6,
      height: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceBorder,
    },
    dotOn: { backgroundColor: colors.accent, width: 18 },
    skipButton: {
      paddingHorizontal: spacing.md,
      paddingVertical: 10,
      borderRadius: radius.pill,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    skipPressed: { opacity: 0.7 },
    skip: { color: colors.textSecondary, fontSize: type.label.fontSize, fontWeight: "700" },

    slide: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      alignItems: "flex-start",
    },
    visual: {
      width: "100%",
      height: 250,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.lg,
    },
    logo: { width: 160, height: 160 },
    eyebrow: {
      color: colors.accent,
      fontSize: type.caption.fontSize,
      fontWeight: "900",
      letterSpacing: 1,
      marginBottom: 6,
    },
    title: {
      color: colors.textPrimary,
      fontSize: type.display.fontSize,
      fontWeight: "900",
      marginBottom: spacing.sm,
    },
    body: { color: colors.textSecondary, fontSize: type.body.fontSize, lineHeight: 22 },

    bottom: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm },
    already: { alignItems: "center", paddingVertical: 6 },
    alreadyText: {
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
      fontWeight: "700",
    },

    // ---- mocks ----
    mock: {
      width: "100%",
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      padding: spacing.md,
      gap: spacing.sm,
    },
    mockRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: 7,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.sm,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    mockRowBest: { borderColor: colors.accent, backgroundColor: colors.accentMuted },
    mockDot: { width: 8, height: 8, borderRadius: radius.pill },
    mockStore: { flex: 1, color: colors.textPrimary, fontSize: type.label.fontSize, fontWeight: "600" },
    mockCount: { color: colors.textTertiary, fontSize: type.caption.fontSize },
    mockPrice: { color: colors.textSecondary, fontSize: type.label.fontSize, fontWeight: "800" },
    mockPriceBest: { color: colors.accent },
    mockTag: {
      backgroundColor: colors.accent,
      borderRadius: radius.sm,
      paddingHorizontal: 5,
      paddingVertical: 2,
    },
    mockTagText: { color: colors.background, fontSize: 9, fontWeight: "900", letterSpacing: 0.4 },

    chart: {
      flexDirection: "row",
      alignItems: "flex-end",
      justifyContent: "space-between",
      height: 70,
      gap: 5,
    },
    bar: { flex: 1, backgroundColor: colors.surfaceRaised, borderRadius: 3 },
    barLast: { backgroundColor: colors.success },
    notification: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: colors.background,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.accentMuted,
      padding: spacing.sm,
    },
    notificationText: { flex: 1 },
    notificationTitle: { color: colors.textPrimary, fontSize: type.label.fontSize, fontWeight: "800" },
    notificationBody: { color: colors.textSecondary, fontSize: type.caption.fontSize },

    verdict: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: colors.background,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      padding: spacing.sm,
    },
    verdictHalf: { flex: 1, gap: 2 },
    verdictLabel: {
      color: colors.textTertiary,
      fontSize: 9,
      fontWeight: "900",
      letterSpacing: 0.5,
    },
    verdictClaim: {
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
      fontWeight: "700",
      textDecorationLine: "line-through",
    },
    verdictReal: { color: colors.warning, fontSize: type.label.fontSize, fontWeight: "800" },
    sweptRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    sweptText: { flex: 1, color: colors.textPrimary, fontSize: type.label.fontSize, fontWeight: "700" },

    budget: { gap: 5, marginTop: 2 },
    budgetHead: { flexDirection: "row", justifyContent: "space-between" },
    budgetLabel: { color: colors.textSecondary, fontSize: type.caption.fontSize },
    budgetValue: { color: colors.textPrimary, fontSize: type.caption.fontSize, fontWeight: "800" },
    budgetTrack: {
      height: 7,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceRaised,
      overflow: "hidden",
    },
    budgetFill: { width: "53%", height: "100%", backgroundColor: colors.success },

    freeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    freeText: { flex: 1, color: colors.textPrimary, fontSize: type.label.fontSize },
    freeNote: {
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
      marginTop: 2,
    },
  });
