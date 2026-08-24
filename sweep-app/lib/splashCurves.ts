// lib/splashCurves.ts
//
// The shape of the launch animation, as data.
//
// Split from the component for the same reason chartGeometry is: this is the
// part that can be wrong in a way the type checker cannot see. Animated
// interpolations throw at RENDER time when inputRange and outputRange differ in
// length, or when inputRange doesn't ascend — and TypeScript sees only two
// arrays and is satisfied.
//
// That would be a nuisance in most components. Here it is not: SplashCart is
// what renders on cold start, before anything else, so a bad curve breaks the
// app on launch for everyone rather than on a screen most people never open.
//
// Keeping the numbers here means they can be tested as values, without pulling
// react-native into a test runner that can't transform it.

/** How far the cart rises over each bump, in points. */
export const BOB = 3.5;

/** One traverse, left to right. Slow enough to read as a stroll, not a dash. */
export const TRAVEL_MS = 2600;

/**
 * Nothing is drawn for this long after mount.
 *
 * A warm start resolves the session in well under this, and a splash that
 * appears for 80ms is a flash rather than a loading state — worse than the
 * blank it replaced. Below the threshold the handover stays invisible; above
 * it, the animation fades up and does its job.
 */
export const APPEAR_DELAY_MS = 180;
export const APPEAR_MS = 260;

/** Four bumps per traverse, up quickly and down slowly. */
export const BOB_CURVE = {
  inputRange: [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1],
  outputRange: [0, -BOB, 0, -BOB, 0, -BOB, 0, -BOB, 0],
};

/**
 * Tilt lags the bob by half a bump, so the cart leans into each rise and
 * settles after it. That lag is what sells "wheels" on a glyph whose wheels
 * cannot actually turn.
 */
export const TILT_CURVE = {
  inputRange: [0, 0.0625, 0.1875, 0.3125, 0.4375, 0.5625, 0.6875, 0.8125, 0.9375, 1],
  outputRange: ["0deg", "-2deg", "2deg", "-2deg", "2deg", "-2deg", "2deg", "-2deg", "2deg", "0deg"],
};

/**
 * Arrives and leaves, so the loop's snap back to the left edge is never seen.
 *
 * Both ends MUST be 0. The driver jumps 1 -> 0 on every repeat, and anything
 * visible at that moment teleports across the screen.
 */
export const EDGE_FADE = {
  inputRange: [0, 0.08, 0.92, 1],
  outputRange: [0, 1, 1, 0],
};

export const CURVES = { bob: BOB_CURVE, tilt: TILT_CURVE, edges: EDGE_FADE };
