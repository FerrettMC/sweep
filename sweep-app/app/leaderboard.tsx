// app/leaderboard.tsx
//
// Standings, your level, and where your XP came from.
//
// XP is earned by FINDING deals — a tracked item dropping below its own
// historical average — never by buying anything. That's what makes the board
// worth looking at: it ranks judgement, not spending, and every point is
// computed server-side from price history rather than claimed by a client.

import { useCallback, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { Button, Loading, Screen, SectionTitle } from "@/components/ui";
import { colors, radius, spacing, type } from "@/constants/theme";
import UsernameSheet from "@/components/UsernameSheet";
import {
  type Badge,
  type LeaderboardEntry,
  type LeaderboardMe,
  type XpEntry,
  getLeaderboard,
  getMyXp,
} from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";

const TIER_COLOR: Record<Badge["tier"], string> = {
  bronze: "#C08457",
  silver: "#B9C2CC",
  gold: colors.accent,
};

export default function LeaderboardScreen() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [me, setMe] = useState<LeaderboardMe | null>(null);
  const [history, setHistory] = useState<XpEntry[]>([]);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [editingName, setEditingName] = useState(false);
  const [username, setUsernameValue] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [board, xp] = await Promise.all([
      getLeaderboard().catch(() => null),
      getMyXp().catch(() => null),
    ]);
    if (board) {
      setEntries(board.entries);
      setMe(board.me);
    }
    if (xp) {
      setHistory(xp.history);
      setUsernameValue(xp.username);
      setBadges(xp.badges);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (loading) return <Loading />;

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
        {me && (
          <View style={styles.levelCard}>
            <View style={styles.levelTop}>
              <View style={styles.levelLeft}>
                <Text style={styles.levelLabel}>LEVEL {me.level}</Text>
                <Text style={styles.levelTitle}>{me.title}</Text>
                <Pressable
                  onPress={() => setEditingName(true)}
                  hitSlop={8}
                  style={styles.nameRow}
                >
                  <Text style={styles.levelName} numberOfLines={1}>
                    {me.name}
                  </Text>
                  <Ionicons name="pencil" size={12} color={colors.textTertiary} />
                </Pressable>
              </View>
              <View style={styles.rankPill}>
                <Text style={styles.rankPillText}>#{me.rank}</Text>
              </View>
            </View>

            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${Math.round(me.progress * 100)}%` },
                ]}
              />
            </View>
            <Text style={styles.progressText}>
              {me.xp} XP · {me.nextLevelXp - me.xp} to level {me.level + 1}
            </Text>
          </View>
        )}

        {/* Without a username the board shows an anonymous handle — offer the
            fix where the consequence is visible. */}
        {me && !me.hasUsername && (
          <Pressable
            style={styles.nameNudge}
            onPress={() => setEditingName(true)}
          >
            <Ionicons name="person-outline" size={16} color={colors.accent} />
            <Text style={styles.nameNudgeText}>
              You're showing as <Text style={styles.bold}>{me.name}</Text>. Pick a
              username.
            </Text>
            <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
          </Pressable>
        )}

        <View style={styles.section}>
          <SectionTitle>Badges</SectionTitle>
          <Text style={styles.sectionBlurb}>
            Earned from deals you've actually found. Cosmetic — they don't
            unlock features.
          </Text>
          <View style={styles.badgeGrid}>
            {badges.map((badge) => (
              <View
                key={badge.id}
                style={[styles.badge, !badge.earned && styles.badgeLocked]}
              >
                <Ionicons
                  name={badge.icon as never}
                  size={20}
                  color={badge.earned ? TIER_COLOR[badge.tier] : colors.textTertiary}
                />
                <Text
                  style={[styles.badgeLabel, !badge.earned && styles.badgeLabelLocked]}
                  numberOfLines={1}
                >
                  {badge.label}
                </Text>
                <Text style={styles.badgeProgress} numberOfLines={1}>
                  {badge.progressLabel}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <SectionTitle>Top deal hunters</SectionTitle>
          {entries.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                Nobody's on the board yet. Track something and you'll earn XP the
                first time it drops below its average.
              </Text>
            </View>
          ) : (
            <View style={styles.board}>
              {entries.map((entry, index) => (
                <View
                  key={`${entry.rank}-${entry.name}`}
                  style={[
                    styles.row,
                    index > 0 && styles.rowDivided,
                    entry.isMe && styles.rowMe,
                  ]}
                >
                  <Text style={[styles.rank, entry.rank <= 3 && styles.rankTop]}>
                    {entry.rank}
                  </Text>
                  <View style={styles.nameCol}>
                    <Text
                      style={[styles.name, entry.isMe && styles.nameMe]}
                      numberOfLines={1}
                    >
                      {entry.name}
                      {entry.isMe ? "  (you)" : ""}
                    </Text>
                    <Text style={styles.entryTitle}>{entry.title}</Text>
                  </View>
                  <Text style={styles.lvl}>Lv {entry.level}</Text>
                  <Text style={styles.xp}>{entry.xp}</Text>
                </View>
              ))}
            </View>
          )}

          {me?.offList && (
            <View style={[styles.board, styles.offList]}>
              <View style={[styles.row, styles.rowMe]}>
                <Text style={styles.rank}>{me.rank}</Text>
                <Text style={[styles.name, styles.nameMe]} numberOfLines={1}>
                  {me.name}  (you)
                </Text>
                <Text style={styles.lvl}>Lv {me.level}</Text>
                <Text style={styles.xp}>{me.xp}</Text>
              </View>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <SectionTitle>How you earned it</SectionTitle>
          {history.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                XP comes from deals you find — when something you track drops
                below its usual price. Nothing here yet.
              </Text>
            </View>
          ) : (
            <View style={styles.board}>
              {history.map((entry, index) => (
                <View
                  key={entry.id}
                  style={[styles.historyRow, index > 0 && styles.rowDivided]}
                >
                  <View style={styles.historyText}>
                    <Text style={styles.historyTitle} numberOfLines={1}>
                      {entry.productTitle ?? reasonLabel(entry.reason)}
                    </Text>
                    <Text style={styles.historyDetail}>
                      {entry.detail} · {formatRelativeTime(entry.at)}
                    </Text>
                  </View>
                  <Text style={styles.historyXp}>+{entry.xp}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      <UsernameSheet
        visible={editingName}
        current={username}
        onClose={() => setEditingName(false)}
        onSaved={load}
      />
    </Screen>
  );
}

function reasonLabel(reason: string) {
  if (reason === "first_track") return "First product tracked";
  if (reason === "deal_found") return "Deal found";
  return reason;
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl },
  levelCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accentMuted,
    padding: spacing.md,
    gap: spacing.sm,
  },
  levelTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  levelLeft: { flex: 1, gap: 1 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  levelName: {
    color: colors.textSecondary,
    fontSize: type.label.fontSize,
    fontWeight: "700",
  },
  levelLabel: {
    color: colors.accent,
    fontSize: type.caption.fontSize,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  levelTitle: {
    color: colors.textPrimary,
    fontSize: type.title.fontSize,
    fontWeight: "900",
  },
  rankPill: {
    backgroundColor: colors.accentMuted,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  rankPillText: { color: colors.accent, fontSize: type.heading.fontSize, fontWeight: "900" },
  progressTrack: {
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: colors.accent, borderRadius: radius.pill },
  progressText: { color: colors.textSecondary, fontSize: type.caption.fontSize },

  nameNudge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accentMuted,
    padding: spacing.md,
  },
  nameNudgeText: { flex: 1, color: colors.textSecondary, fontSize: type.label.fontSize },
  bold: { color: colors.textPrimary, fontWeight: "800" },
  nameCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    padding: spacing.md,
    gap: spacing.sm,
  },
  nameLabel: { color: colors.textPrimary, fontSize: type.body.fontSize, fontWeight: "700" },
  nameInput: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: type.body.fontSize,
  },
  nameError: { color: colors.danger, fontSize: type.caption.fontSize },
  nameActions: { flexDirection: "row", gap: spacing.sm },
  nameAction: { flex: 1 },

  section: { gap: spacing.xs },
  sectionBlurb: {
    color: colors.textSecondary,
    fontSize: type.caption.fontSize,
    marginBottom: spacing.xs,
  },
  badgeGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  badge: {
    width: "31%",
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    padding: spacing.sm,
    gap: 2,
    alignItems: "center",
  },
  badgeLocked: { opacity: 0.45 },
  badgeLabel: {
    color: colors.textPrimary,
    fontSize: type.caption.fontSize,
    fontWeight: "800",
    textAlign: "center",
  },
  badgeLabelLocked: { color: colors.textSecondary },
  badgeProgress: {
    color: colors.textTertiary,
    fontSize: type.caption.fontSize,
    textAlign: "center",
  },
  nameCol: { flex: 1, gap: 1 },
  entryTitle: { color: colors.textTertiary, fontSize: type.caption.fontSize },
  board: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  offList: { marginTop: spacing.sm, borderColor: colors.accentMuted },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
  },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.surfaceBorder },
  rowMe: { backgroundColor: colors.surfaceRaised },
  rank: {
    color: colors.textTertiary,
    fontSize: type.label.fontSize,
    fontWeight: "800",
    width: 26,
  },
  rankTop: { color: colors.accent },
  name: { flex: 1, color: colors.textPrimary, fontSize: type.body.fontSize, fontWeight: "600" },
  nameMe: { fontWeight: "800" },
  lvl: { color: colors.textTertiary, fontSize: type.caption.fontSize },
  xp: {
    color: colors.textPrimary,
    fontSize: type.label.fontSize,
    fontWeight: "800",
    width: 46,
    textAlign: "right",
  },

  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  historyText: { flex: 1, gap: 1 },
  historyTitle: { color: colors.textPrimary, fontSize: type.label.fontSize, fontWeight: "600" },
  historyDetail: { color: colors.textTertiary, fontSize: type.caption.fontSize },
  historyXp: { color: colors.success, fontSize: type.body.fontSize, fontWeight: "800" },

  empty: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    borderStyle: "dashed",
    padding: spacing.md,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: type.label.fontSize,
    lineHeight: 18,
    textAlign: "center",
  },
});
