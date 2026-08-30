// lib/sheetInsets.check.mjs — top-anchored sheets clear the status bar.
//   npm run test:sheets
//
// On Android a Modal renders UNDER the status bar, so a sheet anchored to the
// top with a fixed padding puts its own top edge on the clock. Three of the six
// sheets in the app had this and three didn't, which is what "some popups
// overlap the time" looks like from the outside.
//
// It cannot be caught by the type checker and it is invisible on a simulator
// with no notch, so it gets a file scan instead: any sheet that anchors to the
// top must use useSheetTopInset, which measures the Android status bar
// directly. useSafeAreaInsets is NOT enough here and was the first, silently
// broken attempt at this fix: a Modal is its own native window on Android and
// the hook can return a top inset of 0 inside one.
//
// Plain .mjs rather than .ts, the way i18n/checkKeys.mjs is: it reads files off
// disk, and the app's tsconfig has no Node types — a .ts version breaks the
// app's own typecheck, which is a worse problem than the one it solves.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "components");

let pass = 0, fail = 0;
const check = (label, ok, detail) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok && detail !== undefined) console.log("     ", JSON.stringify(detail));
};

const topAnchored = readdirSync(dir)
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => ({ name: f, source: readFileSync(join(dir, f), "utf8") }))
  .filter((f) => f.source.includes('justifyContent: "flex-start"') && f.source.includes("Modal"));

console.log("\n— every top-anchored sheet clears the status bar —");
check("found the sheets to check", topAnchored.length >= 5, topAnchored.length);

for (const { name, source } of topAnchored) {
  check(
    `${name} clears the status bar`,
    source.includes("useSheetTopInset") && /paddingTop:\s*topInset/.test(source),
    name,
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
