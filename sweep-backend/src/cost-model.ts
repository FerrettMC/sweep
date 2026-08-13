// src/cost-model.ts
//
// Amazon request budget, modelled per tier.
//
//   npm run cost-model
//
// The number that matters is AMAZON REQUESTS, not checks. Walmart, Best Buy,
// Every store except Amazon is self-scraped or a free API — they cost latency and
// goodwill, not money. Only the Amazon leg spends provider credits, so a
// tracked item is only expensive if it happens to be an Amazon item.
//
// Every assumption is a named constant. Change one and re-run.

// ---- what we're paying for -------------------------------------------------

const PLAN_MONTHLY_COST = 19; // amazonscraperapi "vibe" tier
const PLAN_REQUESTS = 27_000;
const COST_PER_REQUEST = PLAN_MONTHLY_COST / PLAN_REQUESTS;

// ---- the population --------------------------------------------------------

const TOTAL_USERS = 100;
const PRO_USERS = 4;
const ULTIMATE_USERS = 1;
const FREE_USERS = TOTAL_USERS - PRO_USERS - ULTIMATE_USERS;

const PRO_PRICE = 5.99;
const ULTIMATE_PRICE = 11.99;
const AD_REVENUE_TOTAL = 2; // total monthly ad revenue across all free users

/**
 * Share of tracked items that are Amazon. This is THE most important number in
 * the whole model and it's a guess — Amazon is the default place people shop,
 * so assume it's over-represented rather than 1-in-6.
 */
const AMAZON_SHARE_OF_TRACKED = 0.5;

/**
 * How much the shared cache saves. One Product row is checked once and served
 * to everyone tracking it, so popular items (AirPods, a given TV) collapse into
 * a single check.
 *
 * At 100 users overlap is slight. It improves as the userbase grows, which is
 * the one part of this model that gets BETTER with scale.
 */
const CACHE_OVERLAP_SAVING = 0.15;

const DAYS = 30;

interface TierUsage {
  name: string;
  users: number;
  trackedItems: number;
  checksPerDay: number;
  searchesPerMonth: number;
  revenuePerUser: number;
}

const TIERS: TierUsage[] = [
  {
    name: "Free",
    users: FREE_USERS,
    trackedItems: 2,
    checksPerDay: 2,
    searchesPerMonth: 13, // ~3/week
    revenuePerUser: AD_REVENUE_TOTAL / FREE_USERS,
  },
  {
    name: "Pro",
    users: PRO_USERS,
    trackedItems: 10,
    checksPerDay: 6, // every 4 hours (implemented)
    searchesPerMonth: 50,
    revenuePerUser: PRO_PRICE,
  },
  {
    name: "Ultimate",
    users: ULTIMATE_USERS,
    trackedItems: 20,
    checksPerDay: 24, // hourly (implemented)
    searchesPerMonth: 100,
    revenuePerUser: ULTIMATE_PRICE,
  },
];

