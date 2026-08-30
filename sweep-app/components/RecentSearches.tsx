// components/RecentSearches.tsx
//
// The searches you've already paid for, offered back.
//
// A compiled search costs real money on the Amazon leg, and until now there was
// no way back to one — you retyped the keyword and, if the shared cache had
// expired, bought the same answer a second time.
//
// Reopening spends no quota and touches no retailer: the server rebuilds the
// result from products it already holds. That is worth saying on screen rather
// than leaving people to guess, because "search" and "costs a search" are the
// same word to anyone who hasn't read the pricing page.
//
// Prices come back live, so a search reopened next week shows next week's
// prices. It isn't a screenshot.

import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { useTranslate } from "@/lib/i18n";
import { formatRelativeTime } from "@/lib/format";
import type { HistoryEntry } from "@/lib/api";

export default function RecentSearches({
  searches,
  busyId,
  onOpen,
  onForget,
  onClear,
}: {
  searches: HistoryEntry[];
  /** The one being reopened, so its row can show it's working. */
  busyId: string | null;
  onOpen: (entry: HistoryEntry) => void;
  onForget: (entry: HistoryEntry) => void;
  onClear: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();

  if (searches.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.headText}>
          <Text style={styles.title}>{t("search.recent")}</Text>
          <Text style={styles.free}>{t("search.recentFree")}</Text>
        </View>
        <Pressable onPress={onClear} hitSlop={10} style={styles.clear}>
          <Text style={styles.clearText}>{t("search.recentClear")}</Text>
        </Pressable>
      </View>

      {/*
        Bounded and scrollable. These are direct children of a plain View, not
        of a list, so ten rows would simply run off the bottom of the screen —
        and Ultimate keeps two hundred. flexShrink lets the box size to its
        contents while it is short and stops it growing past the space that is
        actually left.
      */}
      <ScrollView
        style={styles.card}
        contentContainerStyle={styles.cardContent}
        showsVerticalScrollIndicator={false}
        // Otherwise a scroll that starts on a row is swallowed as a tap.
        keyboardShouldPersistTaps="handled"
      >
        {searches.map((entry, index) => (
          <View
            key={entry.id}
            style={[styles.row, index > 0 && styles.rowDivided]}
          >
            <Pressable
              style={({ pressed }) => [styles.main, pressed && styles.pressed]}
              onPress={() => onOpen(entry)}
              disabled={busyId !== null}
              accessibilityRole="button"
              accessibilityLabel={entry.keyword}
            >
              <Ionicons
                name={busyId === entry.id ? "hourglass-outline" : "time-outline"}
                size={17}
                color={colors.textTertiary}
              />
              <View style={styles.text}>
                <Text style={styles.keyword} numberOfLines={1}>
                  {entry.keyword}
                </Text>
                <Text style={styles.meta}>
                  {t("search.recentMeta", {
                    results: entry.resultCount,
                    when: formatRelativeTime(entry.searchedAt),
                  })}
                </Text>
              </View>
            </Pressable>

            {/* Its own target, well clear of the row's — a stray tap here
                should never be the difference between opening a search and
                deleting it. */}
            <Pressable
              onPress={() => onForget(entry)}
              disabled={busyId !== null}
              hitSlop={6}
              style={({ pressed }) => [styles.forget, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`${t("search.recentClear")} ${entry.keyword}`}
            >
              <Ionicons name="close" size={16} color={colors.textTertiary} />
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    // Screen supplies no horizontal padding — every child on this screen
    // brings its own, and spacing.md is what the search bar and the results
    // list use. Without it this sat flush against both edges.
    wrap: {
      gap: spacing.sm,
      marginTop: spacing.md,
      paddingHorizontal: spacing.md,
      // Takes what's left rather than a fixed height, so it adapts to the
      // screen rather than guessing at one. Shrink AND a bounded grow: the box
      // is content-sized with two searches and capped at the available space
      // with two hundred.
      flexShrink: 1,
      minHeight: 0,
    },
    head: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
    headText: { flex: 1, gap: 1 },
    title: {
      color: colors.textSecondary,
      fontSize: type.caption.fontSize,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    free: { color: colors.textTertiary, fontSize: type.caption.fontSize },
    clear: { paddingVertical: 2 },
    clearText: {
      color: colors.accent,
      fontSize: type.caption.fontSize,
      fontWeight: "700",
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      overflow: "hidden",
      // Grows only to its contents; the wrap's flexShrink caps it.
      flexGrow: 0,
    },
    cardContent: { flexGrow: 0 },
    row: { flexDirection: "row", alignItems: "center" },
    rowDivided: { borderTopWidth: 1, borderTopColor: colors.surfaceBorder },
    main: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingLeft: spacing.md,
      // 48dp of row either way.
      paddingVertical: 12,
    },
    pressed: { opacity: 0.6 },
    text: { flex: 1, gap: 1 },
    keyword: {
      color: colors.textPrimary,
      fontSize: type.label.fontSize,
      fontWeight: "700",
    },
    meta: { color: colors.textTertiary, fontSize: type.caption.fontSize },
    forget: {
      paddingHorizontal: spacing.md,
      paddingVertical: 14,
      alignItems: "center",
      justifyContent: "center",
    },
  });
