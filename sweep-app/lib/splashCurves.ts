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

/**
 * The exit: cart in from the left, logo swept away, orange lifted.
 *
 * Deliberately short. This runs on EVERY cold start, and an animation that
 * charms once is an obstacle by the twentieth time someone opens the app.
 */
export const EXIT_MS = 900;

/** How long the cart takes to leave, as a fraction of the exit. The orange
 *  only starts lifting after this, so the screen doesn't fade out from under
 *  the cart while it's still crossing. */
export const SWEEP_MS = 620;

/** Half a breath while waiting: 1.0 to 1.04 and back. */
export const HOLD_PULSE_MS = 1100;

/**
 * Force-unmount the splash after this, no matter what.
 *
 * An interrupted Animated timing does not reliably fire its completion
 * callback, and this overlay covers the entire app — so "the animation didn't
 * finish" would mean "the app never appears". Generously longer than EXIT_MS,
 * because it should only ever fire when something has genuinely gone wrong.
 */
export const SAFETY_MS = 2500;

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

/** Four bumps as the cart crosses, up quickly and down slowly. */
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

export const CURVES = { bob: BOB_CURVE, tilt: TILT_CURVE };

/**
 * Hide the native splash after this even if the logo never decoded.
 *
 * We ask the native splash to stay open and then hide it once our own logo has
 * painted. If that image fails — corrupt asset, bad build — the callback never
 * arrives and the splash we asked to persist persists forever, leaving an app
 * that cannot be opened at all. Short, because by this point the only thing
 * being protected is a flash.
 */
export const NATIVE_HIDE_BAIL_MS = 1200;

/** Where the cart has finished crossing, as a fraction of the whole exit. */
export const SWEEP_FRACTION = SWEEP_MS / EXIT_MS;

/**
 * Squeeze a 0-to-1 curve into the sweep, holding its final value afterwards.
 *
 * The cart has to be gone BEFORE the orange starts lifting, or the screen
 * fades out from underneath a cart still halfway across — which reads as the
 * animation being cut off rather than finishing. Everything the cart does is
 * therefore run inside the sweep and pinned at its end value for the fade.
 */
export function withinSweep<T>(curve: { inputRange: number[]; outputRange: T[] }) {
  const last = curve.outputRange[curve.outputRange.length - 1];
  return {
    inputRange: [...curve.inputRange.map((n) => n * SWEEP_FRACTION), 1],
    outputRange: [...curve.outputRange, last],
  };
}
