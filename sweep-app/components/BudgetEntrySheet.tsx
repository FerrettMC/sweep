// components/BudgetEntrySheet.tsx
//
// Logging a purchase, from the budget screen or from a tracked product.
//
// One sheet for both because they're the same action with different starting
// points: "I bought this" arrives with the amount, description and a guessed
// category already filled, so it's a confirm rather than a form. Everything
// stays editable — the guesses are guesses.

import { useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Button } from "@/components/ui";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { useTranslate } from "@/lib/i18n";
import {
  ApiError,
  type BudgetEntry,
  addBudgetEntry,
  updateBudgetEntry,
} from "@/lib/api";

export interface EntryDraft {
  /** Present when editing rather than creating. */
  id?: string;
  amount: number | null;
  category: string;
  description: string;
  productId?: string;
  /** Shown above the form when logging a purchase from a tracked product. */
  productTitle?: string;
}

interface Props {
  draft: EntryDraft | null;
  categories: string[];
  /** Free tier is held to the default categories, so hide the "new" option. */
  canUseCustomCategories: boolean;
  onClose: () => void;
  onSaved: (entry?: BudgetEntry) => void;
}

export default function BudgetEntrySheet({
  draft,
  categories,
  canUseCustomCategories,
  onClose,
  onSaved,
}: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const t = useTranslate();
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<EntryDraft | null>(null);

  // Reset the form each time a different draft opens the sheet.
  if (draft && loadedFor !== draft) {
    setLoadedFor(draft);
    setAmount(draft.amount !== null ? (draft.amount / 100).toFixed(2) : "");
    setCategory(draft.category);
    setDescription(draft.description);
    setCustomCategory("");
    setAddingCategory(false);
    setError(null);
  }

  if (!draft) return null;

  const isEdit = Boolean(draft.id);
  const chosenCategory = addingCategory ? customCategory.trim() : category;
  // Parsed here so the button can disable rather than letting someone submit
  // "twelve dollars" and get a server error back.
  const cents = Math.round(Number(amount.replace(/[^0-9.]/g, "")) * 100);
  const validAmount = Number.isFinite(cents) && cents > 0;

  async function onSave() {
    if (!draft || !validAmount || !chosenCategory) return;
    setBusy(true);
    setError(null);
    try {
      if (draft.id) {
        await updateBudgetEntry(draft.id, {
          amount: cents,
          category: chosenCategory,
          description: description.trim() || null,
        });
        onSaved();
      } else {
        const { entry } = await addBudgetEntry({
          amount: cents,
          category: chosenCategory,
          description: description.trim() || null,
          ...(draft.productId ? { productId: draft.productId } : {}),
        });
        onSaved(entry);
      }
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
      <View style={[styles.backdrop, { paddingTop: insets.top + spacing.lg }]}>
        <View style={styles.sheet}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.heading}>
              {isEdit
                ? t("budget.editPurchase")
                : draft.productTitle
                  ? t("budget.logThis")
                  : t("budget.logPurchase")}
            </Text>

            {draft.productTitle && (
              <View style={styles.productBanner}>
                <Ionicons name="pricetag" size={14} color={colors.accent} />
                <Text style={styles.productTitle} numberOfLines={2}>
                  {draft.productTitle}
                </Text>
              </View>
            )}

            <Text style={styles.label}>{t("budget.amount")}</Text>
            <View style={styles.amountRow}>
              <Text style={styles.currency}>$</Text>
              <TextInput
                style={styles.amountInput}
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder={t("budget.amountPlaceholder")}
                placeholderTextColor={colors.textTertiary}
                autoFocus={!draft.productTitle}
              />
            </View>

            <Text style={styles.label}>{t("budget.category")}</Text>
            <View style={styles.chips}>
              {categories.map((option) => (
                <Pressable
                  key={option}
                  onPress={() => {
                    setAddingCategory(false);
                    setCategory(option);
                  }}
                  style={[
                    styles.chip,
                    !addingCategory && category === option && styles.chipOn,
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      !addingCategory && category === option && styles.chipTextOn,
                    ]}
                  >
                    {option}
                  </Text>
                </Pressable>
              ))}
              {canUseCustomCategories && (
                <Pressable
                  onPress={() => setAddingCategory(true)}
                  style={[styles.chip, addingCategory && styles.chipOn]}
                >
                  <Ionicons
                    name="add"
                    size={13}
                    color={addingCategory ? colors.background : colors.textSecondary}
                  />
                  <Text style={[styles.chipText, addingCategory && styles.chipTextOn]}>
                    New
                  </Text>
                </Pressable>
              )}
            </View>

            {addingCategory && (
              <TextInput
                style={styles.input}
                value={customCategory}
                onChangeText={setCustomCategory}
                placeholder={t("budget.categoryPlaceholder")}
                placeholderTextColor={colors.textTertiary}
                maxLength={24}
                autoFocus
              />
            )}

            <Text style={styles.label}>{t("budget.noteOptional")}</Text>
            <TextInput
              style={styles.input}
              value={description}
              onChangeText={setDescription}
              placeholder={t("budget.whatWasIt")}
              placeholderTextColor={colors.textTertiary}
              maxLength={120}
            />

            {error && <Text style={styles.error}>{error}</Text>}
          </ScrollView>

          <View style={styles.actions}>
            <Button label={t("common.cancel")} onPress={onClose} variant="secondary" />
            <Button
              label={isEdit ? "Save" : "Log it"}
              onPress={onSave}
              busy={busy}
              disabled={!validAmount || !chosenCategory}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    // Top-anchored, like every other sheet in the app with a text input in
    // it. This one has three — amount, category, note — and bottom-anchoring
    // put all of them under the keyboard, so logging what you spent meant
    // typing into boxes you couldn't see.
    backdrop: {
      flex: 1,
      backgroundColor: colors.scrim,
      justifyContent: "flex-start",
      padding: spacing.lg,
    },
    sheet: {
      backgroundColor: colors.background,
      borderRadius: radius.lg,
      // Leaves room for the keyboard rather than assuming it isn't there.
      maxHeight: "70%",
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    content: { padding: spacing.md, gap: spacing.xs },
    heading: {
      color: colors.textPrimary,
      fontSize: type.title.fontSize,
      fontWeight: "800",
      marginBottom: spacing.xs,
    },
    productBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.accentMuted,
      borderRadius: radius.md,
      padding: spacing.sm,
      marginBottom: spacing.xs,
    },
    productTitle: { flex: 1, color: colors.textSecondary, fontSize: type.label.fontSize },
    label: {
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
      fontWeight: "900",
      letterSpacing: 0.6,
      textTransform: "uppercase",
      marginTop: spacing.sm,
    },
    amountRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
    },
    currency: { color: colors.textSecondary, fontSize: 24, fontWeight: "800" },
    amountInput: {
      flex: 1,
      color: colors.textPrimary,
      fontSize: 24,
      fontWeight: "800",
      paddingVertical: 10,
    },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: radius.pill,
      paddingHorizontal: 11,
      paddingVertical: 7,
    },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.textSecondary, fontSize: type.label.fontSize, fontWeight: "700" },
    chipTextOn: { color: colors.background },
    input: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: 11,
      color: colors.textPrimary,
      fontSize: type.body.fontSize,
    },
    error: { color: colors.danger, fontSize: type.label.fontSize, marginTop: spacing.sm },
    actions: {
      flexDirection: "row",
      gap: spacing.sm,
      padding: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.surfaceBorder,
    },
  });
