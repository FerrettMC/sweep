// app/(tabs)/_layout.tsx
//
// Four tabs for the core loop — Tracking, Search, Deals, Budget — with the
// profile reachable from the header rather than spending a tab slot on it.

import { Link, Tabs } from "expo-router";
import { type ColorValue, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, spacing, type } from "@/constants/theme";

/**
 * Text glyphs instead of an icon font. expo-symbols renders SF Symbols on iOS
 * but falls back to Material names on Android, and the starter template's
 * placeholder mapping pointed every tab at the same "code" icon. These read
 * correctly on both platforms with no asset pipeline.
 */
function TabIcon({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={[styles.icon, { color }]}>{glyph}</Text>;
}

function ProfileButton() {
  return (
    <Link href="/profile" asChild>
      <Pressable hitSlop={12} style={({ pressed }) => pressed && styles.pressed}>
        <View style={styles.profileButton}>
          <Text style={styles.profileGlyph}>👤</Text>
        </View>
      </Pressable>
    </Link>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.surfaceBorder,
        },
        tabBarLabelStyle: {
          fontSize: type.caption.fontSize,
          fontWeight: "700",
        },
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { fontWeight: "800" },
        headerShadowVisible: false,
        headerRight: () => <ProfileButton />,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Tracking",
          tabBarIcon: ({ color }) => <TabIcon glyph="📌" color={color} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "Search",
          tabBarIcon: ({ color }) => <TabIcon glyph="🔍" color={color} />,
        }}
      />
      <Tabs.Screen
        name="deals"
        options={{
          title: "Deals",
          tabBarIcon: ({ color }) => <TabIcon glyph="🔥" color={color} />,
        }}
      />
      <Tabs.Screen
        name="budget"
        options={{
          title: "Budget",
          tabBarIcon: ({ color }) => <TabIcon glyph="💰" color={color} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  icon: { fontSize: 20 },
  profileButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },
  profileGlyph: { fontSize: 15 },
  pressed: { opacity: 0.6 },
});
