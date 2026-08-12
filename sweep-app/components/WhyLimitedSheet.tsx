// components/WhyLimitedSheet.tsx
//
// Explains why searches are capped.
//
// Worth having because the limit looks arbitrary from the outside — most apps
// ration things to sell you the unrationed version. Here it's a real cost, and
// saying so plainly makes the cap feel like honesty rather than a squeeze.
// Being specific ("about a tenth of a cent") is what makes it believable.

import { Button } from "@/components/ui";
import { colors, radius, spacing, type } from "@/constants/theme";
import { Ionicons } from "@expo/vector-icons";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";

interface Props {
  visible: boolean;
  onClose: () => void;
  onSeePlans: () => void;
}

export default function WhyLimitedSheet({
  visible,
  onClose,
  onSeePlans,
}: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />

          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.heading}>Why are searches limited?</Text>

            <Text style={styles.body}>
              Because a single search isn't one request — it's many. Every time
              you search, Sweep goes out to all our online retailers and reads
              live prices from each.
            </Text>

            <View style={styles.card}>
              <View style={styles.row}>
                <Ionicons name="cash-outline" size={17} color={colors.accent} />
                <Text style={styles.rowText}>
                  <Text style={styles.bold}>Amazon costs actual money.</Text>{" "}
                  Their data requires a paid subscription, and every request you
                  make costs us money.
                </Text>
              </View>

              <View style={styles.row}>
                <Ionicons name="time-outline" size={17} color={colors.accent} />
                <Text style={styles.rowText}>
                  <Text style={styles.bold}>The rest cost patience.</Text> The
                  free stores rate-limit anyone who asks too often. Spacing
                  requests out is what keeps them working at all.
                </Text>
              </View>

              <View style={styles.row}>
                <Ionicons
                  name="repeat-outline"
                  size={17}
                  color={colors.accent}
                />
                <Text style={styles.rowText}>
                  <Text style={styles.bold}>Tracking is different.</Text> Once
                  you track something, checking it is cheap and shared — if ten
                  people watch the same TV, that's one check, not ten. Searching
                  can't be shared that way, because everyone searches something
                  different.
                </Text>
              </View>
            </View>

            <Text style={styles.body}>
              So tracking is generous and searching is rationed. It's not a
              trick to sell you an upgrade — it's the one part of Sweep with a
              bill attached.
            </Text>

            <Text style={styles.subheading}>Ways to get more</Text>
            <View style={styles.bullets}>
              <Text style={styles.bullet}>
                • Watch a short ad for one extra search, up to 3 a day
              </Text>
              <Text style={styles.bullet}>
                • Paste a product link instead — tracking costs you no searches
              </Text>
              <Text style={styles.bullet}>
                • Pro gives 10 a day, Ultimate gives 100
              </Text>
            </View>
          </ScrollView>

          <View style={styles.actions}>
            <View style={styles.action}>
              <Button label="Got it" onPress={onClose} variant="secondary" />
            </View>
            <View style={styles.action}>
              <Button label="See plans" onPress={onSeePlans} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: "88%",
    borderTopWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  grabber: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceBorder,
    marginTop: spacing.sm,
  },
  content: { padding: spacing.md, gap: spacing.md },
  heading: {
    color: colors.textPrimary,
    fontSize: type.title.fontSize,
    fontWeight: "900",
  },
  subheading: {
    color: colors.textPrimary,
    fontSize: type.heading.fontSize,
    fontWeight: "800",
  },
  body: {
    color: colors.textSecondary,
    fontSize: type.body.fontSize,
    lineHeight: 21,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    padding: spacing.md,
    gap: spacing.md,
  },
  row: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  rowText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: type.label.fontSize,
    lineHeight: 19,
  },
  bold: { color: colors.textPrimary, fontWeight: "800" },
  bullets: { gap: spacing.xs },
  bullet: {
    color: colors.textSecondary,
    fontSize: type.label.fontSize,
    lineHeight: 19,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceBorder,
  },
  action: { flex: 1 },
});