function model(tiers: TierUsage[], label: string) {
  console.log(`\n${"=".repeat(72)}\n${label}\n${"=".repeat(72)}`);
  console.log(
    "tier".padEnd(10) +
      "users".padStart(6) +
      "tracking".padStart(10) +
      "search".padStart(9) +
      "total".padStart(9) +
      "cost".padStart(9) +
      "revenue".padStart(10) +
      "margin".padStart(9),
  );

  let totalRequests = 0;
  let totalCost = 0;
  let totalRevenue = 0;

  for (const tier of tiers) {
    // Only the Amazon slice of tracked items costs anything, and the shared
    // cache removes some duplicate checks across users.
    const amazonItems = tier.trackedItems * AMAZON_SHARE_OF_TRACKED;
    const trackingPerUser =
      amazonItems * tier.checksPerDay * DAYS * (1 - CACHE_OVERLAP_SAVING);

    // One Amazon request per search regardless of how many results come back —
    // that's the difference from Bright Data, which billed per record.
    const searchPerUser = tier.searchesPerMonth;

    const perUser = trackingPerUser + searchPerUser;
    const requests = perUser * tier.users;
    const cost = requests * COST_PER_REQUEST;
    const revenue = tier.revenuePerUser * tier.users;

    totalRequests += requests;
    totalCost += cost;
    totalRevenue += revenue;

    console.log(
      tier.name.padEnd(10) +
        String(tier.users).padStart(6) +
        Math.round(trackingPerUser * tier.users).toLocaleString().padStart(10) +
        Math.round(searchPerUser * tier.users).toLocaleString().padStart(9) +
        Math.round(requests).toLocaleString().padStart(9) +
        `$${cost.toFixed(2)}`.padStart(9) +
        `$${revenue.toFixed(2)}`.padStart(10) +
        `$${(revenue - cost).toFixed(2)}`.padStart(9),
    );
  }

  const overBudget = totalRequests > PLAN_REQUESTS;
  console.log("-".repeat(72));
  console.log(
    `TOTAL`.padEnd(26) +
      Math.round(totalRequests).toLocaleString().padStart(19) +
      `$${totalCost.toFixed(2)}`.padStart(9) +
      `$${totalRevenue.toFixed(2)}`.padStart(10) +
      `$${(totalRevenue - totalCost).toFixed(2)}`.padStart(9),
  );
  console.log(
    `\nBudget: ${Math.round(totalRequests).toLocaleString()} / ${PLAN_REQUESTS.toLocaleString()} requests ` +
      `(${Math.round((totalRequests / PLAN_REQUESTS) * 100)}%) ${overBudget ? "❌ OVER" : "✅ under"}`,
  );

  // Per-user economics is where the real problem shows up.
  console.log("\nper-user economics:");
  for (const tier of tiers) {
    const amazonItems = tier.trackedItems * AMAZON_SHARE_OF_TRACKED;
    const perUser =
      amazonItems * tier.checksPerDay * DAYS * (1 - CACHE_OVERLAP_SAVING) +
      tier.searchesPerMonth;
    const cost = perUser * COST_PER_REQUEST;
    const margin = tier.revenuePerUser - cost;
    const marginPct =
      tier.revenuePerUser > 0 ? (margin / tier.revenuePerUser) * 100 : 0;
    console.log(
      `  ${tier.name.padEnd(9)} ${Math.round(perUser).toLocaleString().padStart(7)} req  ` +
        `cost $${cost.toFixed(2).padStart(6)}  revenue $${tier.revenuePerUser.toFixed(2).padStart(6)}  ` +
        `margin $${margin.toFixed(2).padStart(6)} (${marginPct.toFixed(0)}%)`,
    );
  }
  return totalRequests;
}

model(TIERS, "SHIPPED: Pro 4h, Ultimate hourly — WITHOUT backoff");

// ---- what fixes it ---------------------------------------------------------

model(
  TIERS.map((t) =>
    t.name === "Ultimate" ? { ...t, checksPerDay: 24 } : t,
  ),
  "FIX 1: Ultimate hourly instead of every 30 min",
);

model(
  TIERS.map((t) =>
    t.name === "Ultimate"
      ? { ...t, checksPerDay: 24 }
      : t.name === "Pro"
        ? { ...t, checksPerDay: 6 } // every 4 hours
        : t,
  ),
  "FIX 2: Ultimate hourly + Pro every 4 hours",
);

// The structural fix: Amazon is the only thing that costs, so check Amazon
// items on a slower clock than everything else. A user still gets 30-minute
// checks on every store except Amazon.
const FIXED_FOR_ADAPTIVE: TierUsage[] = [
  { ...TIERS[0] },
  { ...TIERS[1], checksPerDay: 6 },
  { ...TIERS[2], checksPerDay: 24 },
];

const AMAZON_SLOWDOWN = 4;
model(
  TIERS.map((t) => ({
    ...t,
    checksPerDay: Math.max(2, t.checksPerDay / AMAZON_SLOWDOWN),
  })),
  `FIX 3 (structural): Amazon items checked ${AMAZON_SLOWDOWN}× slower than free stores`,
);

// ---- adaptive polling ------------------------------------------------------
//
// The biggest saving available, and it costs the user almost nothing.
//
// Most tracked products are boring: their price hasn't moved in weeks and
// won't move in the next hour. Checking those 24×/day buys nothing. Items that
// ARE moving deserve full attention.
//
// So: back off the interval for items that keep coming back unchanged, and
// snap straight back to full speed the moment one moves. The user still gets
// "checked hourly" on anything actually happening.

/**
 * Share of tracked items sitting still at any given moment.
 *
 * A guess, and the most load-bearing one here — but a measurable one. Once
 * there's real traffic it's just "what fraction of checks returned an
 * unchanged price", which ScrapeCheck and PriceHistory already answer.
 */
const STABLE_SHARE = 0.75;
/** Matches MAX_MULTIPLIER in lib/backoff.ts. */
const STABLE_BACKOFF = 4;

