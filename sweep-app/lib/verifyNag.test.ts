// lib/verifyNag.test.ts — when the "confirm your email" banner appears.
//   npm run test:verify-nag     (plain node, no device)
import { SNOOZE_MS, shouldShowVerifyNag } from "./verifyNag";

let pass = 0,
  fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok && detail !== undefined) console.log("     ", JSON.stringify(detail));
};

const NOW = 1_700_000_000_000;
const show = (over: Partial<Parameters<typeof shouldShowVerifyNag>[0]> = {}) =>
  shouldShowVerifyNag({ unconfirmed: true, snoozedUntil: 0, now: NOW, ...over });

console.log("\n— the basics —");
check("shows for an unconfirmed address", show());
check("silent once confirmed", !show({ unconfirmed: false }));
check("silent when nobody is signed in", !show({ unconfirmed: false, snoozedUntil: 0 }));

console.log("\n— loading is not the same as not-snoozed —");
// If these behaved the same the banner would render for one frame at launch
// and then vanish, which reads as a glitch.
check("silent while the snooze is still being read", !show({ snoozedUntil: null }));
check("shows once read and never snoozed", show({ snoozedUntil: 0 }));

console.log("\n— the snooze window —");
const snoozed = NOW + SNOOZE_MS;
check("silent immediately after dismissing", !show({ snoozedUntil: snoozed }));
check("silent one ms before it lapses", !show({ snoozedUntil: NOW + 1 }));
check("shows the instant it lapses", show({ snoozedUntil: NOW }));
check("shows well after it lapses", show({ snoozedUntil: NOW - 1 }));
check("snooze is three days", SNOOZE_MS === 3 * 24 * 60 * 60 * 1000, SNOOZE_MS);

console.log("\n— confirming always wins —");
// Whatever the snooze says, a confirmed address must never be nagged.
const windows = [null, 0, NOW - 1, NOW, NOW + 1, snoozed, Number.MAX_SAFE_INTEGER];
check(
  `silent for all ${windows.length} snooze states once confirmed`,
  windows.every((snoozedUntil) => !show({ unconfirmed: false, snoozedUntil })),
);

console.log("\n— it never blocks —");
// There is deliberately no "blocked" state to assert: this module only ever
// answers show-or-not. Asserted here so a future change that adds gating has
// to delete this line and think about it.
check(
  "the only outcome is a boolean",
  typeof show() === "boolean" && typeof show({ unconfirmed: false }) === "boolean",
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
