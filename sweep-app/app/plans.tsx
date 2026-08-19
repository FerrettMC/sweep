// app/plans.tsx
//
// All three plans side by side.
//
// The plan data comes from the API rather than being written here, so what a
// user reads on this screen is generated from the same limits the backend
// enforces. Hardcoding prices and perks in the app is how a pricing page ends
// up promising something the server refuses to do.

import { useCallback, useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Button, Loading, Screen } from "@/components/ui";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { useTranslate } from "@/lib/i18n";
import { type Plan, type PlanFeature, getPlans } from "@/lib/api";
import {
  BILLING_ENABLED,
  activeProductId,
  buy,
  getOffering,
  openSubscriptionSettings,
  restore,
} from "@/lib/purchases";
import type {
  PurchasesOffering,
  PurchasesPackage,
} from "react-native-purchases";

type Billing = "monthly" | "yearly";

export default function PlansScreen() {
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [groupLabels, setGroupLabels] = useState<Record<string, string>>({});
  const [currentTier, setCurrentTier] = useState<string | null>(null);
  const [billing, setBilling] = useState<Billing>("monthly");
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    // Null until a store is connected and products exist. The cards handle
    // that by not offering a button, rather than showing one that fails.
    void getOffering().then(setOffering);
  }, []);

  /**
   * Buy, then reload from our API rather than trusting the client.
   *
   * RevenueCat tells the app what it owns so the screen can react at once, but
   * the tier that governs limits arrives by webhook and is read back from the
   * server — the client never grants itself anything.
   */
  async function onBuy(pkg: PurchasesPackage, planName: string) {
    setNotice(null);
    setBuying(pkg.identifier);
    try {
      const result = await buy(pkg);
      if (result.status === "cancelled") return;
      if (result.status === "unavailable") return setNotice(t("plans.notReady"));
      if (result.status === "failed") return setNotice(t("plans.purchaseFailed"));

      setNotice(t("plans.thanks", { plan: planName }));
      // The webhook may land a moment after the purchase returns, so this can
      // still show the old tier. Reloading again on focus covers that.
      await load();
    } finally {
      setBuying(null);
    }
  }

  /** Play is the only place a subscription can actually be cancelled. */
  async function onCancel() {
    const productId = await activeProductId();
    await openSubscriptionSettings(productId ?? undefined);
  }

  async function onRestore() {
    setNotice(null);
    const result = await restore();
    if (result.status === "bought") {
      setNotice(result.entitlements.length ? t("plans.restored") : t("plans.nothingToRestore"));
      await load();
    } else if (result.status === "failed") {
      setNotice(t("plans.purchaseFailed"));
    }
  }

  const load = useCallback(async () => {
    try {
      const result = await getPlans();
      setPlans(result.plans);
      setGroupLabels(result.groupLabels);
      setCurrentTier(result.currentTier);
    } catch {
      setPlans([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (plans === null) return <Loading />;

  const savings = plans.find((p) => p.pricing.yearlySavingPercent)?.pricing
    .yearlySavingPercent;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          Sweep is free forever. Each paid plan is the one below it with the
          limits raised — here's exactly what moves.
        </Text>

        {/* Billing toggle */}
        <View style={styles.toggle}>
          {(["monthly", "yearly"] as const).map((option) => (
            <Pressable
              key={option}
              onPress={() => setBilling(option)}
              style={[styles.toggleOption, billing === option && styles.toggleOptionOn]}
            >
              <Text
                style={[styles.toggleText, billing === option && styles.toggleTextOn]}
              >
                {option === "monthly" ? t("plans.monthly") : t("plans.yearly")}
              </Text>
              {option === "yearly" && savings ? (
                <Text
                  style={[styles.toggleSave, billing === option && styles.toggleSaveOn]}
                >
                  save {savings}%
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>

        {plans.map((plan, index) => (
          <PlanCard
            key={plan.tier}
            plan={plan}
            billing={billing}
            groupLabels={groupLabels}
            isCurrent={plan.tier === currentTier}
            previousName={index > 0 ? plans[index - 1].name : null}
            packages={offering?.availablePackages ?? []}
            buyingId={buying}
            onBuy={onBuy}
            rank={index}
            currentRank={plans.findIndex((p) => p.tier === (currentTier ?? "free"))}
            onCancel={onCancel}
          />
        ))}

        {notice && <Text style={styles.notice}>{notice}</Text>}

        {/* Play requires a way back for someone who reinstalled or switched
            device — they must not have to pay twice. */}
        {BILLING_ENABLED && (
          <Pressable onPress={onRestore} hitSlop={8} style={styles.restore}>
            <Text style={styles.restoreText}>{t("plans.restore")}</Text>
          </Pressable>
        )}

        {/*
          Reads as a roadmap rather than a half-built feature. Same honesty —
          nobody is charged and nobody is misled — but "coming soon" is a
          promise, where "not wired up yet" sounds like something broke.
        */}
        <Text style={styles.footnote}>{t("plans.footnote")}</Text>
      </ScrollView>
    </Screen>
  );
}

function PlanCard({
  plan,
  billing,
  groupLabels,
  isCurrent,
  previousName,
  packages,
  buyingId,
  onBuy,
  rank,
  currentRank,
  onCancel,
}: {
  plan: Plan;
  billing: Billing;
  groupLabels: Record<string, string>;
  isCurrent: boolean;
  /** Name of the tier below, so the card can say what it builds on. */
  previousName: string | null;
  /** Everything RevenueCat has for sale; empty until a store is connected. */
  packages: PurchasesPackage[];
  buyingId: string | null;
  onBuy: (pkg: PurchasesPackage, planName: string) => void;
  /** Position of this plan in the ladder, and of the one they're on. */
  rank: number;
  currentRank: number;
  onCancel: () => void;
}) {
  const t = useTranslate();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // Starts collapsed on every plan now. The upgrade rows above carry the
  // pitch, so opening the full list is a deliberate "show me everything"
  // rather than the default state of the screen.
  const [expanded, setExpanded] = useState(false);

  const price = billing === "monthly" ? plan.pricing.monthly : plan.pricing.yearly;
  const isFree = price === 0;
  const perMonth = plan.pricing.yearlyPerMonth;

  // Group features so the card reads as sections rather than 20 loose lines.
  const groups = plan.features.reduce<Record<string, PlanFeature[]>>((acc, feature) => {
    (acc[feature.group] ??= []).push(feature);
    return acc;
  }, {});

  return (
    <View
      style={[
        styles.card,
        plan.highlighted && styles.cardHighlighted,
        isCurrent && styles.cardCurrent,
      ]}
    >
      {/*
        Being on a plan is more useful to know than what we'd like to sell you,
        so "your plan" wins the slot when both apply.
      */}
      {isCurrent ? (
        <View style={[styles.ribbon, styles.ribbonCurrent]}>
          <Text style={[styles.ribbonText, styles.ribbonTextCurrent]}>{t("plans.yourPlan")}</Text>
        </View>
      ) : plan.badge ? (
        <View style={[styles.ribbon, !plan.highlighted && styles.ribbonSecondary]}>
          <Text
            style={[styles.ribbonText, !plan.highlighted && styles.ribbonTextSecondary]}
          >
            {plan.badge}
          </Text>
        </View>
      ) : null}

      {/* Name and price share a row so the numbers below start higher up. */}
      <View style={styles.headRow}>
        <View style={styles.headText}>
          <Text style={styles.planName}>{plan.name}</Text>
          <Text style={styles.planTagline}>{plan.tagline}</Text>
        </View>
        <View style={styles.priceColumn}>
          <View style={styles.priceBlock}>
            <Text style={styles.price}>{isFree ? "Free" : `$${price}`}</Text>
            {!isFree && (
              <Text style={styles.priceUnit}>
                /{billing === "monthly" ? "mo" : "yr"}
              </Text>
            )}
          </View>
          {/*
            A yearly figure is hard to weigh against a monthly one in your
            head, which is the exact comparison someone makes when they flip
            this toggle. Doing the division for them is the whole point.
          */}
          {billing === "yearly" && perMonth !== null && (
            <Text style={styles.priceEquiv}>${perMonth}/mo</Text>
          )}
        </View>
      </View>

      {/*
        The dials, up front. This is the whole point of the card: on a paid
        plan every row is a number that gets better, shown against the one it
        replaces, so the value of paying is legible at a glance instead of
        being reconstructed by comparing two long lists.
      */}
      {plan.upgrades.length > 0 && (
        <View style={styles.upgrades}>
          <Text style={styles.sectionLabel}>
            {isFree ? "WHAT YOU GET" : `EVERYTHING IN ${previousName?.toUpperCase()}, PLUS`}
          </Text>
          {plan.upgrades.map((upgrade) => (
            <View key={upgrade.label} style={styles.upgradeRow}>
              <Text style={styles.upgradeLabel}>{upgrade.label}</Text>
              <View style={styles.upgradeValues}>
                {upgrade.from !== null && (
                  <>
                    <Text style={styles.upgradeFrom}>{upgrade.from}</Text>
                    <Ionicons
                      name="arrow-forward"
                      size={11}
                      color={colors.textTertiary}
                    />
                  </>
                )}
                <Text style={styles.upgradeTo}>{upgrade.to}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {plan.unlocks.length > 0 && (
        <View style={styles.unlocks}>
          {plan.unlocks.map((unlock) => (
            <View key={unlock} style={styles.unlockRow}>
              <Ionicons name="add-circle" size={14} color={colors.accent} />
              <Text style={styles.unlockText}>{unlock}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Matched by the product id Play knows, so a plan without a configured
          product simply has no button rather than one that errors. Free never
          gets one — there is nothing to buy. */}
      {(() => {
        if (plan.tier === "free") return null;

        // The current plan offers a way out, not a way in.
        if (isCurrent) {
          return (
            <View style={styles.buyRow}>
              <Text style={styles.currentNote}>{t("plans.currentPlan")}</Text>
              <Pressable onPress={onCancel} hitSlop={8}>
                <Text style={styles.cancelText}>{t("plans.cancel")}</Text>
              </Pressable>
              <Text style={styles.trialNote}>
                {t("plans.cancelNote", { plan: plan.name })}
              </Text>
            </View>
          );
        }

        // A tier below the one you're on has nothing to sell you — everything
        // in it is already included. Offering "Subscribe" there invited an
        // Ultimate subscriber to buy Pro, which would be a downgrade dressed
        // up as a purchase.
        if (rank < currentRank) {
          return <Text style={styles.includedNote}>{t("plans.includedInYours")}</Text>;
        }

        const pkg = packages.find((p) =>
          p.product.identifier.includes(`${plan.tier}`) &&
          (billing === "yearly"
            ? /year|annual/i.test(p.product.identifier)
            : !/year|annual/i.test(p.product.identifier)),
        );
        if (!pkg) return null;

        return (
          <View style={styles.buyRow}>
            <Button
              // "Upgrade" when they already pay for something; "Subscribe"
              // only when they're coming from free.
              label={currentRank > 0 ? t("plans.upgrade") : t("plans.subscribe")}
              onPress={() => onBuy(pkg, plan.name)}
              busy={buyingId === pkg.identifier}
            />
            <Text style={styles.trialNote}>
              {t("plans.trialNote", { price: pkg.product.priceString })}
            </Text>
          </View>
        );
      })()}

      <Pressable onPress={() => setExpanded((v) => !v)} style={styles.expandRow}>
        <Text style={styles.expandText}>
          {expanded
            ? t("plans.hideList")
            : t("plans.seeAll", { count: plan.features.length })}
        </Text>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={15}
          color={colors.accent}
        />
      </Pressable>

      {expanded && (
        <View style={styles.features}>
          {Object.entries(groups).map(([group, features]) => (
            <View key={group} style={styles.group}>
              <Text style={styles.groupLabel}>
                {groupLabels[group]?.toUpperCase() ?? group.toUpperCase()}
              </Text>
              {features.map((feature) => (
                <View key={feature.label} style={styles.featureRow}>
                  <Ionicons
                    name={feature.included ? "checkmark-circle" : "close-circle-outline"}
                    size={15}
                    color={feature.included ? colors.success : colors.textTertiary}
                  />
                  <Text
                    style={[
                      styles.featureText,
                      !feature.included && styles.featureTextOff,
                    ]}
                  >
                    {feature.label}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
    intro: {
      color: colors.textSecondary,
      fontSize: type.body.fontSize,
      lineHeight: 21,
    },
    toggle: {
      flexDirection: "row",
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      padding: 3,
    },
    toggleOption: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: 9,
      borderRadius: radius.sm,
    },
    toggleOptionOn: { backgroundColor: colors.accent },
    toggleText: {
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
      fontWeight: "800",
    },
    toggleTextOn: { color: colors.background },
    toggleSave: { color: colors.success, fontSize: type.caption.fontSize, fontWeight: "800" },
    toggleSaveOn: { color: colors.background },

    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      padding: spacing.md,
      gap: 2,
    },
    cardHighlighted: { borderColor: colors.accent },
    cardCurrent: { borderColor: colors.success },
    ribbon: {
      alignSelf: "flex-start",
      backgroundColor: colors.accentMuted,
      borderRadius: radius.sm,
      paddingHorizontal: 8,
      paddingVertical: 3,
      marginBottom: spacing.xs,
    },
    ribbonCurrent: { backgroundColor: colors.successMuted },
    // Ultimate earns a badge but not the visual push — Pro keeps the accent so
    // the card we actually recommend still wins the eye.
    ribbonSecondary: { backgroundColor: colors.surfaceRaised },
    ribbonText: {
      color: colors.accent,
      fontSize: type.caption.fontSize,
      fontWeight: "900",
      letterSpacing: 0.6,
    },
    ribbonTextSecondary: { color: colors.textSecondary },
    ribbonTextCurrent: { color: colors.success },
    headRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
    headText: { flex: 1, gap: 1 },
    planName: {
      color: colors.textPrimary,
      fontSize: type.title.fontSize,
      fontWeight: "900",
    },
    planTagline: { color: colors.textSecondary, fontSize: type.label.fontSize },
    priceColumn: { alignItems: "flex-end" },
    priceBlock: { flexDirection: "row", alignItems: "baseline", gap: 2 },
    price: { color: colors.textPrimary, fontSize: 26, fontWeight: "900" },
    priceUnit: { color: colors.textTertiary, fontSize: type.caption.fontSize },
    priceEquiv: {
      color: colors.success,
      fontSize: type.caption.fontSize,
      fontWeight: "700",
      marginTop: 1,
    },

    upgrades: { marginTop: spacing.md, gap: 1 },
    sectionLabel: {
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
      fontWeight: "900",
      letterSpacing: 0.6,
      marginBottom: 5,
    },
    upgradeRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
      paddingVertical: 7,
      borderTopWidth: 1,
      borderTopColor: colors.surfaceBorder,
    },
    upgradeLabel: {
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
      flexShrink: 1,
    },
    upgradeValues: { flexDirection: "row", alignItems: "center", gap: 5 },
    // The old value stays visible but recedes — it's the reference point, not
    // the offer. Struck through would read as "no longer available", which is
    // the wrong meaning: it's what you have now.
    upgradeFrom: {
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
    },
    upgradeTo: {
      color: colors.textPrimary,
      fontSize: type.label.fontSize,
      fontWeight: "800",
    },

    unlocks: { marginTop: spacing.sm, gap: 4 },
    unlockRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    unlockText: {
      flex: 1,
      color: colors.textPrimary,
      fontSize: type.label.fontSize,
    },

    buyRow: { gap: 6, marginTop: spacing.sm },
    trialNote: {
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
      textAlign: "center",
    },
    cancelText: {
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
      fontWeight: "700",
      textAlign: "center",
      paddingVertical: 6,
    },
    includedNote: {
      color: colors.textTertiary,
      fontSize: type.label.fontSize,
      textAlign: "center",
      marginTop: spacing.sm,
    },
    currentNote: {
      color: colors.accent,
      fontSize: type.label.fontSize,
      fontWeight: "700",
      textAlign: "center",
      marginTop: spacing.sm,
    },
    notice: {
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
      textAlign: "center",
      paddingHorizontal: spacing.md,
    },
    restore: { alignItems: "center", paddingVertical: spacing.md },
    restoreText: {
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
      fontWeight: "600",
    },
    expandRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      marginTop: spacing.sm,
    },
    expandText: { color: colors.accent, fontSize: type.label.fontSize, fontWeight: "700" },
    features: { gap: spacing.md, marginTop: spacing.md },
    group: { gap: 5 },
    groupLabel: {
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
      fontWeight: "900",
      letterSpacing: 0.6,
    },
    featureRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.xs },
    featureText: {
      flex: 1,
      color: colors.textPrimary,
      fontSize: type.label.fontSize,
      lineHeight: 18,
    },
    featureTextOff: { color: colors.textTertiary },
    footnote: {
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
      textAlign: "center",
      fontStyle: "italic",
    },
  });
