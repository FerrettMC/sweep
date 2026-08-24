// components/AnimatedSplash.tsx
//
// The orange launch screen, continued in JavaScript so it can move.
//
// The native splash CANNOT be animated through Expo. expo-splash-screen takes
// an image, a background colour and a fade duration, and that's the whole API —
// Android 12+ does support an animated icon natively, but the plugin doesn't
// expose it and it's capped at about a second anyway.
//
// So this does what apps that appear to animate their splash actually do. The
// native splash is held open, this renders on top matching it EXACTLY — same
// orange, same logo, same 100dp width, same centre — and only then is the
// native one hidden underneath. Nothing changes on screen at that moment, so
// the handover is invisible and the orange screen looks like it came alive.
//
// Matching exactly is the whole trick, and it's also the fragile part: if
// app.json's splash `imageWidth`, `image` or `backgroundColor` change, the two
// stop lining up and the handover becomes a visible jump. Those values are
// mirrored in SPLASH below with a note saying so.
//
// TWO SAFETY NETS, because both failure modes here brick the app on launch:
//
//   If hideAsync() never runs, the native splash stays up forever and the app
//   looks frozen. It's called on first layout, in a catch-all.
//
//   If the exit animation's callback is lost — an interrupted animation doesn't
//   always fire — this overlay never unmounts and covers the app permanently.
//   A timer force-finishes it regardless.

import { useCallback, useEffect, useRef } from "react";
import {
  AccessibilityInfo,
  Animated,
  Dimensions,
  Easing,
  Image,
  StyleSheet,
  View,
} from "react-native";
import * as SplashScreen from "expo-splash-screen";
import { Ionicons } from "@expo/vector-icons";
import {
  CURVES,
  EXIT_MS,
  HOLD_PULSE_MS,
  NATIVE_HIDE_BAIL_MS,
  SAFETY_MS,
  SWEEP_FRACTION,
  withinSweep,
} from "@/lib/splashCurves";

/**
 * Mirrors the `expo-splash-screen` block in app.json. If that changes, change
 * this — they have to render identically or the handover is a visible jump.
 *
 * imageWidth is the plugin's default of 100 rather than a value we set, so it
 * doesn't appear in app.json. That's worth knowing before "fixing" it here.
 */
const SPLASH = {
  backgroundColor: "#fc5430",
  imageWidth: 100,
};

const CART_SIZE = 46;

