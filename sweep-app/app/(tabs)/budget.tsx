// app/(tabs)/budget.tsx
//
// Budget tracker — manual expense logging, categorised, with a monthly view.
// Scheduled for the next pass. The BudgetEntry model it writes to already
// exists in the Prisma schema; what's missing is its endpoints and this screen.

import { StyleSheet, Text, View } from "react-native";
import { Screen } from "@/components/ui";
import { colors, radius, spacing, type } from "@/constants/theme";

export default function BudgetScreen() {
  return (
    <Screen>
      <View style={styles.container}>
        <Text style={styles.glyph}>💰</Text>
        <Text style={styles.title}>Budget Tracker</Text>
        <Text style={styles.body}>
          Log what you spend, sort it into categories, and see where the month
          actually went — right next to the deals you're waiting on.
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
  pillText: {
    color: colors.accent,
    fontSize: type.caption.fontSize,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
});
