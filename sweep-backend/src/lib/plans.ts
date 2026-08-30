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
import { type Locale, type StringKey, t } from "./i18n.js";

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
  /**
   * Stable identifier for the dial, unaffected by language.
   *
   * Clients that need to single out a particular dial must match on this, not
   * on `label` — the label is translated, so an English comparison quietly
   * stops matching the moment someone switches language.
   */
  id: StringKey;
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

/**
 * Exported so the admin dashboard can estimate revenue from the same numbers
 * the pricing screen shows. Two copies of a price is how a dashboard ends up
 * quietly reporting last quarter's figures.
 */
export const PRICING: Record<Tier, PlanPricing> = {
  free: { monthly: 0, yearly: 0, yearlySavingPercent: null, yearlyPerMonth: null },
  pro: {
    monthly: 5.99,
    // 64.99 rather than 65: Play adjusts prices to local conventions, and the
    // number here has to be what Play actually charges. A pricing screen that
    // disagrees with the purchase sheet is the kind of small dishonesty that
    // costs more trust than the penny is worth.
    yearly: 64.99,
    yearlySavingPercent: savingPercent(5.99, 64.99),
    yearlyPerMonth: perMonth(64.99),
  },
  ultimate: {
    monthly: 11.99,
    // 129.99, matching what Play charges — same local-pricing adjustment it
    // made to Pro's yearly plan.
    yearly: 129.99,
    yearlySavingPercent: savingPercent(11.99, 129.99),
    yearlyPerMonth: perMonth(129.99),
  },
};

/** Badge on the card. Free earns none — it isn't competing for the sale. */
function badgeFor(tier: Tier, locale: Locale): string | null {
  if (tier === "pro") return t(locale, "plan.badge.popular");
  if (tier === "ultimate") return t(locale, "plan.badge.value");
  return null;
}

/**
 * Every plan, written in the caller's language.
 *
 * The locale is threaded down rather than read from a global because this runs
 * per request: two people on different languages can be served concurrently,
 * and a module-level "current language" would hand one of them the other's.
 */
