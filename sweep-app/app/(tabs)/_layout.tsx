// app/(tabs)/_layout.tsx
//
// Four tabs: Home, Tracking, Search, Deals.
//
// Home is the landing screen and the way into everything that doesn't warrant
// a permanent slot — budget, lists, plan, profile. The tab bar is reserved for
// the screens you open repeatedly; anything else is a shortcut on Home.
//
// Icons are Ionicons (@expo/vector-icons), which ships with Expo as a font
// rather than a native module, so it needs no rebuild. Outline when inactive,
// filled when active.

import { type Palette, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { Ionicons } from "@expo/vector-icons";
import { Link, Tabs } from "expo-router";
import { type ColorValue, Pressable, StyleSheet, View } from "react-native";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

function tabIcon(active: IoniconName, inactive: IoniconName) {
  return ({ color, focused }: { color: ColorValue; focused: boolean }) => (
    <Ionicons
      name={focused ? active : inactive}
      size={24}
      color={color as string}
    />
  );
}

function ProfileButton() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Link href="/profile" asChild>
      <Pressable
        hitSlop={12}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <View style={styles.profileButton}>
          <Ionicons name="person" size={17} color={colors.textSecondary} />
        </View>
      </Pressable>
    </Link>
  );
}

export default function TabLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        // The scene container defaults to the system background. On a dark-only
        // app that's a white flash between navigations.
        sceneStyle: { backgroundColor: colors.background },
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
          title: "Home",
          tabBarIcon: tabIcon("home", "home-outline"),
        }}
      />
      <Tabs.Screen
        name="tracking"
        options={{
          title: "Tracking",
          tabBarIcon: tabIcon("bookmark", "bookmark-outline"),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "Search",
          tabBarIcon: tabIcon("search", "search-outline"),
        }}
      />
      <Tabs.Screen
        name="deals"
        options={{
          title: "Deals",
          tabBarIcon: tabIcon("flame", "flame-outline"),
        }}
      />
    </Tabs>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    profileButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.surfaceRaised,
      alignItems: "center",
      justifyContent: "center",
      marginRight: spacing.md,
    },
    pressed: { opacity: 0.6 },
  });
