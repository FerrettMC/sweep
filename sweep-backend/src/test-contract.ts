// src/test-contract.ts — the API promises old app versions rely on.
//   npm run test:contract     (no server or database needed)
//
// Apps update on the user's schedule, not ours. A phone can sit on a build
// from weeks ago and still call this backend every day, so anything an old
// client reads has to keep existing and keep meaning the same thing.
//
// The rule this file enforces: BACKEND CHANGES ARE ADDITIVE.
//
//   ✅ add a field, add an endpoint, add an enum value with a fallback
//   ❌ remove a field, rename a field, change a type, delete an endpoint
//
// When an endpoint genuinely has to change shape, add a new one beside it —
// /search/start exists next to /search for exactly this reason, and the old
// one stays until nobody is on a build that calls it.
import { assertNotProduction } from "./testEnv.js";
assertNotProduction();

import Fastify from "fastify";
import { getPlans } from "./lib/plans.js";
import { RETAILERS, RETAILER_LABELS } from "./lib/scrapers/types.js";
import { searchRoutes } from "./routes/search.js";
import { radarRoutes } from "./routes/radar.js";
import { leaderboardRoutes } from "./routes/leaderboard.js";
import { productRoutes } from "./routes/products.js";
import { listRoutes } from "./routes/lists.js";
import { budgetRoutes } from "./routes/budget.js";
import { authRoutes } from "./routes/auth.js";
import { dealRoutes } from "./routes/deals.js";
import { notificationRoutes } from "./routes/notifications.js";
import { sweepRoutes } from "./routes/sweep.js";

let pass = 0,
  fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok && detail !== undefined) console.log("     ", JSON.stringify(detail).slice(0, 300));
};

// ---- which routes exist ----------------------------------------------------
const routes = new Set<string>();
const app = Fastify({ logger: false });
app.addHook("onRoute", (r) => {
  for (const m of [r.method].flat()) routes.add(`${m} ${r.url}`);
});
await app.register(searchRoutes);
await app.register(radarRoutes);
await app.register(leaderboardRoutes);
await app.register(productRoutes);
await app.register(listRoutes);
await app.register(budgetRoutes);
await app.register(authRoutes);
await app.register(dealRoutes);
await app.register(notificationRoutes);
await app.register(sweepRoutes);
await app.ready();

/**
 * Endpoints shipped builds call. Deleting one strands every phone that hasn't
 * updated, and phones update whenever their owner feels like it.
 */
const REQUIRED = [
  "GET /search",                    // build 6 and earlier — blocking search
  "GET /search/quota",
  "GET /search/retailers",
  "POST /radar/:id/refresh",        // build 6 and earlier — blocking refresh
  "GET /plans",
  "GET /radar",
  "POST /radar",
  "DELETE /radar/:id",
];

console.log("— endpoints old builds still call —");
for (const route of REQUIRED) {
  check(route, routes.has(route), [...routes].filter((r) => r.includes(route.split(" ")[1])));
}

// ---- shapes ----------------------------------------------------------------
console.log("\n— /plans keeps the fields the app reads —");
const plans = getPlans("en");
check("three tiers", plans.length === 3, plans.map((p) => p.tier));
for (const plan of plans) {
  const ok =
    typeof plan.tier === "string" &&
    typeof plan.name === "string" &&
    typeof plan.summary === "string" &&
    typeof plan.pricing?.monthly !== "undefined" &&
    Array.isArray(plan.upgrades) &&
    Array.isArray(plan.features);
  check(`${plan.tier}: core fields present`, ok);
}

// `id` was added so clients could stop matching on translated labels. Both
// must stay: older builds still read `label`.
const dial = plans.find((p) => p.tier === "pro")!.upgrades[0];
check("upgrades carry both id and label", typeof dial.id === "string" && typeof dial.label === "string", dial);

console.log("\n— every retailer has a label —");
// The app falls back to the raw id, so a missing label is cosmetic rather than
// fatal — but an old build showing "etsy" instead of "Etsy" is still a
// regression, and it costs nothing to keep this complete.
const missing = RETAILERS.filter((r) => !RETAILER_LABELS[r]);
check("no retailer without a label", missing.length === 0, missing);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
