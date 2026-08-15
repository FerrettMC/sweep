// components/StoreTroubleSheet.tsx
//
// "Retailer not working?" — what it means when a store goes quiet.
//
// This exists because the failure looks like our bug from the outside. A store
// that's blocking us returns nothing, and an app that shows nothing looks
// broken. Someone who doesn't know that stores actively fight scrapers will
// reasonably conclude Sweep is buggy and stop trusting the prices it does
// show — which are fine.
//
// So the honest version is worth saying out loud: this happens, it's usually
// brief, it doesn't affect the other stores, and here's where to check. Being
// upfront about a limitation costs less than being quietly unreliable.
//
// It also names which stores are down, because that's the first thing anyone
// opening this wants to know. A general explanation with the specifics left
// out reads as a brush-off.

import { Ionicons } from "@expo/vector-icons";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { useTranslate } from "@/lib/i18n";

export interface DownStore {
  retailer: string;
  label: string;
  /** False when we've switched it off, rather than it merely failing checks. */
  enabled?: boolean;
}

export default function StoreTroubleSheet({
  visible,
  onClose,
  onSeeStatus,
  downStores,
}: {
  visible: boolean;
  onClose: () => void;
  /** Sends them to Profile, where the live per-store status lives. */
  onSeeStatus: () => void;
  downStores: DownStore[];
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();

  if (!visible) return null;

  const points: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [
    { icon: "shield-outline", text: t("storeTrouble.blocking") },
    { icon: "time-outline", text: t("storeTrouble.temporary") },
    { icon: "checkmark-circle-outline", text: t("storeTrouble.others") },
  ];

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.dismissArea} onPress={onClose} />
        <View style={styles.sheet}>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.head}>
              <Ionicons name="storefront-outline" size={19} color={colors.accent} />
              <Text style={styles.heading}>{t("storeTrouble.heading")}</Text>
            </View>

            {/* The specifics first. Someone opening this has already noticed
                something missing and wants it named, not explained. */}
            {downStores.length > 0 ? (
              <View style={styles.downBlock}>
                <Text style={styles.downHeading}>{t("storeTrouble.downNow")}</Text>
                {downStores.map((store) => (
                  <View key={store.retailer} style={styles.downRow}>
                    <View style={styles.downDot} />
                    <View style={styles.downText}>
                      <Text style={styles.downName}>{store.label}</Text>
                      <Text style={styles.downReason}>
                        {store.enabled === false
                          ? t("storeTrouble.reasonDisabled")
                          : t("storeTrouble.reasonFailing")}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.allGood}>
                <Ionicons
                  name="checkmark-circle"
                  size={16}
                  color={colors.success}
                />
                <Text style={styles.allGoodText}>{t("storeTrouble.allWorking")}</Text>
              </View>
            )}

            <Text style={styles.body}>{t("storeTrouble.intro")}</Text>

            {points.map((point) => (
              <View key={point.text} style={styles.point}>
                <Ionicons name={point.icon} size={16} color={colors.textSecondary} />
                <Text style={styles.pointText}>{point.text}</Text>
              </View>
            ))}

            <Text style={styles.footnote}>{t("storeTrouble.footnote")}</Text>
          </ScrollView>

          <View style={styles.actions}>
            <View style={styles.action}>
              <Button
                label={t("storeTrouble.seeStatus")}
                onPress={onSeeStatus}
                variant="secondary"
              />
            </View>
            <View style={styles.action}>
              <Button label={t("whyLimited.gotIt")} onPress={onClose} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: colors.scrim, justifyContent: "flex-end" },
    dismissArea: { flex: 1 },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      borderTopWidth: 1,
      borderColor: colors.surfaceBorder,
      maxHeight: "80%",
    },
    content: { padding: spacing.md, gap: spacing.sm },
    head: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    heading: {
      color: colors.textPrimary,
      fontSize: type.heading.fontSize,
      fontWeight: "800",
      flex: 1,
    },
    downBlock: {
      gap: 2,
      padding: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised,
      borderWidth: 1,
      borderColor: colors.warning,
      marginBottom: spacing.xs,
    },
    downHeading: {
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
      fontWeight: "800",
      letterSpacing: 0.4,
      textTransform: "uppercase",
      marginBottom: 4,
    },
    downRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.sm,
      paddingVertical: 5,
    },
    downDot: {
      width: 7,
      height: 7,
      borderRadius: radius.pill,
      backgroundColor: colors.warning,
      marginTop: 5,
    },
    downText: { flex: 1 },
    downName: {
      color: colors.textPrimary,
      fontSize: type.label.fontSize,
      fontWeight: "700",
    },
    downReason: {
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
      lineHeight: 16,
    },
    allGood: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      padding: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      marginBottom: spacing.xs,
    },
    allGoodText: {
      flex: 1,
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
      fontWeight: "600",
    },
    body: {
      color: colors.textSecondary,
      fontSize: type.body.fontSize,
      lineHeight: 21,
      marginBottom: spacing.xs,
    },
    point: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.sm,
      paddingVertical: 6,
    },
    pointText: {
      flex: 1,
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
      lineHeight: 19,
    },
    footnote: {
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
      lineHeight: 17,
      marginTop: spacing.xs,
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
