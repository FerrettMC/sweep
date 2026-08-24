// lib/splashConfig.check.mjs — the animated splash still matches the native one.
//   npm run test:splash-config
//
// AnimatedSplash paints over the native splash and only then hides it. That
// handover is invisible ONLY while the two render identically — same orange,
// same logo, same size, same position. Change app.json's splash block without
// changing the component and launch gains a visible jump, which is precisely
// the thing the component exists to avoid.
//
// Plain .mjs rather than .ts on purpose, the way i18n/checkKeys.mjs is: it
// reads files from disk, and the app's tsconfig has no Node types.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appJson = JSON.parse(readFileSync(join(root, "app.json"), "utf8"));
const component = readFileSync(join(root, "components/AnimatedSplash.tsx"), "utf8");

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok) {
    failed++;
    if (detail !== undefined) console.log("     ", JSON.stringify(detail));
  }
};

const plugin = (appJson.expo.plugins ?? []).find(
  (p) => Array.isArray(p) && p[0] === "expo-splash-screen",
);

console.log("\n— the animated splash matches app.json —");

if (!plugin) {
  check("expo-splash-screen is configured", false, "no plugin entry in app.json");
} else {
  const config = plugin[1] ?? {};

  const declaredColor = component.match(/backgroundColor:\s*"(#[0-9a-fA-F]{3,8})"/)?.[1];
  check(
    "background colour matches",
    declaredColor?.toLowerCase() === config.backgroundColor?.toLowerCase(),
    { appJson: config.backgroundColor, component: declaredColor },
  );

  // imageWidth is the plugin's default of 100 when app.json doesn't set it —
  // which it currently doesn't, so this catches someone adding it there and
  // forgetting here just as much as the other way round.
  const expectedWidth = config.imageWidth ?? 100;
  const declaredWidth = Number(component.match(/imageWidth:\s*(\d+)/)?.[1]);
  check("image width matches", declaredWidth === expectedWidth, {
    appJson: expectedWidth,
    component: declaredWidth,
  });

  const image = config.image?.split("/").pop();
  check(
    "the same image is used",
    Boolean(image) && component.includes(image),
    { appJson: image },
  );

  // "contain" is what the component's <Image> hardcodes. Any other mode would
  // scale the logo differently from the native splash.
  check("resize mode is contain", (config.resizeMode ?? "contain") === "contain", config.resizeMode);
}

console.log(failed === 0 ? "\nall matched" : `\n${failed} MISMATCH — the handover will jump`);
process.exit(failed === 0 ? 0 : 1);
