// components/Toast.tsx
//
// The confirmation that appears after adding something to the cart.
//
// Sits above the tab bar rather than at the top of the screen: the action that
// triggers it is usually a row somewhere down a long list, and feedback that
// renders off-screen is the same as none.
//
// Rendered once at the root so every screen shares it, and so it survives the
// screen underneath re-rendering or navigating.

import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { useToast } from "@/lib/toast";

export default function Toast() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const toast = useToast();
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, {
      toValue: toast ? 1 : 0,
      duration: toast ? 140 : 220,
      useNativeDriver: true,
    }).start();
    // Keyed on the id, not the message, so an identical repeat animates again
    // rather than sitting still and looking like the tap missed.
  }, [toast?.id, toast, fade]);

  if (!toast) return null;

  return (
    <Animated.View
      style={[styles.wrap, { opacity: fade }]}
      pointerEvents="none"
      accessibilityLiveRegion="polite"
    >
      <View style={styles.pill}>
        <Ionicons
          name={toast.tone === "ok" ? "checkmark-circle" : "alert-circle"}
          size={16}
          color={toast.tone === "ok" ? colors.success : colors.danger}
        />
        <Text style={styles.text}>{toast.message}</Text>
      </View>
    </Animated.View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    wrap: {
      position: "absolute",
      left: 0,
      right: 0,
      // Clear of the tab bar, so it never covers the thing someone might tap
      // next.
      bottom: 96,
      alignItems: "center",
    },
    pill: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      backgroundColor: colors.surfaceRaised,
      borderColor: colors.surfaceBorder,
      borderWidth: 1,
      borderRadius: radius.pill,
      paddingVertical: 10,
      paddingHorizontal: spacing.md,
      maxWidth: "88%",
    },
    text: {
      color: colors.textPrimary,
      fontSize: type.label.fontSize,
      fontWeight: "600",
      flexShrink: 1,
    },
  });
