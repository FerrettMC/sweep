// components/AddToListSheet.tsx
//
// "Add this to a list", from anywhere a product appears.
//
// Deliberately does the whole job in one sheet: if you have no lists yet, you
// can make one here rather than being bounced to another screen and losing the
// product you were looking at.

import { useCallback, useState } from "react";
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
import { useTheme, useThemedStyles } from "@/lib/theme";
import {
  ApiError,
  type GiftList,
  addListItem,
  createList,
  getLists,
} from "@/lib/api";

export interface ListTarget {
  retailer: string;
  retailerId: string;
  title: string;
  /**
   * The real product url, when the caller has one.
   *
   * Search results aren't written to the database, so the server can't look up
   * a stored url for a product nobody has tracked yet — and some retailers
   * (Best Buy) can't be scraped from a url rebuilt out of just an id, because
   * their scraper needs the name in the slug. Passing the url we already have
   * avoids that entirely.
   */
  url?: string;
}

interface Props {
  /** The product to add. Null closes the sheet. */
  product: ListTarget | null;
  onClose: () => void;
  onAdded?: (listName: string) => void;
}

export default function AddToListSheet({ product, onClose, onAdded }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [lists, setLists] = useState<GiftList[] | null>(null);
  const [limits, setLimits] = useState<{
    maxLists: number;
    maxItemsPerList: number;
    used: number;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await getLists();
      setLists(result.lists);
      setLimits(result.limits);
      setError(null);
    } catch (err) {
      setError((err as ApiError).message);
      setLists([]);
    }
  }, []);

  // Load once per product opened, not on every render.
  const key = product ? `${product.retailer}:${product.retailerId}` : null;
  if (key && loadedFor !== key) {
    setLoadedFor(key);
    setLists(null);
    setError(null);
    setNewName("");
    void load();
  }

  if (!product) return null;

  async function addTo(list: GiftList) {
    if (!product) return;
    setBusy(list.id);
    setError(null);
    try {
      await addListItem(
        list.id,
        product.url
          ? { url: product.url }
          : { retailer: product.retailer, retailerId: product.retailerId },
      );
      onAdded?.(list.name);
      onClose();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(null);
    }
  }

  async function onCreateAndAdd() {
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const { list } = await createList(newName.trim());
      await addTo(list);
    } catch (err) {
      setError((err as ApiError).message);
      setCreating(false);
      return;
    }
    setCreating(false);
  }

  const atListLimit = limits ? limits.used >= limits.maxLists : false;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />

          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.heading}>Add to a list</Text>
            <Text style={styles.product} numberOfLines={2}>
              {product.title}
            </Text>

            {lists === null ? (
              <Text style={styles.loading}>Loading your lists…</Text>
            ) : (
              <>
                {lists.map((list) => {
                  // Adding is idempotent server-side, but saying so up front is
                  // friendlier than letting someone tap and see nothing happen.
                  const already = list.items.some(
                    (item) =>
                      item.product.retailer === product.retailer &&
                      item.product.retailerId === product.retailerId,
                  );
                  const full = limits
                    ? list.itemCount >= limits.maxItemsPerList
                    : false;

                  return (
                    <Pressable
                      key={list.id}
                      style={({ pressed }) => [
                        styles.row,
                        pressed && !already && !full && styles.pressed,
                        (already || full) && styles.rowDisabled,
                      ]}
                      onPress={() => addTo(list)}
                      disabled={already || full || busy !== null}
                    >
                      <Ionicons
                        name={already ? "checkmark-circle" : "list-outline"}
                        size={19}
                        color={already ? colors.success : colors.accent}
                      />
                      <View style={styles.rowText}>
                        <Text style={styles.rowName} numberOfLines={1}>
                          {list.name}
                        </Text>
                        <Text style={styles.rowMeta}>
                          {already
                            ? "Already on this list"
                            : full
                              ? `Full (${limits?.maxItemsPerList} items)`
                              : `${list.itemCount} item${list.itemCount === 1 ? "" : "s"}`}
                        </Text>
                      </View>
                      {busy === list.id && (
                        <Text style={styles.rowMeta}>Adding…</Text>
                      )}
                    </Pressable>
                  );
                })}

                {lists.length === 0 && (
                  <Text style={styles.emptyNote}>
                    You don't have any lists yet. Name one below and this product
                    goes straight onto it.
                  </Text>
                )}

                {!atListLimit ? (
                  <View style={styles.createRow}>
                    <TextInput
                      style={styles.input}
                      placeholder="New list name…"
                      placeholderTextColor={colors.textTertiary}
                      value={newName}
                      onChangeText={setNewName}
                      onSubmitEditing={onCreateAndAdd}
                      returnKeyType="done"
                      maxLength={60}
                    />
                    <Button
                      label="Create"
                      onPress={onCreateAndAdd}
                      busy={creating}
                      disabled={!newName.trim()}
                      compact
                    />
                  </View>
                ) : (
                  <Text style={styles.limitNote}>
                    You've used all {limits?.maxLists}{" "}
                    {limits?.maxLists === 1 ? "list" : "lists"} on your plan.
                  </Text>
                )}
              </>
            )}

            {error && <Text style={styles.error}>{error}</Text>}
          </ScrollView>

          <View style={styles.actions}>
            <Button label="Close" onPress={onClose} variant="secondary" />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: colors.scrim, justifyContent: "flex-end" },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      maxHeight: "80%",
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
    content: { padding: spacing.md, gap: spacing.sm },
    heading: {
      color: colors.textPrimary,
      fontSize: type.title.fontSize,
      fontWeight: "800",
    },
    product: {
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
      marginBottom: spacing.sm,
    },
    loading: { color: colors.textTertiary, fontSize: type.label.fontSize },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      padding: spacing.md,
    },
    rowDisabled: { opacity: 0.55 },
    pressed: { opacity: 0.75 },
    rowText: { flex: 1, gap: 1 },
    rowName: {
      color: colors.textPrimary,
      fontSize: type.body.fontSize,
      fontWeight: "700",
    },
    rowMeta: { color: colors.textTertiary, fontSize: type.caption.fontSize },
    emptyNote: {
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
      lineHeight: 18,
    },
    createRow: {
      flexDirection: "row",
      gap: spacing.sm,
      alignItems: "center",
      marginTop: spacing.xs,
    },
    input: {
      flex: 1,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: 11,
      color: colors.textPrimary,
      fontSize: type.body.fontSize,
    },
    limitNote: { color: colors.warning, fontSize: type.caption.fontSize },
    error: { color: colors.danger, fontSize: type.label.fontSize },
    actions: {
      padding: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.surfaceBorder,
    },
  });
