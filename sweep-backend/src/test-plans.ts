// src/test-plans.ts — the pricing page tells the truth.
//   npm run test:plans
//
// Everything on the plans screen is generated from TIER_LIMITS so it can't
// drift from what the server enforces — but only if every number that moves
// between tiers is actually listed. A perk that exists and isn't advertised is
// one nobody upgrades for.
//
// It also checks both locales carry every string used, since a missing key
// renders as the raw key on a screen whose entire job is asking for money.
import "./testEnv.js";
import { getPlans } from "./lib/plans.js";
import { TIER_LIMITS, TIERS } from "./lib/tiers.js";

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok && detail !== undefined) console.log("     ", JSON.stringify(detail));
};

for (const locale of ["en", "es"] as const) {
  console.log(`\n— ${locale} —`);
  const plans = getPlans(locale);
  check("every tier has a plan", plans.length === TIERS.length, plans.length);

  for (const plan of plans) {
    const labels = plan.features.map((f) => f.label);
    // A raw key on screen looks like a crash to anyone reading it.
    check(
      `${plan.tier}: no untranslated keys`,
      !labels.some((l) => /^(plan|dial|summary)\./.test(l)),
      labels.filter((l) => /^(plan|dial|summary)\./.test(l)),
    );
    check(`${plan.tier}: no empty labels`, !labels.some((l) => !l.trim()));
  }
}

console.log("\n— the limits that move are all advertised —");
// If a number differs between tiers, someone is paying for the difference and
// should be able to see it before they do.
const plans = getPlans("en");
const text = plans.map((p) => p.features.map((f) => f.label).join(" | ")).join(" || ");

for (const [name, read] of [
  ["searches a day", (t: keyof typeof TIER_LIMITS) => TIER_LIMITS[t].searchesPerDay],
  ["tracked products", (t: keyof typeof TIER_LIMITS) => TIER_LIMITS[t].maxTrackedProducts],
  ["lookups a day", (t: keyof typeof TIER_LIMITS) => TIER_LIMITS[t].lookupsPerDay],
  ["reopenable searches", (t: keyof typeof TIER_LIMITS) => TIER_LIMITS[t].searchHistoryLimit],
] as const) {
  const values = TIERS.map(read);
  const moves = new Set(values).size > 1;
  const shown = values.every((v) => text.includes(String(v)));
  check(`${name} moves between tiers`, moves, values);
  check(`${name}: every value appears on a plan`, shown, values);
}

console.log("\n— search history specifically —");
for (const plan of plans) {
  const limit = TIER_LIMITS[plan.tier].searchHistoryLimit;
  const line = plan.features.find((f) => f.label.includes("Reopen your last"));
  check(`${plan.tier} advertises reopening`, Boolean(line), plan.tier);
  check(`${plan.tier} advertises ${limit}`, Boolean(line?.label.includes(String(limit))), line?.label);
  // The saving is the selling point; the number alone reads as a storage cap.
  check(`${plan.tier} says it is free`, Boolean(line?.label.toLowerCase().includes("free")), line?.label);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
