// lib/plans.ts
//
// What each plan costs and what it includes, served to the app rather than
// hardcoded in it.
//
// The reason is drift: the moment prices or perks live in two places, one of
// them ends up wrong, and the one users read is the one that's wrong. The
// feature lines here are generated from TIER_LIMITS, so a cap can't say one
// thing on the pricing screen and enforce another in the API.

import { TIERS, TIER_LIMITS, type Tier } from "./tiers.js";

export interface PlanPricing {
  monthly: number | null;
  yearly: number | null;
  /** Percentage saved by paying yearly, when both are set. */
  yearlySavingPercent: number | null;
}

export interface PlanFeature {
  label: string;
  /** Grouping so the app can render sections rather than one long list. */
  group: "tracking" | "search" | "budget" | "lists" | "extras";
  /** False renders as a greyed-out "not included" line. */
  included: boolean;
}

export interface Plan {
  tier: Tier;
  name: string;
  tagline: string;
  pricing: PlanPricing;
  features: PlanFeature[];
  /** The one the pricing screen should visually push. */
  highlighted: boolean;
}

const PRICING: Record<Tier, PlanPricing> = {
  free: { monthly: 0, yearly: 0, yearlySavingPercent: null },
  pro: { monthly: 5.99, yearly: 65, yearlySavingPercent: savingPercent(5.99, 65) },
  ultimate: { monthly: 11.99, yearly: 130, yearlySavingPercent: savingPercent(11.99, 130) },
};

const NAMES: Record<Tier, { name: string; tagline: string }> = {
  free: { name: "Free", tagline: "Everything you need to start saving" },
  pro: { name: "Pro", tagline: "For people who shop deliberately" },
  ultimate: { name: "Ultimate", tagline: "Every price, checked constantly" },
};

export function getPlans(): Plan[] {
  return TIERS.map((tier) => ({
    tier,
    ...NAMES[tier],
    pricing: PRICING[tier],
    features: featuresFor(tier),
    // Pro is the one most people should be on: it's the jump that removes the
    // limits people actually hit, without Ultimate's price.
    highlighted: tier === "pro",
  }));
}

function featuresFor(tier: Tier): PlanFeature[] {
  const l = TIER_LIMITS[tier];

  const checkCadence = l.fixedCheckTimes
    ? `Checked ${l.checkTimesPerDay}× a day at times you pick`
    : l.checkIntervalMinutes >= 60
      ? `Checked every ${l.checkIntervalMinutes / 60} hour${l.checkIntervalMinutes === 60 ? "" : "s"}`
      : `Checked every ${l.checkIntervalMinutes} minutes`;

  return [
    // ---- tracking ----
    { group: "tracking", included: true, label: `Track ${l.maxTrackedProducts} products` },
    { group: "tracking", included: true, label: checkCadence },
    {
      group: "tracking",
      included: true,
      label:
        l.historyDays === null
          ? "Full price history"
          : `${l.historyDays}-day price history`,
    },
    {
      group: "tracking",
      included: true,
      label:
        l.manualChecksPerDay !== null
          ? `${l.manualChecksPerDay} manual price checks a day`
          : l.manualCheckCooldownMinutes !== null
            ? `Manual checks every ${l.manualCheckCooldownMinutes} minutes`
            : "Unlimited manual price checks",
    },
    { group: "tracking", included: true, label: "Price-drop alerts" },
    {
      group: "tracking",
      included: l.customThresholds,
      label: "Custom alert thresholds (“only below $X”)",
    },
    { group: "tracking", included: l.priorityQueue, label: "Priority check queue" },

    // ---- search ----
    {
      group: "search",
      included: true,
      label: `${l.searchesPerDay} multi-store ${l.searchesPerDay === 1 ? "search" : "searches"} a day`,
    },
    { group: "search", included: true, label: "Compare across 6 stores at once" },
    { group: "search", included: !l.showAds, label: "No ads" },

    // ---- budget ----
    { group: "budget", included: true, label: "Unlimited expense logging" },
    {
      group: "budget",
      included: true,
      label:
        l.budgetHistoryMonths === null
          ? "Full spending history"
          : `${l.budgetHistoryMonths} months of spending history`,
    },
    { group: "budget", included: l.customCategories, label: "Custom categories" },
    { group: "budget", included: l.budgetLimits, label: "Category spending limits + warnings" },
    { group: "budget", included: l.budgetExport, label: "Export to CSV" },

    // ---- lists ----
    {
      group: "lists",
      included: true,
      label: `${l.maxLists} ${l.maxLists === 1 ? "list" : "lists"}, ${l.maxItemsPerList} items each`,
    },
    { group: "lists", included: l.shareableLists, label: "Shareable gift links" },

    // ---- extras ----
    { group: "extras", included: true, label: "XP, badges and leaderboard" },
    { group: "extras", included: true, label: "Best Deals Found feed" },
  ];
}

function savingPercent(monthly: number, yearly: number): number {
  const fullYear = monthly * 12;
  return Math.round(((fullYear - yearly) / fullYear) * 100);
}

export const FEATURE_GROUP_LABELS: Record<PlanFeature["group"], string> = {
  tracking: "Price tracking",
  search: "Multi-store search",
  budget: "Budget tracker",
  lists: "Lists & wishlists",
  extras: "Community",
};
