// lib/splashCurves.test.ts — the launch animation's curves are valid.
//   npm run test:splash
//
// Animated.interpolate throws at RENDER time when the two ranges differ in
// length or the inputRange doesn't ascend, and TypeScript sees only two arrays.
// SplashCart renders on cold start, so either mistake breaks the app on launch
// for everyone — a strange thing to leave to eyeballing.
import { CURVES, EDGE_FADE, TRAVEL_MS, APPEAR_DELAY_MS } from "./splashCurves";

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok && detail !== undefined) console.log("     ", JSON.stringify(detail));
};

console.log("\n— every curve is well formed —");
for (const [name, curve] of Object.entries(CURVES)) {
  const { inputRange, outputRange } = curve;
  check(`${name}: ranges are the same length`, inputRange.length === outputRange.length, {
    in: inputRange.length,
    out: outputRange.length,
  });
  check(
    `${name}: inputRange ascends`,
    inputRange.every((n, i) => i === 0 || n > inputRange[i - 1]),
    inputRange,
  );
  check(
    `${name}: spans the whole drive`,
    inputRange[0] === 0 && inputRange[inputRange.length - 1] === 1,
    inputRange,
  );
}

console.log("\n— the loop is seamless —");
// The driver snaps 1 -> 0 on every repeat. Anything visible at that moment
// teleports across the screen.
const ends = EDGE_FADE.outputRange;
check("invisible at both ends", ends[0] === 0 && ends[ends.length - 1] === 0, ends);
for (const [name, curve] of Object.entries(CURVES)) {
  const out = curve.outputRange;
  check(`${name}: ends where it began`, out[0] === out[out.length - 1], [out[0], out[out.length - 1]]);
}

console.log("\n— the timings are sane —");
check("a traverse is slow enough to watch", TRAVEL_MS >= 1500, TRAVEL_MS);
check("a warm start shows nothing at all", APPEAR_DELAY_MS >= 120, APPEAR_DELAY_MS);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
