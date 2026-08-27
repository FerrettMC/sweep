// src/test-adswitch.ts — the rewarded-ads kill switch.
//   npm run test:adswitch
//
// AdMob will not approve an app that isn't publicly listed, so there is a
// guaranteed window at launch where ads cannot serve. ADS_ENABLED in the app is
// compiled in, so hiding the button there needs a store release — which is
// exactly what you can't have while waiting on an approval.
//
// This checks the switch actually reaches both places that matter: the flag the
// app reads to draw the button, AND the grant path, so a forged request or a
// stray SSV callback can't credit a search while ads are meant to be off.
import "./testEnv.js";
import { rewardedAdsEnabled } from "./lib/quota.js";

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok && detail !== undefined) console.log("     ", JSON.stringify(detail));
};

const original = process.env.REWARDED_ADS_ENABLED;

console.log("\n— the switch reads sensibly —");
delete process.env.REWARDED_ADS_ENABLED;
check("unset means ON, so nothing changes silently", rewardedAdsEnabled() === true);

process.env.REWARDED_ADS_ENABLED = "false";
check('"false" turns it off', rewardedAdsEnabled() === false);

process.env.REWARDED_ADS_ENABLED = "FALSE";
check("case doesn't matter", rewardedAdsEnabled() === false);

process.env.REWARDED_ADS_ENABLED = " false ";
check("whitespace doesn't matter", rewardedAdsEnabled() === false);

process.env.REWARDED_ADS_ENABLED = "true";
check('"true" turns it on', rewardedAdsEnabled() === true);

// Anything unrecognised must NOT silently disable a revenue feature.
process.env.REWARDED_ADS_ENABLED = "no";
check('an unrecognised value stays ON', rewardedAdsEnabled() === true);

console.log("\n— it is wired to both places —");
const quota = (await import("node:fs")).readFileSync(
  new URL("./lib/quota.ts", import.meta.url), "utf8",
);
check("canWatchAd honours it", /canWatchAd:[\s\S]{0,120}rewardedAdsEnabled\(\)/.test(quota));
// grantRewardedSearch returns null unless canWatchAd, so the switch reaches it
// through that guard rather than needing its own check.
check("the grant path is gated by canWatchAd",
  /grantRewardedSearch[\s\S]{0,400}!quota\.canWatchAd\) return null/.test(quota));

if (original === undefined) delete process.env.REWARDED_ADS_ENABLED;
else process.env.REWARDED_ADS_ENABLED = original;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
