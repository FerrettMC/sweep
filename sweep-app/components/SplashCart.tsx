// components/SplashCart.tsx
//
// What fills the gap on a cold start, while the session is being restored and
// we don't yet know which screen to send anyone to.
//
// That gap used to render `null`, which meant the native splash handed over to
// an empty coloured rectangle for however long the auth check took. On a fast
// phone with a warm cache that's a blink; on a cold start over bad mobile data
// it's long enough to look broken.
//
// One shared driver runs the whole thing. The bob and the tilt are derived from
// the same 0→1 value as the travel, so they can't drift out of sync with it the
// way three independent loops eventually would — and it's one animation on the
// native side rather than three.

import { useEffect, useRef } from "react";
import {
  AccessibilityInfo,
  Animated,
  Dimensions,
  Easing,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { type Palette, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { useTranslate } from "@/lib/i18n";
import {
  APPEAR_DELAY_MS,
  APPEAR_MS,
  BOB,
  CURVES,
  TRAVEL_MS,
} from "@/lib/splashCurves";

const CART_SIZE = 54;

export default function SplashCart() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();
  const drive = useRef(new Animated.Value(0)).current;
  const appear = useRef(new Animated.Value(0)).current;
  const width = Dimensions.get("window").width;

  useEffect(() => {
    const fade = Animated.timing(appear, {
      toValue: 1,
      delay: APPEAR_DELAY_MS,
      duration: APPEAR_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    fade.start();
    return () => fade.stop();
  }, [appear]);

  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;

    // Someone who has asked their phone to reduce motion has asked for a
    // reason, and a looping animation is exactly what that setting is about.
    // They get the cart, sitting still.
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => {
        if (cancelled || reduced) return;
        loop = Animated.loop(
          Animated.timing(drive, {
            toValue: 1,
            duration: TRAVEL_MS,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
        );
        loop.start();
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [drive]);

  // Starts and ends fully off-screen, so the loop's jump back to the left edge
  // happens where nobody can see it.
  const translateX = drive.interpolate({
    inputRange: [0, 1],
    outputRange: [-CART_SIZE, width + CART_SIZE],
  });

  const translateY = drive.interpolate({
    inputRange: [...CURVES.bob.inputRange],
    outputRange: [...CURVES.bob.outputRange],
  });

  const rotate = drive.interpolate({
    inputRange: [...CURVES.tilt.inputRange],
    outputRange: [...CURVES.tilt.outputRange],
  });

  const opacity = drive.interpolate({
    inputRange: [...CURVES.edges.inputRange],
    outputRange: [...CURVES.edges.outputRange],
  });

  return (
    <Animated.View style={[styles.screen, { opacity: appear }]}>
      <View style={styles.stage}>
        <Animated.View
          style={[styles.cart, { opacity, transform: [{ translateX }, { translateY }, { rotate }] }]}
        >
          <Ionicons name="cart" size={CART_SIZE} color={colors.accent} />
        </Animated.View>
        {/* The ground it rolls along. Without it the cart floats in space and
            the bob reads as a wobble rather than as wheels. */}
        <View style={styles.ground} />
      </View>
      <Text style={styles.tagline}>{t("home.tagline")}</Text>
    </Animated.View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.background,
    },
    stage: {
      width: "100%",
      height: CART_SIZE + BOB * 2,
      justifyContent: "flex-end",
    },
    cart: {
      position: "absolute",
      bottom: 0,
      left: 0,
    },
    ground: {
      height: 1,
      width: "100%",
      backgroundColor: colors.surfaceBorder,
    },
    tagline: {
      marginTop: spacing.xl,
      color: colors.textTertiary,
      fontSize: type.label.fontSize,
      fontWeight: "600",
      textAlign: "center",
      paddingHorizontal: spacing.xl,
    },
  });
