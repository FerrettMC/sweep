// app/notifications.tsx
//
// What you missed.
//
// Push notifications are an interruption, not a record: they land on a lock
// screen and are gone the moment they're swiped. Someone whose phone was off,
// who never granted permission, or who dismissed one by accident has no way to
// find out a price dropped — which makes the whole feature feel unreliable
// even on the occasions it worked perfectly.
//
// This is the record. It exists for everyone, including people push never
// reaches at all.
//
// It also does not expire. These used to be deleted after thirty days, which
// meant the record quietly emptied itself — someone who tracked a price for a
// season came back to a bell that had thrown away the drops it caught. The
// only thing that removes one now is its owner deleting it.

import { useCallback, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import ConfirmDialog, { type ConfirmContent } from "@/components/ConfirmDialog";
import { EmptyState, Loading, Screen } from "@/components/ui";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { useTranslate } from "@/lib/i18n";
import {
  type AppNotification,
  clearNotifications,
  deleteNotification,
  getNotifications,
  markNotificationsRead,
} from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import { linkify } from "@/lib/linkify";
import { setUnreadCount } from "@/lib/unreadCount";

/**
 * Follow a link that came from the server.
 *
 * The href is stored text — a price drop builds one, and an announcement can
 * carry whatever path was typed when it was sent. A build that predates a
 * route, or a typo at send time, would otherwise throw inside a tap handler
 * and take the screen down with it.
 *
 * Failing to navigate is a dead tap, which is bad. Crashing the notifications
 * screen is worse.
 */
function useOpenHref() {
  const router = useRouter();
  return (href: string) => {
    try {
      router.push(href as never);
    } catch {
      // Nowhere to go. The row stays where it is.
    }
  };
}

/** Icon per kind, with a fallback so a kind added later still renders. */
const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  "price-drop": "trending-down-outline",
  "radar-match": "radio-outline",
  announcement: "megaphone-outline",
};

export default function Notifications() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();
  const openHref = useOpenHref();

  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const load = useCallback(async () => {
    try {
      const { notifications } = await getNotifications();
      setItems(notifications);
      // Cleared on arrival, not on fetch, which is why the server keeps these
      // as two calls: the badge should go when you look, and a background
      // refresh shouldn't silently mark things seen.
      await markNotificationsRead().catch(() => {});
      // Clears the header badge immediately rather than waiting for whatever
      // screen happens to refetch next.
      setUnreadCount(0);
    } catch {
      setItems([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /**
   * Remove the row first, then tell the server.
   *
   * Deleting is the only thing that shortens this list, so it has to feel
   * immediate. If the request fails the row comes back — better a row that
   * reappears than one that looks deleted and returns on the next refresh.
   */
  async function onDelete(item: AppNotification) {
    const previous = items ?? [];
    setItems(previous.filter((n) => n.id !== item.id));
    try {
      await deleteNotification(item.id);
    } catch {
      setItems(previous);
    }
  }

  async function onClearAll() {
    setConfirmingClear(false);
    const previous = items ?? [];
    setItems([]);
    try {
      await clearNotifications();
    } catch {
      setItems(previous);
    }
  }

  if (items === null) return <Loading />;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
            tintColor={colors.accent}
          />
        }
      >
        {/* Says the quiet part out loud: this is a record, not an inbox that
            drains. Without it, "clear all" reads as the only way the list is
            ever meant to end up empty. */}
        {items.length > 0 && (
          <View style={styles.head}>
            <Text style={styles.kept}>{t("notifications.kept")}</Text>
            <Pressable
              onPress={() => setConfirmingClear(true)}
              hitSlop={10}
              accessibilityRole="button"
            >
              <Text style={styles.clearText}>{t("notifications.clearAll")}</Text>
            </Pressable>
          </View>
        )}

        {items.length === 0 ? (
          <EmptyState
            title={t("notifications.emptyTitle")}
            body={t("notifications.emptyBody")}
          />
        ) : (
          items.map((item) => {
            const row = (
              <View style={styles.row}>
                <View style={styles.iconWrap}>
                  <Ionicons
                    name={ICONS[item.kind] ?? "notifications-outline"}
                    size={17}
                    color={colors.accent}
                  />
                </View>
                <View style={styles.body}>
                  <Text style={styles.title} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text style={styles.text}>
                    {linkify(item.body).map((part, i) =>
                      part.url ? (
                        <Text
                          key={i}
                          style={styles.link}
                          onPress={() => void Linking.openURL(part.url!).catch(() => {})}
                        >
                          {part.text}
                        </Text>
                      ) : (
                        part.text
                      ),
                    )}
                  </Text>
                  <Text style={styles.when}>{formatRelativeTime(item.createdAt)}</Text>
                </View>
                {/* Only shown where there's somewhere to go, so the chevron
                    never promises a tap that does nothing. */}
                {item.href && (
                  <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                )}
                {/* Its own target, set well apart from the row's: on a card
                    that opens a product, a stray tap must never be the
                    difference between looking at a deal and erasing it. */}
                <Pressable
                  onPress={() => void onDelete(item)}
                  hitSlop={8}
                  style={({ pressed }) => [styles.delete, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`${t("notifications.delete")} ${item.title}`}
                >
                  <Ionicons name="close" size={16} color={colors.textTertiary} />
                </Pressable>
              </View>
            );

            return item.href ? (
              <Pressable
                key={item.id}
                onPress={() => openHref(item.href!)}
                style={({ pressed }) => [styles.card, pressed && styles.pressed]}
              >
                {row}
              </Pressable>
            ) : (
              <View key={item.id} style={styles.card}>
                {row}
              </View>
            );
          })
        )}
      </ScrollView>

      <ConfirmDialog
        content={
          confirmingClear
            ? {
                title: t("notifications.clearTitle"),
                body: t("notifications.clearBody"),
                icon: "trash-outline",
                confirmLabel: t("notifications.clearConfirm"),
                cancelLabel: t("notifications.cancel"),
                destructive: true,
              }
            : null
        }
        onConfirm={() => void onClearAll()}
        onCancel={() => setConfirmingClear(false)}
      />
    </Screen>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    content: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
    head: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.xs,
    },
    kept: { color: colors.textTertiary, fontSize: type.caption.fontSize },
    clearText: {
      color: colors.textSecondary,
      fontSize: type.caption.fontSize,
      fontWeight: "700",
    },
    delete: {
      paddingLeft: spacing.sm,
      paddingVertical: spacing.xs,
      alignItems: "center",
      justifyContent: "center",
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.md,
    },
    pressed: { opacity: 0.75 },
    row: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
    iconWrap: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: colors.accentMuted,
      alignItems: "center",
      justifyContent: "center",
    },
    body: { flex: 1, gap: 2 },
    title: {
      color: colors.textPrimary,
      fontSize: type.label.fontSize,
      fontWeight: "700",
    },
    text: { color: colors.textSecondary, fontSize: type.caption.fontSize, lineHeight: 17 },
    link: { color: colors.accent, fontWeight: "700" },
    when: { color: colors.textTertiary, fontSize: type.caption.fontSize },
  });
