// lib/splashCurves.test.ts — the launch animation's curves are valid.
//   npm run test:splash
//
// Animated.interpolate throws at RENDER time when the two ranges differ in
// length or the inputRange doesn't ascend, and TypeScript sees only two arrays.
// SplashCart renders on cold start, so either mistake breaks the app on launch
// for everyone — a strange thing to leave to eyeballing.
import { CURVES, EXIT_MS, SAFETY_MS, SWEEP_FRACTION, SWEEP_MS, withinSweep } from "./splashCurves";

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

console.log("\n— the timings are sane —");
// This plays on every cold start. Charming once, an obstacle by the twentieth.
check("the exit is brief", EXIT_MS <= 1200, EXIT_MS);
check("the cart leaves before the orange lifts", SWEEP_MS < EXIT_MS, { SWEEP_MS, EXIT_MS });
// The safety net must outlast the animation, or it fires mid-exit and cuts it
// off every single launch.
check("the safety net outlasts the animation", SAFETY_MS > EXIT_MS, { SAFETY_MS, EXIT_MS });

console.log("\n— the cart is gone before the orange lifts —");
// If any of the cart's motion outlives the sweep, the screen fades out from
// under a cart still crossing, which reads as being cut off rather than done.
for (const [name, curve] of Object.entries(CURVES)) {
  // CURVES holds curves with number outputs and curves with string ("2deg")
  // outputs, so the union defeats inference on the generic. Widening here is
  // the point of the check anyway: the shape is what's being tested.
  const squeezed = withinSweep(
    curve as { inputRange: number[]; outputRange: (number | string)[] },
  );
  const lastMoving = squeezed.inputRange[squeezed.inputRange.length - 2];
  check(`${name}: finishes within the sweep`, lastMoving <= SWEEP_FRACTION + 1e-9, {
    lastMoving,
    SWEEP_FRACTION,
  });
  check(
    `${name}: still spans to 1`,
    squeezed.inputRange[squeezed.inputRange.length - 1] === 1,
    squeezed.inputRange,
  );
  check(
    `${name}: holds its end value through the fade`,
    squeezed.outputRange[squeezed.outputRange.length - 1] ===
      squeezed.outputRange[squeezed.outputRange.length - 2],
  );
  check(
    `${name}: squeezed range still ascends`,
    squeezed.inputRange.every((n, i) => i === 0 || n > squeezed.inputRange[i - 1]),
    squeezed.inputRange,
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
