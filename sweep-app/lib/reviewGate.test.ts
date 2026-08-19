// lib/reviewGate.test.ts — the rating prompt's rules.
//   npm run test:review     (plain node, no device or emulator)
import { MIN_AGE_MS, shouldAskForReview, type ReviewGateInput } from "./reviewGate";

let pass = 0,
  fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok && detail !== undefined) console.log("     ", JSON.stringify(detail));
};

const NOW = 1_700_000_000_000;
const DAY_OLD = NOW - MIN_AGE_MS - 1;

const base: ReviewGateInput = {
  actionsCompleted: 1,
  firstSeenAt: DAY_OLD,
  alreadyAsked: false,
  reviewAvailable: true,
  now: NOW,
};
const gate = (over: Partial<ReviewGateInput> = {}) =>
  shouldAskForReview({ ...base, ...over });

console.log("\n— the happy path —");
check("asks after a day, tracking one product", gate().ask);

console.log("\n— one completed action is enough —");
check("one action qualifies", gate({ actionsCompleted: 1 }).ask);
check("zero actions does not", !gate({ actionsCompleted: 0 }).ask);

console.log("\n— never twice, under any combination —");
// The guarantee: no other input may override alreadyAsked.
const permutations: Partial<ReviewGateInput>[] = [];
for (const actionsCompleted of [0, 1, 5, 100]) {
  for (const firstSeenAt of [null, NOW, DAY_OLD, 0]) {
    for (const reviewAvailable of [true, false]) {
      permutations.push({ actionsCompleted, firstSeenAt, reviewAvailable, alreadyAsked: true });
    }
  }
}
const asked = permutations.filter((p) => gate(p).ask);
check(
  `all ${permutations.length} permutations stay silent once asked`,
  asked.length === 0,
  asked.slice(0, 3),
);
const decision = gate({ alreadyAsked: true });
check("reason is already-asked", !decision.ask && decision.reason === "already-asked", decision);

console.log("\n— the day of ownership —");
check("silent on install day", !gate({ firstSeenAt: NOW }).ask);
check("silent one millisecond early", !gate({ firstSeenAt: NOW - MIN_AGE_MS + 1 }).ask);
check("asks once the day has passed", gate({ firstSeenAt: NOW - MIN_AGE_MS - 1 }).ask);
check("silent with no install date recorded", !gate({ firstSeenAt: null }).ask);

console.log("\n— platform —");
check("silent where no review flow exists", !gate({ reviewAvailable: false }).ask);

console.log("\n— reasons are specific enough to debug —");
const reasons = [
  [gate({ alreadyAsked: true }), "already-asked"],
  [gate({ actionsCompleted: 0 }), "no-actions"],
  [gate({ firstSeenAt: null }), "no-first-seen"],
  [gate({ firstSeenAt: NOW }), "too-new"],
  [gate({ reviewAvailable: false }), "unavailable"],
] as const;
for (const [got, want] of reasons) {
  check(`${want}`, !got.ask && got.reason === want, got);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
