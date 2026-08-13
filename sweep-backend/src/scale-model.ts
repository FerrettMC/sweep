// src/scale-model.ts
//
// Full P&L at scale: API + servers + store cut.
//
//   npm run scale-model
//
// Every assumption is a named constant. The ones most likely to be wrong are
// flagged — change them and re-run rather than trusting a single number.

import { effectiveIntervalMinutes } from "./lib/backoff.js";
import { TIER_LIMITS } from "./lib/tiers.js";

const USERS = 50_000;

/** Pay-as-you-go rather than a fixed plan — you buy what you use. */
const COST_PER_1K_REQUESTS = 0.5;

const PRO_PRICE = 5.99;
const ULTIMATE_PRICE = 11.99;

/**
 * App-store cut. 15% is the small-business rate (under $1M/yr) on both stores.
 * It applies to SUBSCRIPTIONS only — ad revenue is paid by AdMob directly and
 * isn't touched by it.
 */
const STORE_CUT = 0.15;

// ---- ads -------------------------------------------------------------------

/** Share of all users who watch at least one rewarded ad in a week. */
const REWARDED_WATCHER_SHARE = 0.6;
const WEEKS_PER_MONTH = 4.3;
/** US rewarded-video eCPM lands around $15–30, i.e. $0.015–0.03 per view. */
const REWARDED_REVENUE_PER_VIEW = 0.02;

/** Interstitials shown per free user per month, once a second slot exists. */
const INTERSTITIALS_PER_FREE_USER = 6;
/** Interstitials earn appreciably less per impression than rewarded video. */
const INTERSTITIAL_REVENUE_PER_VIEW = 0.008;

// ---- infrastructure --------------------------------------------------------
//
// Rough but defensible at this size: a container or two for the API and
// scheduler, a managed Postgres big enough for the price history, and the
// paid tiers of the monitoring/email services once free limits are gone.

const SERVER_COSTS = {
  hosting: 60, // API + scheduler
  database: 100, // managed Postgres w/ enough storage for price history
  monitoring: 26, // Sentry team
  email: 20, // Resend
};
const SERVER_TOTAL = Object.values(SERVER_COSTS).reduce((a, b) => a + b, 0);

// ---- usage -----------------------------------------------------------------

const AMAZON_SHARE = 0.5;
const STABLE_SHARE = 0.75;
/** Overlap between users tracking the same product. Grows with the userbase. */
const CACHE_OVERLAP = 0.5;
const DAYS = 30;

const USAGE = {
  free: { items: 2, searches: 13 },
  pro: { items: 10, searches: 50 },
  ultimate: { items: 20, searches: 100 },
} as const;

function monthlyRequestsPerUser(tier: "free" | "pro" | "ultimate") {
  const base = TIER_LIMITS[tier].checkIntervalMinutes;
  const perDay = (minutes: number) => (24 * 60) / minutes;

  // Volatile items run at full rate; stable ones sit at the backoff ceiling.
  const blendedChecksPerDay =
    perDay(effectiveIntervalMinutes(base, 0)) * (1 - STABLE_SHARE) +
    perDay(effectiveIntervalMinutes(base, 99)) * STABLE_SHARE;

  const tracking =
    USAGE[tier].items *
    AMAZON_SHARE *
    blendedChecksPerDay *
    DAYS *
    (1 - CACHE_OVERLAP);

  return tracking + USAGE[tier].searches;
}

function model(paidShare: number) {
  // Split the paid population 2:1 in favour of Pro — the cheaper tier always
  // carries more people.
  const pro = Math.round(USERS * paidShare * (2 / 3));
  const ultimate = Math.round(USERS * paidShare * (1 / 3));
  const free = USERS - pro - ultimate;

  const requests =
    monthlyRequestsPerUser("free") * free +
    monthlyRequestsPerUser("pro") * pro +
    monthlyRequestsPerUser("ultimate") * ultimate;

  const apiCost = (requests / 1000) * COST_PER_1K_REQUESTS;

  const subsGross = pro * PRO_PRICE + ultimate * ULTIMATE_PRICE;
  const storeCut = subsGross * STORE_CUT;
  const subsNet = subsGross - storeCut;

  const rewardedRevenue =
    USERS * REWARDED_WATCHER_SHARE * WEEKS_PER_MONTH * REWARDED_REVENUE_PER_VIEW;
  const interstitialRevenue =
    free * INTERSTITIALS_PER_FREE_USER * INTERSTITIAL_REVENUE_PER_VIEW;
  const adRevenue = rewardedRevenue + interstitialRevenue;

  const netRevenue = subsNet + adRevenue;
  const totalCost = apiCost + SERVER_TOTAL;
  const profit = netRevenue - totalCost;

  const money = (n: number) =>
    `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  console.log(`\n${"=".repeat(64)}`);
  console.log(
    `${(paidShare * 100).toFixed(0)}% PAID  —  ${pro.toLocaleString()} Pro, ${ultimate.toLocaleString()} Ultimate, ${free.toLocaleString()} free`,
  );
  console.log("=".repeat(64));

  console.log("REVENUE");
  console.log(`  subscriptions (gross)      ${money(subsGross).padStart(10)}`);
  console.log(`  store cut (${STORE_CUT * 100}%)            ${("-" + money(storeCut)).padStart(10)}`);
  console.log(`  subscriptions (net)        ${money(subsNet).padStart(10)}`);
  console.log(`  rewarded ads               ${money(rewardedRevenue).padStart(10)}`);
  console.log(`  interstitial ads           ${money(interstitialRevenue).padStart(10)}`);
  console.log(`  ${"".padEnd(26)} ${"—".repeat(10)}`);
  console.log(`  net revenue                ${money(netRevenue).padStart(10)}`);

  console.log("\nCOSTS");
  console.log(
    `  Amazon API                 ${money(apiCost).padStart(10)}   (${Math.round(requests).toLocaleString()} req)`,
  );
  console.log(`  servers + services         ${money(SERVER_TOTAL).padStart(10)}`);
  console.log(`  ${"".padEnd(26)} ${"—".repeat(10)}`);
  console.log(`  total                      ${money(totalCost).padStart(10)}`);

  console.log(
    `\nPROFIT                       ${money(profit).padStart(10)}/mo   (${Math.round((profit / netRevenue) * 100)}% margin)`,
  );
  console.log(`                             ${money(profit * 12).padStart(10)}/yr`);
}

model(0.02);
model(0.03);

console.log(`\n${"=".repeat(64)}`);
console.log("Assumptions most likely to be wrong:");
console.log(`  rewarded ad revenue/view   $${REWARDED_REVENUE_PER_VIEW}`);
console.log(`  interstitials/free user/mo ${INTERSTITIALS_PER_FREE_USER}`);
console.log(`  shared-cache overlap       ${CACHE_OVERLAP * 100}%`);
console.log(`  Amazon share of tracked    ${AMAZON_SHARE * 100}%`);
console.log(`  server costs               $${SERVER_TOTAL}/mo`);
console.log("=".repeat(64));
