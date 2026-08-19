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
import { useTranslate } from "@/lib/i18n";
import { refreshUnreadCount, useUnreadCount } from "@/lib/unreadCount";
import { Ionicons } from "@expo/vector-icons";
import { Link, Tabs } from "expo-router";
import { useEffect } from "react";
import {
  AppState,
  type ColorValue,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

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

/**
 * The bell, beside the profile button on every tab.
 *
 * Hidden at zero rather than shown empty: a bell with nothing behind it
 * invites a tap that leads nowhere, and a permanent icon that is usually inert
 * stops being looked at.
 */
function BellButton() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const unread = useUnreadCount();

  // Checked on mount and whenever the app is brought back, which is when a
  // notification is most likely to have arrived while it was closed.
  useEffect(() => {
    void refreshUnreadCount();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshUnreadCount();
    });
    return () => subscription.remove();
  }, []);

  if (unread === 0) return null;

  return (
    <Link href="/notifications" asChild>
      <Pressable hitSlop={12} style={({ pressed }) => pressed && styles.pressed}>
        <View style={styles.profileButton}>
          <Ionicons name="notifications" size={17} color={colors.textSecondary} />
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unread > 9 ? "9+" : unread}</Text>
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

/** Both header buttons, in one row so they can't drift apart. */
function HeaderButtons() {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.headerButtons}>
      <BellButton />
      <ProfileButton />
    </View>
  );
}

function ProfileButton() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();
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
  const t = useTranslate();
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
        headerRight: () => <HeaderButtons />,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("tabs.home"),
          tabBarIcon: tabIcon("home", "home-outline"),
        }}
      />
      <Tabs.Screen
        name="tracking"
        options={{
          title: t("tabs.tracking"),
          tabBarIcon: tabIcon("bookmark", "bookmark-outline"),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: t("tabs.search"),
          tabBarIcon: tabIcon("search", "search-outline"),
        }}
      />
      <Tabs.Screen
        name="deals"
        options={{
          title: t("tabs.deals"),
          tabBarIcon: tabIcon("flame", "flame-outline"),
        }}
      />
    </Tabs>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    headerButtons: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    badge: {
      position: "absolute",
      top: -3,
      right: -3,
      minWidth: 16,
      height: 16,
      borderRadius: 8,
      paddingHorizontal: 4,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    badgeText: { color: "#fff", fontSize: 10, fontWeight: "800" },
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
