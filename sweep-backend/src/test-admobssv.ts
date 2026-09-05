// src/test-admobssv.ts — the check that turns "I watched an ad" into proof.
//   npm run test:admobssv
//
// This is the only thing standing between the reward endpoint and anyone who
// can spell a URL, and a granted search costs real money on the Amazon leg.
//
// It is also a check that fails SILENTLY: a rejected callback means the reward
// is never credited, the user sees nothing, and the app looks merely broken.
// It shipped that way — Google signs the DECODED query content, we verified
// the encoded bytes, and every reward earned went nowhere. The vector below is
// the real callback that exposed it, kept so it cannot happen twice.
import { verifySsvCallback } from "./lib/admobSsv.js";

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok && detail !== undefined) console.log("     ", JSON.stringify(detail));
};

// A genuine AdMob callback, signed by Google's key 3335741209. Nothing here is
// secret: it is public data Google signs precisely so it can be trusted in the
// open, the signature is worthless without the private key, and the reward it
// grants was already consumed. Note `Extra%20Search` — the encoded space is
// the whole reason this file exists.
const REAL =
  "ad_network=5450213213286189855&ad_unit=7550371235&reward_amount=1" +
  "&reward_item=Extra%20Search&timestamp=1788571568618" +
  "&transaction_id=00065ab2405ce4110742508d1a31b0fb" +
  "&user_id=ad921f7f-1f1b-403e-b589-076442668bf0" +
  "&signature=MEUCIQDtk7XrzC5alpVp0B0ZaqQpjBiNbzvwU-F1vTvDnnng4QIgaJxzM-hWjwd4tDz8mJcpPRDWxc4mBshwTfT5a4WKJ2Q" +
  "&key_id=3335741209";

console.log("\n— a real callback, encoded space and all —");
const real = await verifySsvCallback(REAL);

if (!real.valid && real.reason.startsWith("couldn't load verifier keys")) {
  // Google's key server being unreachable is not a regression in this code.
  console.log("  ⏭️  SKIPPED — can't reach Google's key server");
  console.log("     ", real.reason);
} else {
  check("verifies", real.valid, real.valid ? undefined : real.reason);
  if (real.valid) {
    check("credits the right user", real.userId === "ad921f7f-1f1b-403e-b589-076442668bf0", real.userId);
    check("carries the transaction id", real.transactionId === "00065ab2405ce4110742508d1a31b0fb", real.transactionId);
    check("reads the amount", real.amount === 1, real.amount);
  }

  console.log("\n— tampering is caught —");
  // Each of these is a free search, minted by editing a URL, if the signature
  // is not actually being checked over the exact content.
  const tampered: [string, string][] = [
    ["a bigger reward", REAL.replace("reward_amount=1", "reward_amount=999")],
    ["someone else's account", REAL.replace("user_id=ad921f7f", "user_id=bd921f7f")],
    ["a replayed id", REAL.replace("transaction_id=00065ab2", "transaction_id=10065ab2")],
    ["a different ad unit", REAL.replace("ad_unit=7550371235", "ad_unit=7550371236")],
    ["reordered parameters", REAL.replace(
      "ad_network=5450213213286189855&ad_unit=7550371235",
      "ad_unit=7550371235&ad_network=5450213213286189855",
    )],
    ["a flipped signature byte", REAL.replace("signature=MEUCIQDt", "signature=MEUCIQDu")],
  ];
  for (const [label, query] of tampered) {
    const result = await verifySsvCallback(query);
    check(`rejects ${label}`, !result.valid, result);
  }

  console.log("\n— an unknown key is not trusted —");
  const wrongKey = await verifySsvCallback(REAL.replace("key_id=3335741209", "key_id=1"));
  check("rejects an unknown key_id", !wrongKey.valid && wrongKey.reason.includes("unknown key_id"), wrongKey);
}

console.log("\n— malformed callbacks are refused, not crashed on —");
// These fail before any crypto, so they need no network.
const malformed: [string, string][] = [
  ["no signature", "user_id=a&transaction_id=b"],
  ["no key_id", "user_id=a&transaction_id=b&signature=x"],
  ["no user_id", "transaction_id=b&signature=x&key_id=3335741209"],
  ["no transaction_id", "user_id=a&signature=x&key_id=3335741209"],
  ["empty", ""],
];
for (const [label, query] of malformed) {
  const result = await verifySsvCallback(query);
  check(`refuses ${label}`, !result.valid, result);
}

// A user_id missing means the ad request never carried
// serverSideVerificationOptions, which is an app-side bug with a specific fix.
// The reason has to say so or it reads as a mystery.
const noUser = await verifySsvCallback("transaction_id=b&signature=x&key_id=3335741209");
check(
  "and says WHY user_id is missing",
  !noUser.valid && noUser.reason.includes("serverSideVerificationOptions"),
  noUser,
);

// A stray "%" must not throw out of the decoder.
const badEncoding = await verifySsvCallback(
  "user_id=100%&transaction_id=b&reward_item=x&signature=MEUCIQD&key_id=3335741209",
);
check("survives an undecodable value", !badEncoding.valid, badEncoding);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
