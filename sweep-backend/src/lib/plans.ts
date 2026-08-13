// lib/plans.ts
//
// What each plan costs and what it includes, served to the app rather than
// hardcoded in it.
//
// The reason is drift: the moment prices or perks live in two places, one of
// them ends up wrong, and the one users read is the one that's wrong. The
// feature lines here are generated from TIER_LIMITS, so a cap can't say one
// thing on the pricing screen and enforce another in the API.

import { TIERS, TIER_LIMITS, type Tier, type TierLimits } from "./tiers.js";

export interface PlanPricing {
  monthly: number | null;
  yearly: number | null;
  /** Percentage saved by paying yearly, when both are set. */
  yearlySavingPercent: number | null;
  /**
   * What the yearly price works out to per month.
   *
   * "$130/yr" is hard to compare against "$11.99/mo" in your head, which is
   * exactly the comparison someone is trying to make when they toggle to
   * yearly. Computed here rather than in the app so the rounding of a price
   * happens once, in the same place as every other number on this screen.
   */
  yearlyPerMonth: number | null;
}

export interface PlanFeature {
  label: string;
  /** Grouping so the app can render sections rather than one long list. */
  group: "tracking" | "search" | "budget" | "lists" | "extras";
  /** False renders as a greyed-out "not included" line. */
  included: boolean;
}

/**
 * One dial that moves between tiers, with the value on either side of the jump.
 *
 * The full feature list is 22 lines per plan. Three of those stacked up is a
 * wall of text nobody reads, and a pricing page nobody reads sells nothing.
 * These are the handful of numbers that actually change, so a card can lead
 * with "3 → 20 products" instead of burying it in the middle of a list.
 */
export interface PlanUpgrade {
  /** The dial itself: "Products tracked". */
  label: string;
  /** What the tier below gives. Null on Free, which has nothing below it. */
  from: string | null;
  /** What this tier gives. */
  to: string;
}

export interface Plan {
  tier: Tier;
  name: string;
  tagline: string;
  pricing: PlanPricing;
  /** Short ribbon above the name, e.g. "MOST POPULAR". Null for Free. */
  badge: string | null;
  /**
   * One-line summary of the plan's headline numbers, for showing someone what
   * they're currently on. Generated here because the copy that was hardcoded in
   * the app drifted: it still advertised Pro at 10 searches a day long after
   * the cap moved to 30.
   */
  summary: string;
  /** The numbers that improve at this tier. Leads the card. */
  upgrades: PlanUpgrade[];
  /** Features that switch on at this tier and weren't available below it. */
  unlocks: string[];
  /** Everything included, for the full list behind "see all". */
  features: PlanFeature[];
  /** The one the pricing screen should visually push. */
  highlighted: boolean;
}

const PRICING: Record<Tier, PlanPricing> = {
  free: { monthly: 0, yearly: 0, yearlySavingPercent: null, yearlyPerMonth: null },
  pro: {
    monthly: 5.99,
    yearly: 65,
    yearlySavingPercent: savingPercent(5.99, 65),
    yearlyPerMonth: perMonth(65),
  },
  ultimate: {
    monthly: 11.99,
    yearly: 130,
    yearlySavingPercent: savingPercent(11.99, 130),
    yearlyPerMonth: perMonth(130),
  },
};

/** Badge on the card. Free earns none — it isn't competing for the sale. */
const BADGES: Record<Tier, string | null> = {
  free: null,
  pro: "MOST POPULAR",
  ultimate: "BEST VALUE",
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
    badge: BADGES[tier],
    summary: summaryFor(tier),
    upgrades: upgradesFor(tier),
    unlocks: unlocksFor(tier),
    features: featuresFor(tier),
    // Pro is the one most people should be on: it's the jump that removes the
    // limits people actually hit, without Ultimate's price.
    highlighted: tier === "pro",
  }));
}

/** The tier below this one, or null for Free. */
function previousTier(tier: Tier): Tier | null {
  const index = TIERS.indexOf(tier);
  return index > 0 ? TIERS[index - 1] : null;
}

/**
 * The dials worth putting on the card, in the order they matter to someone
 * deciding whether to pay.
 *
 * Derived from TIER_LIMITS like everything else here, so a cap can't move in
 * the backend and leave the pricing screen advertising the old number.
 */
