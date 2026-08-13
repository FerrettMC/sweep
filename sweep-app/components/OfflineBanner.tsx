// components/OfflineBanner.tsx
//
// A persistent strip across the top when the backend can't be reached.
//
// Sweep is almost entirely a server-side product — prices, history, quotas and
// tiers all live on the API, and none of it is cached locally. Offline, the
// screens fall back to their defaults, which reads as "free tier, nothing
// tracked" rather than "we don't know yet". This exists so the user is told
// which of those is happening.
//
// Rendered above the navigator rather than per-screen so it can't be forgotten
// on a screen added later.

import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type Palette, spacing, type } from "@/constants/theme";
import { useIsOnline } from "@/lib/connection";
import { useTheme, useThemedStyles } from "@/lib/theme";

export default function OfflineBanner() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const online = useIsOnline();
  // Sits at the very top of the window, above the navigator and therefore
  // above anything that would otherwise pad for the status bar. On a punch-hole
  // display the camera lands squarely in it without this.
  const insets = useSafeAreaInsets();

  if (online) return null;

  return (
    <View style={[styles.banner, { paddingTop: insets.top + spacing.sm }]}>
      <Ionicons name="cloud-offline-outline" size={14} color={colors.background} />
      <Text style={styles.text}>
        No connection — Sweep needs internet for prices, and anything on screen
        may be out of date.
      </Text>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    banner: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: colors.warning,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    text: {
      flex: 1,
      color: colors.background,
      fontSize: type.caption.fontSize,
      fontWeight: "700",
      lineHeight: 15,
    },
  });
