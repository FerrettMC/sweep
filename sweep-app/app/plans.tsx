// app/plans.tsx
//
// All three plans side by side.
//
// The plan data comes from the API rather than being written here, so what a
// user reads on this screen is generated from the same limits the backend
// enforces. Hardcoding prices and perks in the app is how a pricing page ends
// up promising something the server refuses to do.

import { useCallback, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Loading, Screen } from "@/components/ui";
import { colors, radius, spacing, type } from "@/constants/theme";
import { type Plan, type PlanFeature, getPlans } from "@/lib/api";

type Billing = "monthly" | "yearly";

export default function PlansScreen() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [groupLabels, setGroupLabels] = useState<Record<string, string>>({});
  const [currentTier, setCurrentTier] = useState<string | null>(null);
  const [billing, setBilling] = useState<Billing>("monthly");

  useFocusEffect(
    useCallback(() => {
      getPlans()
        .then((result) => {
          setPlans(result.plans);
          setGroupLabels(result.groupLabels);
          setCurrentTier(result.currentTier);
        })
        .catch(() => setPlans([]));
    }, []),
  );

  if (plans === null) return <Loading />;

  const savings = plans.find((p) => p.pricing.yearlySavingPercent)?.pricing
    .yearlySavingPercent;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          Sweep is free forever. Paid plans check prices more often and lift the
          limits.
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
                {option === "monthly" ? "Monthly" : "Yearly"}
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

        {plans.map((plan) => (
          <PlanCard
            key={plan.tier}
            plan={plan}
            billing={billing}
            groupLabels={groupLabels}
            isCurrent={plan.tier === currentTier}
          />
        ))}

        <Text style={styles.footnote}>
          Payments aren't wired up yet — this is what the plans will be.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function PlanCard({
  plan,
  billing,
  groupLabels,
  isCurrent,
}: {
  plan: Plan;
  billing: Billing;
  groupLabels: Record<string, string>;
  isCurrent: boolean;
}) {
  const [expanded, setExpanded] = useState(plan.highlighted);

  const price = billing === "monthly" ? plan.pricing.monthly : plan.pricing.yearly;
  const isFree = price === 0;

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
      {plan.highlighted && !isCurrent && (
        <View style={styles.ribbon}>
          <Text style={styles.ribbonText}>MOST POPULAR</Text>
        </View>
      )}
      {isCurrent && (
        <View style={[styles.ribbon, styles.ribbonCurrent]}>
          <Text style={styles.ribbonText}>YOUR PLAN</Text>
        </View>
      )}

      <Text style={styles.planName}>{plan.name}</Text>
      <Text style={styles.planTagline}>{plan.tagline}</Text>

      <View style={styles.priceRow}>
        <Text style={styles.price}>{isFree ? "Free" : `$${price}`}</Text>
        {!isFree && (
          <Text style={styles.priceUnit}>
            /{billing === "monthly" ? "month" : "year"}
          </Text>
        )}
      </View>

      <Pressable onPress={() => setExpanded((v) => !v)} style={styles.expandRow}>
        <Text style={styles.expandText}>
          {expanded ? "Hide" : "See"} what's included
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

const styles = StyleSheet.create({
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
  ribbonCurrent: { backgroundColor: "#1E3A28" },
  ribbonText: {
    color: colors.accent,
    fontSize: type.caption.fontSize,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  planName: {
    color: colors.textPrimary,
    fontSize: type.title.fontSize,
    fontWeight: "900",
  },
  planTagline: { color: colors.textSecondary, fontSize: type.label.fontSize },
  priceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
    marginTop: spacing.sm,
  },
  price: { color: colors.textPrimary, fontSize: 30, fontWeight: "900" },
  priceUnit: { color: colors.textTertiary, fontSize: type.label.fontSize },
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