export function getPlans(locale: Locale = "en"): Plan[] {
  return TIERS.map((tier) => ({
    tier,
    name: t(locale, `plan.${tier}.name`),
    tagline: t(locale, `plan.${tier}.tagline`),
    pricing: PRICING[tier],
    badge: badgeFor(tier, locale),
    summary: summaryFor(tier, locale),
    upgrades: upgradesFor(tier, locale),
    unlocks: unlocksFor(tier, locale),
    features: featuresFor(tier, locale),
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
const DIALS: {
  label: StringKey;
  value: (limits: TierLimits, locale: Locale) => string;
}[] = [
  {
    label: "dial.products",
    value: (l) => String(l.maxTrackedProducts),
  },
  {
    // "Up to" throughout, and not as weasel wording: adaptive backoff means a
    // price that hasn't moved in weeks genuinely is checked less often. A
    // ceiling is the promise we can actually keep, so a ceiling is what we
    // print — including here, where the short form is most tempting to round.
    label: "dial.checks",
    value: (l, locale) =>
      l.fixedCheckTimes
        ? t(locale, "dial.upToTimes", { count: l.checkTimesPerDay })
        : l.checkIntervalMinutes === 60
          ? t(locale, "dial.upToHourly")
          : l.checkIntervalMinutes >= 60
            ? t(locale, "dial.upToHours", { hours: l.checkIntervalMinutes / 60 })
            : t(locale, "dial.upToMinutes", { minutes: l.checkIntervalMinutes }),
  },
  {
    label: "dial.searches",
    value: (l) => String(l.searchesPerDay),
  },
  {
    label: "dial.reopen",
    value: (l) => String(l.searchHistoryLimit),
  },
  {
    label: "dial.manual",
    value: (l, locale) =>
      l.manualChecksPerDay !== null
        ? t(locale, "dial.perDay", { count: l.manualChecksPerDay })
        : l.manualCheckCooldownMinutes !== null
          ? t(locale, "dial.everyMinutes", { minutes: l.manualCheckCooldownMinutes })
          : t(locale, "dial.unlimited"),
  },
  {
    label: "dial.results",
    value: (l, locale) =>
      l.resultsPerRetailer.min === l.resultsPerRetailer.max
        ? String(l.resultsPerRetailer.max)
        : t(locale, "dial.resultsChoice", { max: l.resultsPerRetailer.max }),
  },
  {
    label: "dial.radar",
    value: (l, locale) =>
      l.savedSearchIntervalMinutes === 0
        ? t(locale, "dial.radarManual", { count: l.maxSavedSearches })
        : t(locale, "dial.radarAuto", {
            count: l.maxSavedSearches,
            hours: l.savedSearchIntervalMinutes / 60,
          }),
  },
  {
    label: "dial.lookup",
    value: (l, locale) =>
      l.lookupsPerDay === 0
        ? t(locale, "dial.none")
        : t(locale, "dial.perDay", { count: l.lookupsPerDay }),
  },
  {
    label: "dial.history",
    value: (l, locale) =>
      l.historyDays === null
        ? t(locale, "dial.forever")
        : t(locale, "dial.days", { days: l.historyDays }),
  },
  {
    label: "dial.lists",
    value: (l, locale) =>
      t(locale, "dial.listsValue", { lists: l.maxLists, items: l.maxItemsPerList }),
  },
];

function summaryFor(tier: Tier, locale: Locale): string {
  const l = TIER_LIMITS[tier];
  const cadence = l.fixedCheckTimes
    ? t(locale, "summary.cadenceTimes", { count: l.checkTimesPerDay })
    : l.checkIntervalMinutes === 60
      ? t(locale, "summary.cadenceHourly")
      : t(locale, "summary.cadenceHours", { hours: l.checkIntervalMinutes / 60 });
  // Singular and plural are separate keys, not an English "s" bolted on: other
  // languages don't pluralise by suffix, and some don't split at one.
  const searches = t(
    locale,
    l.searchesPerDay === 1 ? "summary.searchesOne" : "summary.searches",
    { count: l.searchesPerDay },
  );
  return t(locale, "summary.line", {
    products: l.maxTrackedProducts,
    cadence,
    searches,
  });
}

function upgradesFor(tier: Tier, locale: Locale): PlanUpgrade[] {
  const limits = TIER_LIMITS[tier];
  const previous = previousTier(tier);
  const before = previous ? TIER_LIMITS[previous] : null;

  return DIALS.flatMap((dial) => {
    const to = dial.value(limits, locale);
    const from = before ? dial.value(before, locale) : null;
    // On a paid tier, a dial that didn't move isn't an upgrade — it's noise,
    // and noise is what made the old screen unreadable. Free keeps all of
    // them, since there's no "before" and they're simply what you get.
    if (from !== null && from === to) return [];
    return [{ id: dial.label, label: t(locale, dial.label), from, to }];
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
function unlocksFor(tier: Tier, locale: Locale): string[] {
  const previous = previousTier(tier);
  if (!previous) return [];

  const before = new Map(
    featuresFor(previous, locale).map((feature) => [feature.label, feature.included]),
  );

  return featuresFor(tier, locale)
    .filter((feature) => feature.included && before.get(feature.label) === false)
    .map((feature) => feature.label);
}

function featuresFor(tier: Tier, locale: Locale): PlanFeature[] {
  const l = TIER_LIMITS[tier];

  // "Up to" is deliberate and it is not weasel wording — adaptive backoff means
  // a product that hasn't moved in weeks genuinely IS checked less often. The
  // promise we can actually keep is a ceiling, so that's what we state.
  const checkCadence = l.fixedCheckTimes
    ? t(locale, "plan.checkedTimes", { count: l.checkTimesPerDay })
    : l.checkIntervalMinutes >= 60
      ? l.checkIntervalMinutes === 60
        ? t(locale, "plan.checkedHourly")
        : t(locale, "plan.checkedHours", { hours: l.checkIntervalMinutes / 60 })
      : t(locale, "plan.checkedMinutes", { minutes: l.checkIntervalMinutes });

  return [
    // ---- tracking ----
    {
      group: "tracking",
      included: true,
      label: t(locale, "plan.trackProducts", { count: l.maxTrackedProducts }),
    },
    { group: "tracking", included: true, label: checkCadence },
    {
      group: "tracking",
      included: true,
      label:
        l.historyDays === null
          ? t(locale, "plan.historyFull")
          : t(locale, "plan.historyDays", { days: l.historyDays }),
    },
    { group: "tracking", included: true, label: t(locale, "plan.adaptive") },
    { group: "tracking", included: true, label: t(locale, "plan.dailyFloor") },
    {
      group: "tracking",
      included: true,
      label:
        l.manualChecksPerDay !== null
          ? t(locale, "plan.manualChecks", { count: l.manualChecksPerDay })
          : l.manualCheckCooldownMinutes !== null
            ? t(locale, "plan.manualCooldown", { minutes: l.manualCheckCooldownMinutes })
            : t(locale, "plan.manualUnlimited"),
    },
    { group: "tracking", included: true, label: t(locale, "plan.dropAlerts") },
    {
      group: "tracking",
      included: l.customThresholds,
      label: t(locale, "plan.thresholds"),
    },
    {
      group: "tracking",
      included: l.priorityQueue,
      label: t(locale, "plan.priorityQueue"),
    },

    // ---- search ----
    {
      group: "search",
      included: true,
      label: t(
        locale,
        l.searchesPerDay === 1 ? "plan.searchesOne" : "plan.searches",
        { count: l.searchesPerDay },
      ),
    },
    { group: "search", included: true, label: t(locale, "plan.compareAll") },
    {
      group: "search",
      included: true,
      // "free" as in it spends no allowance, which is the part worth selling —
      // the number alone reads as a storage limit rather than a saving.
      label: t(locale, "plan.history", { count: l.searchHistoryLimit }),
    },
    {
      group: "search",
      included: true,
      label:
        l.resultsPerRetailer.min === l.resultsPerRetailer.max
          ? t(locale, "plan.resultsFixed", { count: l.resultsPerRetailer.max })
          : t(locale, "plan.resultsChoose", {
              min: l.resultsPerRetailer.min,
              max: l.resultsPerRetailer.max,
            }),
    },
    { group: "search", included: !l.showAds, label: t(locale, "plan.noAds") },
    {
      group: "search",
      included: true,
      label: t(
        locale,
        l.maxSavedSearches === 1 ? "plan.radarCountOne" : "plan.radarCount",
        { count: l.maxSavedSearches },
      ),
    },
    {
      group: "search",
      included: l.savedSearchIntervalMinutes > 0,
      label:
        l.savedSearchIntervalMinutes > 0
          ? t(locale, "plan.radarAuto", { hours: l.savedSearchIntervalMinutes / 60 })
          : t(locale, "plan.radarManual"),
    },
    {
      group: "search",
      included: l.lookupsPerDay > 0,
      label:
        l.lookupsPerDay > 0
          ? t(locale, "plan.lookupCount", { count: l.lookupsPerDay })
          : t(locale, "plan.lookupNone"),
    },

    // ---- budget ----
    { group: "budget", included: true, label: t(locale, "plan.budgetLogging") },
    {
      group: "budget",
      included: true,
      label:
        l.budgetHistoryMonths === null
          ? t(locale, "plan.budgetFull")
          : t(locale, "plan.budgetMonths", { months: l.budgetHistoryMonths }),
    },
    {
      group: "budget",
      included: l.customCategories,
      label: t(locale, "plan.budgetCategories"),
    },
    { group: "budget", included: true, label: t(locale, "plan.budgetOverall") },
    {
      group: "budget",
      included: l.budgetLimits,
      label: t(locale, "plan.budgetLimits"),
    },
    { group: "budget", included: l.budgetExport, label: t(locale, "plan.budgetExport") },

    // ---- lists ----
    {
      group: "lists",
      included: true,
      label: t(locale, l.maxLists === 1 ? "plan.listsOne" : "plan.lists", {
        lists: l.maxLists,
        items: l.maxItemsPerList,
      }),
    },
    { group: "lists", included: l.shareableLists, label: t(locale, "plan.shareLinks") },

    // ---- extras ----
    { group: "extras", included: true, label: t(locale, "plan.xp") },
    { group: "extras", included: true, label: t(locale, "plan.dealsFeed") },
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

export function featureGroupLabels(
  locale: Locale = "en",
): Record<PlanFeature["group"], string> {
  return {
    tracking: t(locale, "group.tracking"),
    search: t(locale, "group.search"),
    budget: t(locale, "group.budget"),
    lists: t(locale, "group.lists"),
    extras: t(locale, "group.extras"),
  };
}
