// app/why-limited.tsx
//
// Why Sweep's free tier has limits, answered honestly.
//
// Almost no app does this, and the reason most don't is that most limits are a
// sales tactic — the unrationed version exists and costs them nothing extra.
// Here the limits are a bill, and saying so plainly turns a cap from a squeeze
// into a constraint someone can understand and decide about.
//
// Two rules this page is written under, both deliberate:
//
//  1. It explains what subscriptions PAY FOR. It is not a donation appeal, it
//     doesn't ask for anything outside the store's billing, and it doesn't
//     frame Sweep as a cause. Google treats crowdfunding differently from
//     selling a subscription, and this is selling a subscription.
//
//  2. Every forward-looking number is an intention, not a promise. "Around ten
//     subscribers covers the monthly bill" is a fact about costs. "At twenty I
//     will raise everyone's limits" is something to actually do — but a number
//     you are bound to is a number you will regret, so it is phrased as a plan
//     rather than a commitment.
//
// The numbers that describe TODAY are generated — the free tier's allowances
// come from /plans and the store list from /search/retailers — because a page
// about being honest cannot be the one place with stale figures in it.

import { useCallback, useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Button, Loading, Screen } from "@/components/ui";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { useTranslate } from "@/lib/i18n";
import { getPlans, getRetailerStatus } from "@/lib/api";

const SUPPORT_EMAIL = "support@sweepshopping.com";

export default function WhyLimited() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();
  const router = useRouter();

  const [freeSummary, setFreeSummary] = useState<string | null>(null);
  const [liveStores, setLiveStores] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [plans, stores] = await Promise.all([
      getPlans().catch(() => null),
      getRetailerStatus().catch(() => null),
    ]);

    setFreeSummary(plans?.plans.find((p) => p.tier === "free")?.summary ?? null);
    // Only stores actually switched on. Naming one we've disabled would make
    // this page the thing it's trying not to be.
    setLiveStores(
      stores?.retailers
        .filter((r) => r.enabled !== false)
        .map((r) => r.label) ?? null,
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <Loading />;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.lede}>{t("why.lede")}</Text>

        {/* Who, before what. The costs only make sense once it's clear there
            is no company absorbing them. */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="person-outline" size={17} color={colors.accent} />
            <Text style={styles.cardTitle}>{t("why.whoTitle")}</Text>
          </View>
          <Text style={styles.body}>{t("why.whoBody")}</Text>
        </View>

        <Text style={styles.sectionTitle}>{t("why.costsTitle")}</Text>
        <View style={styles.card}>
          <Cost icon="cash-outline" title={t("why.amazonTitle")} body={t("why.amazonBody")} />
          <Cost icon="time-outline" title={t("why.freeApiTitle")} body={t("why.freeApiBody")} />
          <Cost icon="server-outline" title={t("why.serverTitle")} body={t("why.serverBody")} />
          <Cost
            icon="repeat-outline"
            title={t("why.sharedTitle")}
            body={t("why.sharedBody")}
          />
        </View>

        <Text style={styles.aside}>{t("why.whyTrackingGenerous")}</Text>

        {/* Generated, so this page can't promise something the server refuses. */}
        {freeSummary && (
          <View style={styles.freeCard}>
            <Text style={styles.freeLabel}>{t("why.freeTitle")}</Text>
            <Text style={styles.freeSummary}>{freeSummary}</Text>
            <Text style={styles.freeNote}>{t("why.freeNote")}</Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>{t("why.unlockTitle")}</Text>
        <Text style={styles.body}>{t("why.unlockIntro")}</Text>
        <View style={styles.card}>
          <Milestone count="~10" text={t("why.milestone10")} />
          <Milestone count="~15" text={t("why.milestone15")} />
          <Milestone count="~20" text={t("why.milestone20")} />
        </View>
        {/* The caveat is load-bearing, not legal boilerplate. */}
        <Text style={styles.aside}>{t("why.intentions")}</Text>

        <View style={styles.promiseCard}>
          <Ionicons name="heart-outline" size={17} color={colors.success} />
          <Text style={styles.promiseText}>{t("why.promise")}</Text>
        </View>

        <Text style={styles.sectionTitle}>{t("why.storesTitle")}</Text>
        {liveStores && liveStores.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.storeLabel}>{t("why.storesLive")}</Text>
            <Text style={styles.storeList}>{liveStores.join(" · ")}</Text>
            <Text style={styles.body}>{t("why.storesWanted")}</Text>
          </View>
        )}

        <View style={styles.actions}>
          <Button label={t("why.seePlans")} onPress={() => router.push("/plans")} />
          <Button
            label={t("why.getInTouch")}
            variant="secondary"
            onPress={() =>
              void Linking.openURL(
                `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Sweep")}`,
              )
            }
          />
        </View>

        <Text style={styles.footer}>{t("why.footer")}</Text>
      </ScrollView>
    </Screen>
  );
}

function Cost({
  icon,
  title,
  body,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={17} color={colors.accent} style={styles.rowIcon} />
      <Text style={styles.rowText}>
        <Text style={styles.bold}>{title}</Text> {body}
      </Text>
    </View>
  );
}

function Milestone({ count, text }: { count: string; text: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.row}>
      <Text style={styles.milestoneCount}>{count}</Text>
      <Text style={styles.rowText}>{text}</Text>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
    lede: {
      color: colors.textPrimary,
      fontSize: type.body.fontSize,
      lineHeight: 22,
      fontWeight: "600",
    },
    sectionTitle: {
      color: colors.textPrimary,
      fontSize: type.heading.fontSize,
      fontWeight: "800",
      marginTop: spacing.xs,
    },
    body: { color: colors.textSecondary, fontSize: type.label.fontSize, lineHeight: 20 },
    aside: {
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
      lineHeight: 18,
      fontStyle: "italic",
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.md,
      gap: spacing.sm,
    },
    cardHeader: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    cardTitle: {
      color: colors.textPrimary,
      fontSize: type.label.fontSize,
      fontWeight: "800",
    },
    row: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
    rowIcon: { marginTop: 2 },
    rowText: {
      flex: 1,
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
      lineHeight: 20,
    },
    bold: { color: colors.textPrimary, fontWeight: "700" },
    milestoneCount: {
      color: colors.accent,
      fontSize: type.label.fontSize,
      fontWeight: "800",
      width: 34,
    },
    freeCard: {
      backgroundColor: colors.accentMuted,
      borderRadius: radius.lg,
      padding: spacing.md,
      gap: 4,
    },
    freeLabel: {
      color: colors.accent,
      fontSize: type.caption.fontSize,
      fontWeight: "800",
      letterSpacing: 0.5,
    },
    freeSummary: {
      color: colors.textPrimary,
      fontSize: type.label.fontSize,
      fontWeight: "600",
      lineHeight: 20,
    },
    freeNote: { color: colors.textSecondary, fontSize: type.caption.fontSize },
    promiseCard: {
      flexDirection: "row",
      gap: spacing.sm,
      alignItems: "flex-start",
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.md,
    },
    promiseText: {
      flex: 1,
      color: colors.textPrimary,
      fontSize: type.label.fontSize,
      lineHeight: 20,
      fontWeight: "600",
    },
    storeLabel: {
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
      fontWeight: "700",
    },
    storeList: {
      color: colors.textPrimary,
      fontSize: type.label.fontSize,
      fontWeight: "700",
    },
    actions: { gap: spacing.sm, marginTop: spacing.xs },
    footer: {
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
      textAlign: "center",
      lineHeight: 18,
    },
  });