export default function AnimatedSplash({
  appReady,
  onFinished,
}: {
  /** True once the session and onboarding checks have both resolved. */
  appReady: boolean;
  /** Called when this overlay is done and safe to unmount. */
  onFinished: () => void;
}) {
  // Breathing while we wait. Without it a slow start is a completely static
  // screen, which reads as a hang rather than as loading.
  const pulse = useRef(new Animated.Value(0)).current;
  // Drives the whole exit: cart across, logo away, screen out.
  const exit = useRef(new Animated.Value(0)).current;
  const width = Dimensions.get("window").width;

  const finished = useRef(false);
  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onFinished();
  }, [onFinished]);

  // Hide the native splash only once the LOGO has decoded — not merely when
  // the container has laid out, which can happen a frame or two earlier and
  // hands over to an orange screen with no logo on it. This is the ordering
  // Expo's own with-splash-screen example uses, and it's the whole reason the
  // handover is invisible.
  const nativeHidden = useRef(false);
  const hideNative = useCallback(() => {
    if (nativeHidden.current) return;
    nativeHidden.current = true;
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  // If the logo never decodes — a corrupt asset, a bad build — onLoadEnd never
  // fires, and the native splash we asked to stay open stays open forever. The
  // app would be unopenable, so it is hidden on a timer regardless.
  useEffect(() => {
    const bail = setTimeout(hideNative, NATIVE_HIDE_BAIL_MS);
    return () => clearTimeout(bail);
  }, [hideNative]);

  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => {
        if (cancelled || reduced) return;
        loop = Animated.loop(
          Animated.sequence([
            Animated.timing(pulse, {
              toValue: 1,
              duration: HOLD_PULSE_MS,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(pulse, {
              toValue: 0,
              duration: HOLD_PULSE_MS,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
          ]),
        );
        loop.start();
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [pulse]);

  useEffect(() => {
    if (!appReady) return;

    // Belt and braces: if the animation is interrupted its callback may never
    // arrive, and this overlay covers the entire app.
    const safety = setTimeout(finish, SAFETY_MS);

    const run = Animated.timing(exit, {
      toValue: 1,
      duration: EXIT_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    run.start(() => finish());

    return () => {
      clearTimeout(safety);
      run.stop();
    };
  }, [appReady, exit, finish]);

  // Hold: the logo breathes, 1.0 to 1.04 and back.
  const logoPulse = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] });

  // Exit: the cart rolls in from the left, crosses the centre, and leaves.
  //
  // Measured from the CENTRE, not the left edge, because the cart sits in a
  // centring layer — so 0 is the middle of the screen and the travel is half a
  // screen either side plus enough to clear the glyph.
  const offscreen = width / 2 + CART_SIZE * 1.5;
  const travel = withinSweep({ inputRange: [0, 1], outputRange: [-offscreen, offscreen] });
  const bob = withinSweep(CURVES.bob);
  const tilt = withinSweep(CURVES.tilt);

  const cartX = exit.interpolate(travel);
  const cartBob = exit.interpolate(bob);
  const cartTilt = exit.interpolate(tilt);

  // The logo goes as the cart reaches it — swept out of the way rather than
  // simply cross-fading, which is the beat the whole thing is built around.
  const logoOpacity = exit.interpolate({
    inputRange: [0, 0.32 * SWEEP_FRACTION, 0.5 * SWEEP_FRACTION],
    outputRange: [1, 1, 0],
    extrapolate: "clamp",
  });
  const logoShift = exit.interpolate({
    inputRange: [0, 0.32 * SWEEP_FRACTION, 0.5 * SWEEP_FRACTION],
    outputRange: [0, 0, 42],
    extrapolate: "clamp",
  });
  const logoScale = Animated.multiply(
    logoPulse,
    exit.interpolate({
      inputRange: [0, 0.32 * SWEEP_FRACTION, 0.5 * SWEEP_FRACTION],
      outputRange: [1, 1, 0.82],
      extrapolate: "clamp",
    }),
  );

  // The orange lifts last, once the cart is genuinely gone — everything above
  // is squeezed into SWEEP_FRACTION for exactly this reason.
  const screenOpacity = exit.interpolate({
    inputRange: [0, SWEEP_FRACTION, 1],
    outputRange: [1, 1, 0],
  });

  return (
    <Animated.View
      style={[styles.screen, { opacity: screenOpacity }]}
      pointerEvents="none"
    >
      <Animated.View
        style={{
          opacity: logoOpacity,
          transform: [{ translateX: logoShift }, { scale: logoScale }],
        }}
      >
        <Image
          source={require("@/assets/images/splash-icon.png")}
          style={styles.logo}
          resizeMode="contain"
          onLoadEnd={hideNative}
          // No cross-fade on load: the image must appear at full opacity in the
          // same frame it decodes, or the handover flickers.
          fadeDuration={0}
        />
      </Animated.View>

      {/* A full-screen centring layer, so the cart's translateX is measured
          from the middle of the screen and it crosses THROUGH the logo rather
          than passing above or below it. Absolute positioning plus alignSelf
          does not reliably centre in React Native; this does. */}
      <View style={styles.cartLayer} pointerEvents="none">
        <Animated.View
          style={{
            transform: [
              { translateX: cartX },
              { translateY: cartBob },
              { rotate: cartTilt },
            ],
          }}
        >
          <Ionicons name="cart" size={CART_SIZE} color="#ffffff" />
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: SPLASH.backgroundColor,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: SPLASH.imageWidth,
    height: SPLASH.imageWidth,
  },
  cartLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});
