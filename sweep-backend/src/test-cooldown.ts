// src/test-cooldown.ts — the per-retailer circuit breaker.
//   npm run test:cooldown     (no server or database needed)
//
// Uses an injected clock, so two-minute waits cost nothing.
import {
  COOLDOWN_MS,
  __reset,
  __setClock,
  cooldownRemaining,
  cooldownState,
  isCoolingDown,
  noteBlocked,
  noteSuccess,
} from "./lib/scrapers/cooldown.js";

let pass = 0,
  fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok && detail !== undefined) console.log("     ", JSON.stringify(detail));
};

let clock = 0;
function useClock() {
  clock = 1_000_000;
  __setClock(() => clock);
}
const advance = (ms: number) => (clock += ms);

console.log("\n— a block opens the circuit —");
__reset();
useClock();
check("healthy retailer is not cooling down", !isCoolingDown("walmart"));
noteBlocked("walmart");
check("blocked retailer is cooling down", isCoolingDown("walmart"));
check("cooldown is ~2 minutes", cooldownRemaining("walmart") === COOLDOWN_MS, {
  remaining: cooldownRemaining("walmart"),
});
check("other retailers are unaffected", !isCoolingDown("bestbuy"));

console.log("\n— it reopens on its own —");
advance(COOLDOWN_MS - 1);
check("still closed one tick early", isCoolingDown("walmart"));
advance(2);
check("open once the window passes", !isCoolingDown("walmart"));

console.log("\n— repeat offences back off further —");
__reset();
useClock();
noteBlocked("walmart");
const first = cooldownRemaining("walmart");
advance(COOLDOWN_MS + 1);
noteBlocked("walmart");
const second = cooldownRemaining("walmart");
check("second cooldown is longer than the first", second > first, { first, second });
advance(second + 1);
noteBlocked("walmart");
const third = cooldownRemaining("walmart");
check("third is longer again", third > second, { second, third });

console.log("\n— but escalation is capped —");
__reset();
useClock();
// A retailer that blocks us again the instant each cooldown ends — the case
// escalation exists for.
const waits: number[] = [];
for (let i = 0; i < 12; i++) {
  noteBlocked("walmart");
  const wait = cooldownRemaining("walmart");
  waits.push(wait);
  advance(wait + 1);
}
// Without a cap, 12 doublings from 2 minutes is over five days.
check("cap holds at 30 minutes", Math.max(...waits) === 30 * 60 * 1000, {
  waits: waits.map((w) => w / 1000),
});
check("escalation actually reaches the cap, not just the 4th strike",
  waits.filter((w) => w === 30 * 60 * 1000).length >= 3,
  { waits: waits.map((w) => w / 1000) });

console.log("\n— behaving for a while forgives the streak —");
__reset();
useClock();
noteBlocked("walmart");
advance(COOLDOWN_MS + 1);
noteBlocked("walmart");
const escalated = cooldownRemaining("walmart");
advance(escalated + 16 * 60 * 1000); // quiet for longer than the streak window,
                                     // measured from when the circuit closed
noteBlocked("walmart");
check("a fresh incident starts back at 2 minutes",
  cooldownRemaining("walmart") === COOLDOWN_MS,
  { remaining: cooldownRemaining("walmart"), escalated });

console.log("\n— a success clears it —");
__reset();
useClock();
noteBlocked("walmart");
advance(COOLDOWN_MS + 1);
noteSuccess("walmart");
noteBlocked("walmart");
check("post-recovery block is not an escalation",
  cooldownRemaining("walmart") === COOLDOWN_MS);

console.log("\n— a success mid-cooldown does NOT cancel the pause —");
__reset();
useClock();
noteBlocked("walmart");
advance(1000);
// Something already in flight when the circuit opened can still land.
noteSuccess("walmart");
check("still cooling down", isCoolingDown("walmart"), {
  remaining: cooldownRemaining("walmart"),
});

console.log("\n— diagnostics —");
__reset();
useClock();
noteBlocked("newegg");
const state = cooldownState();
check("reports the paused retailer", state.newegg?.remainingMs > 0, state);
check("omits healthy ones", state.walmart === undefined, state);

__reset();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
