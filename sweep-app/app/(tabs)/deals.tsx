// app/(tabs)/deals.tsx
//
// "Best Deals Found" — the community feed. Scheduled for the next pass: the
// price-drop detection it reads from already exists (see the scheduler's
// change log in sweep-backend/src/lib/scheduler.ts), so this becomes a real
// screen once the feed endpoint lands.

import { StyleSheet, Text, View } from "react-native";
import { Screen } from "@/components/ui";
import { colors, radius, spacing, type } from "@/constants/theme";

export default function DealsScreen() {
  return (
    <Screen>
      <View style={styles.container}>
        <Text style={styles.glyph}>🔥</Text>
        <Text style={styles.title}>Best Deals Found</Text>
        <Text style={styles.body}>
          When any tracked product drops well below its historical average, it
          shows up here for everyone — real deals other people are actually
          watching.
        </Text>
        <View style={styles.pill}>
          <Text style={styles.pillText}>COMING IN THE NEXT UPDATE</Text>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.sm,
  },
  glyph: { fontSize: 44 },
  title: { color: colors.textPrimary, fontSize: type.title.fontSize, fontWeight: "800" },
  body: {
    color: colors.textSecondary,
    fontSize: type.body.fontSize,
    textAlign: "center",
    lineHeight: 21,
  },
  pill: {
    marginTop: spacing.md,
    backgroundColor: colors.accentMuted,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  pillText: { color: colors.accent, fontSize: type.caption.fontSize, fontWeight: "900", letterSpacing: 0.6 },
});
