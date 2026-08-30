// components/TrackedItemSheet.tsx
//
// Editing one tracked item: when it's checked, what price to shout about, and
// removing it.
//
// One honest wrinkle surfaced rather than hidden: check TIMES are per account,
// not per product. Editing them here changes them for everything you track,
// and the sheet says so — quietly applying an account-wide change from a
// single product's row would be a nasty surprise.
//
// Custom thresholds ARE per product, so those are edited freely here.

import { Button } from "@/components/ui";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useSheetTopInset } from "@/lib/sheetTopInset";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { useTranslate } from "@/lib/i18n";
import {
  ApiError,
  type Schedule,
  type TrackedProduct,
  setCustomThreshold,
} from "@/lib/api";
import { formatPrice, retailerLabel } from "@/lib/format";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

interface Props {
  item: TrackedProduct | null;
  schedule: Schedule | null;
  canSetThreshold: boolean;
  onClose: () => void;
  /** Called after any successful change, so the list can refresh. */
  onChanged: () => void;
  onRemove: (item: TrackedProduct) => void;
}

export default function TrackedItemSheet({
  item,
  schedule,
  canSetThreshold,
  onClose,
  onChanged,
  onRemove,
}: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const topInset = useSheetTopInset();
  const t = useTranslate();
  const [threshold, setThreshold] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [seededFor, setSeededFor] = useState<string | null>(null);

  // Re-seed whenever a different item is opened.
  if (item && seededFor !== item.id) {
    setSeededFor(item.id);
    setThreshold(
      item.customThreshold !== null
        ? (item.customThreshold / 100).toFixed(2)
        : "",
    );
    setError(null);
    setNotice(null);
  }

  if (!item) return null;

  async function onSave() {
    if (!item) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      if (canSetThreshold) {
        const raw = threshold.trim();
        const cents = raw === "" ? null : Math.round(Number(raw) * 100);
        if (raw !== "" && (!Number.isFinite(cents) || (cents ?? 0) <= 0)) {
          setError(
            t("trackedItem.thresholdHelp"),
          );
          return;
        }
        if (cents !== item.customThreshold) {
          await setCustomThreshold(item.id, cents);
        }
      }

      setNotice("Saved.");
      onChanged();
      onClose();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
            {/* paddingTop includes the safe-area inset: on Android a Modal renders
          UNDER the status bar, so a fixed padding puts the sheet's top edge on
          the clock. Matches UsernameSheet, ForgotPasswordSheet and
          ConfirmDialog, which already did this. */}
      <View style={[styles.backdrop, { paddingTop: topInset + spacing.lg }]}>
        <View style={styles.sheet}>

          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.title} numberOfLines={2}>
              {item.product.title}
            </Text>
            <Text style={styles.meta}>
              {retailerLabel(item.product.retailer)} ·{" "}
              {formatPrice(item.product.price)}
            </Text>

            {/* Checks aren't scheduled by the user any more — it was more
                configuration than it was worth. Tell them what happens. */}
            <View style={styles.scheduleNote}>
              <Text style={styles.scheduleText}>
                {schedule?.fixedCheckTimes
                  ? `Checked up to ${schedule.maxCheckTimes}× a day`
                  : `Checked up to every ${
                      (schedule?.checkIntervalMinutes ?? 120) >= 60
                        ? `${(schedule?.checkIntervalMinutes ?? 120) / 60} hours`
                        : `${schedule?.checkIntervalMinutes} minutes`
                    }`}
                {nextCheckLabel(schedule?.nextCheckAt)}
              </Text>
            </View>

            {/* ---- custom threshold ---- */}
            <View style={styles.section}>
              <View style={styles.sectionTitleRow}>
                <Text style={styles.sectionTitle}>{t("trackedItem.alertBelow")}</Text>
                {!canSetThreshold && (
                  <View style={styles.proPill}>
                    <Text style={styles.proPillText}>PRO</Text>
                  </View>
                )}
              </View>

              {canSetThreshold ? (
                <>
                  <Text style={styles.sectionHint}>
                    Only get an alert when it drops under this price. Leave
                    empty to hear about any real drop.
                  </Text>
                  <View style={styles.priceInputRow}>
                    <Text style={styles.currency}>$</Text>
                    <TextInput
                      style={styles.priceInput}
                      placeholder="49.99"
                      placeholderTextColor={colors.textTertiary}
                      value={threshold}
                      onChangeText={setThreshold}
                      keyboardType="decimal-pad"
                    />
                    {threshold.length > 0 && (
                      <Pressable onPress={() => setThreshold("")} hitSlop={8}>
                        <Ionicons
                          name="close-circle"
                          size={18}
                          color={colors.textTertiary}
                        />
                      </Pressable>
                    )}
                  </View>
                </>
              ) : (
                <Text style={styles.sectionHint}>
                  Pro and Ultimate can set an exact price to be alerted below,
                  instead of hearing about every drop.
                </Text>
              )}
            </View>

            {error && <Text style={styles.error}>{error}</Text>}
            {notice && <Text style={styles.notice}>{notice}</Text>}

            <Pressable
              onPress={() => {
                onRemove(item);
                onClose();
              }}
              style={styles.removeRow}
            >
              <Ionicons name="trash-outline" size={16} color={colors.danger} />
              <Text style={styles.removeText}>{t("trackedItem.stopTrackingThis")}</Text>
            </Pressable>
          </ScrollView>

          <View style={styles.actions}>
            <View style={styles.action}>
              <Button
                label={t("common.cancel")}
                onPress={onClose}
                variant="secondary"
                disabled={busy}
              />
            </View>
            <View style={styles.action}>
              <Button label={t("common.save")} onPress={onSave} busy={busy} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** " · next at 4:35 PM" when we know, nothing when we don't. */
function nextCheckLabel(nextCheckAt: string | null | undefined) {
  if (!nextCheckAt) return ".";
  const at = new Date(nextCheckAt);
  if (Number.isNaN(at.getTime())) return ".";
  return `, next at ${at.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })}.`;
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    // Top-anchored: this sheet takes a custom price threshold, and a
    // bottom-anchored sheet opens the keypad straight over the field.
    backdrop: {
      flex: 1,
      backgroundColor: colors.scrim,
      justifyContent: "flex-start",
      padding: spacing.lg,
    },
    sheet: {
      backgroundColor: colors.background,
      borderRadius: radius.lg,
      maxHeight: "70%",
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    content: { padding: spacing.md, gap: spacing.md },
    title: {
      color: colors.textPrimary,
      fontSize: type.heading.fontSize,
      fontWeight: "800",
      lineHeight: 23,
    },
    meta: {
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
      marginTop: -8,
    },
    section: { gap: spacing.xs },
    sectionTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    sectionTitle: {
      color: colors.textPrimary,
      fontSize: type.body.fontSize,
      fontWeight: "800",
    },
    sectionHint: {
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
      lineHeight: 18,
    },
    warn: { color: colors.warning, fontWeight: "700" },
    scheduleNote: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      padding: spacing.md,
    },
    scheduleText: {
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
      lineHeight: 19,
    },
    hourGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.xs,
      marginTop: spacing.xs,
    },
    minuteGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.xs,
      marginTop: spacing.xs,
    },
    slotSummary: {
      color: colors.accent,
      fontSize: type.caption.fontSize,
      fontWeight: "700",
      marginTop: spacing.xs,
    },
    hourChip: {
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: radius.sm,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      minWidth: 58,
      alignItems: "center",
    },
    hourChipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    hourText: {
      color: colors.textSecondary,
      fontSize: type.caption.fontSize,
      fontWeight: "700",
    },
    hourTextOn: { color: colors.background },
    pressed: { opacity: 0.7 },
    proPill: {
      backgroundColor: colors.accentMuted,
      borderRadius: radius.sm,
      paddingHorizontal: 7,
      paddingVertical: 2,
    },
    proPillText: {
      color: colors.accent,
      fontSize: type.caption.fontSize,
      fontWeight: "900",
    },
    priceInputRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      marginTop: spacing.xs,
    },
    currency: {
      color: colors.textSecondary,
      fontSize: type.body.fontSize,
      fontWeight: "800",
    },
    priceInput: {
      flex: 1,
      paddingVertical: 11,
      color: colors.textPrimary,
      fontSize: type.body.fontSize,
    },
    error: { color: colors.danger, fontSize: type.label.fontSize },
    notice: { color: colors.success, fontSize: type.label.fontSize },
    removeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingVertical: spacing.sm,
    },
    removeText: {
      color: colors.danger,
      fontSize: type.label.fontSize,
      fontWeight: "700",
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