model(
  FIXED_FOR_ADAPTIVE.map((t) => ({
    ...t,
    // Blended rate: volatile items at full speed, stable ones backed off.
    checksPerDay:
      t.checksPerDay * (1 - STABLE_SHARE) +
      (t.checksPerDay / STABLE_BACKOFF) * STABLE_SHARE,
  })),
  `FIX 4 (best): adaptive — stable items checked ${STABLE_BACKOFF}× slower (${STABLE_SHARE * 100}% are stable)`,
);

// Everything together: the recommended ladder plus adaptive polling.
model(
  [
    { ...TIERS[0] },
    { ...TIERS[1], checksPerDay: 6 },
    { ...TIERS[2], checksPerDay: 24 },
  ].map((t) => ({
    ...t,
    checksPerDay:
      t.checksPerDay * (1 - STABLE_SHARE) +
      (t.checksPerDay / STABLE_BACKOFF) * STABLE_SHARE,
  })),
  "RECOMMENDED: Pro 4h + Ultimate 1h + adaptive polling",
);

// ---- what happens as it grows ---------------------------------------------
//
// The question that actually matters isn't "does 100 users fit" — it's whether
// each ADDITIONAL user pays for themselves. If per-user margin is positive,
// growth funds its own provider bill and you just move up a plan tier. If it's
// negative anywhere, growth is the thing that kills you.

console.log(`\n${"=".repeat(72)}\nGROWTH: does each new user pay for themselves?\n${"=".repeat(72)}`);

function marginPerUser(tier: TierUsage) {
  const amazonItems = tier.trackedItems * AMAZON_SHARE_OF_TRACKED;
  const requests =
    amazonItems * tier.checksPerDay * DAYS * (1 - CACHE_OVERLAP_SAVING) +
    tier.searchesPerMonth;
  return { requests, margin: tier.revenuePerUser - requests * COST_PER_REQUEST };
}

const FIXED = TIERS.map((t) =>
  t.name === "Ultimate" ? { ...t, checksPerDay: 24 } : t,
);

for (const scale of [100, 500, 1_000, 5_000]) {
  // Hold the mix constant: 4% Pro, 1% Ultimate, the rest free.
  const scaled = FIXED.map((t) => ({
    ...t,
    users: Math.round(
      scale * (t.name === "Pro" ? 0.04 : t.name === "Ultimate" ? 0.01 : 0.95),
    ),
    revenuePerUser:
      t.name === "Free" ? AD_REVENUE_TOTAL / FREE_USERS : t.revenuePerUser,
  }));

  let requests = 0;
  let revenue = 0;
  let cost = 0;
  for (const tier of scaled) {
    const per = marginPerUser(tier);
    requests += per.requests * tier.users;
    revenue += tier.revenuePerUser * tier.users;
    cost += per.requests * tier.users * COST_PER_REQUEST;
  }

  const plansNeeded = Math.ceil(requests / PLAN_REQUESTS);
  console.log(
    `${String(scale).padStart(5)} users → ` +
      `${Math.round(requests).toLocaleString().padStart(9)} req/mo  ` +
      `provider $${(plansNeeded * PLAN_MONTHLY_COST).toFixed(0).padStart(4)}  ` +
      `revenue $${revenue.toFixed(0).padStart(5)}  ` +
      `profit $${(revenue - plansNeeded * PLAN_MONTHLY_COST).toFixed(0).padStart(5)}`,
  );
}

console.log("\nmargin on ONE more user of each type (after Fix 1):");
for (const tier of FIXED) {
  const { requests, margin } = marginPerUser(tier);
  console.log(
    `  +1 ${tier.name.padEnd(9)} ${Math.round(requests).toLocaleString().padStart(6)} req  ` +
      `${margin >= 0 ? "+" : "-"}$${Math.abs(margin).toFixed(2)} ${margin >= 0 ? "✅" : "❌ loses money"}`,
  );
}

console.log(`\n${"=".repeat(72)}`);
console.log("Assumptions worth arguing with:");
console.log(`  Amazon share of tracked items: ${AMAZON_SHARE_OF_TRACKED * 100}%`);
console.log(`  Shared-cache saving:           ${CACHE_OVERLAP_SAVING * 100}%`);
console.log(`  Cost per request:              $${COST_PER_REQUEST.toFixed(5)}`);
console.log("=".repeat(72));