const DIALS: { label: string; value: (limits: TierLimits) => string }[] = [
  {
    label: "Products tracked",
    value: (l) => String(l.maxTrackedProducts),
  },
  {
    // "Up to" throughout, and not as weasel wording: adaptive backoff means a
    // price that hasn't moved in weeks genuinely is checked less often. A
    // ceiling is the promise we can actually keep, so a ceiling is what we
    // print — including here, where the short form is most tempting to round.
    label: "Price checks",
    value: (l) =>
      l.fixedCheckTimes
        ? `Up to ${l.checkTimesPerDay}× a day`
        : l.checkIntervalMinutes === 60
          ? "Up to hourly"
          : l.checkIntervalMinutes >= 60
            ? `Up to every ${l.checkIntervalMinutes / 60} hours`
            : `Up to every ${l.checkIntervalMinutes} min`,
  },
  {
    label: "Searches a day",
    value: (l) => String(l.searchesPerDay),
  },
  {
    label: "Manual checks",
    value: (l) =>
      l.manualChecksPerDay !== null
        ? `${l.manualChecksPerDay} a day`
        : l.manualCheckCooldownMinutes !== null
          ? `Every ${l.manualCheckCooldownMinutes} min`
          : "Unlimited",
  },
  {
    label: "Deal Radar",
    value: (l) =>
      l.savedSearchIntervalMinutes === 0
        ? `${l.maxSavedSearches}, manual`
        : `${l.maxSavedSearches}, up to every ${l.savedSearchIntervalMinutes / 60}h`,
  },
  {
    label: "Sweep this deal",
    value: (l) => (l.sweepsPerDay === 0 ? "—" : `${l.sweepsPerDay} a day`),
  },
  {
    label: "Price history",
    value: (l) => (l.historyDays === null ? "Forever" : `${l.historyDays} days`),
  },
  {
    label: "Lists",
    value: (l) => `${l.maxLists} × ${l.maxItemsPerList} items`,
  },
];

function summaryFor(tier: Tier): string {
  const l = TIER_LIMITS[tier];
  const cadence = l.fixedCheckTimes
    ? `checked up to ${l.checkTimesPerDay}× a day`
    : l.checkIntervalMinutes === 60
      ? "checked up to hourly"
      : `checked up to every ${l.checkIntervalMinutes / 60}h`;
  const searches = `${l.searchesPerDay} ${l.searchesPerDay === 1 ? "search" : "searches"} a day`;
  return `${l.maxTrackedProducts} products · ${cadence} · ${searches}`;
}

function upgradesFor(tier: Tier): PlanUpgrade[] {
  const limits = TIER_LIMITS[tier];
  const previous = previousTier(tier);
  const before = previous ? TIER_LIMITS[previous] : null;

  return DIALS.flatMap((dial) => {
    const to = dial.value(limits);
    const from = before ? dial.value(before) : null;
    // On a paid tier, a dial that didn't move isn't an upgrade — it's noise,
    // and noise is what made the old screen unreadable. Free keeps all of
    // them, since there's no "before" and they're simply what you get.
    if (from !== null && from === to) return [];
    return [{ label: dial.label, from, to }];
  });
}

/**
 * Features that flip from off to on at this tier.
 *
 * Diffed against the tier below rather than listed by hand, so adding a perk
 * to TIER_LIMITS makes it appear here on its own. Metered features (whose
 * labels carry their numbers, like "Track 20 products") never match a label
 * from the tier below and so are correctly left to `upgrades` instead.
 */
function unlocksFor(tier: Tier): string[] {
  const previous = previousTier(tier);
  if (!previous) return [];

  const before = new Map(
    featuresFor(previous).map((feature) => [feature.label, feature.included]),
  );

  return featuresFor(tier)
    .filter((feature) => feature.included && before.get(feature.label) === false)
    .map((feature) => feature.label);
}

function featuresFor(tier: Tier): PlanFeature[] {
  const l = TIER_LIMITS[tier];

  // "Up to" is deliberate and it is not weasel wording — adaptive backoff means
  // a product that hasn't moved in weeks genuinely IS checked less often. The
  // promise we can actually keep is a ceiling, so that's what we state.
  const checkCadence = l.fixedCheckTimes
    ? `Checked up to ${l.checkTimesPerDay}× a day`
    : l.checkIntervalMinutes >= 60
      ? `Checked up to every ${l.checkIntervalMinutes / 60} hour${l.checkIntervalMinutes === 60 ? "" : "s"}`
      : `Checked up to every ${l.checkIntervalMinutes} minutes`;

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
      label: "Checked more often while a price is actually moving",
    },
    {
      group: "tracking",
      included: true,
      label: "Every tracked item checked at least once a day, guaranteed",
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
    { group: "search", included: true, label: "Compare every store at once" },
    { group: "search", included: !l.showAds, label: "No ads" },
    {
      group: "search",
      included: true,
      label: `Deal Radar — watch ${l.maxSavedSearches} ${l.maxSavedSearches === 1 ? "search" : "searches"} for a price you name`,
    },
    {
      group: "search",
      included: l.savedSearchIntervalMinutes > 0,
      label:
        l.savedSearchIntervalMinutes > 0
          ? `Radars checked for you, up to every ${l.savedSearchIntervalMinutes / 60} hours`
          : "Radars checked automatically (you refresh them yourself)",
    },
    {
      group: "search",
      included: l.sweepsPerDay > 0,
      label:
        l.sweepsPerDay > 0
          ? `"Sweep this deal" ${l.sweepsPerDay}× a day`
          : `"Sweep this deal" — is it really a sale, and is it cheaper elsewhere?`,
    },

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
    { group: "budget", included: true, label: "Monthly budget with overspend warnings" },
  { group: "budget", included: l.budgetLimits, label: "Per-category limits" },
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

/** Rounded to the cent, so it reads as a real price rather than a ratio. */
function perMonth(yearly: number): number {
  return Math.round((yearly / 12) * 100) / 100;
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
