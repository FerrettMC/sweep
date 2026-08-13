// app/lists.tsx
//
// Gift lists and wishlists.
//
// Sharing is the point, not a feature bolted on: a shared list is a link that
// puts Sweep in front of someone who's never heard of it, and it arrives as
// something useful rather than an ad. So the share action is prominent rather
// than buried in a menu.

import { useCallback, useState } from "react";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import {
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Button, EmptyState, Loading, Screen } from "@/components/ui";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import {
  ApiError,
  type GiftList,
  addListItem,
  createList,
  deleteList,
  getLists,
  removeListItem,
  setListSharing,
} from "@/lib/api";
import { formatPrice, retailerColor, retailerLabel } from "@/lib/format";

/**
 * Where a shared list is viewable.
 *
 * The backend serves this page itself at /list/:token, so it defaults to the
 * API url rather than to a domain we don't own — a placeholder domain silently
 * resolves to a stranger's website, which is worse than an obviously dead link.
 *
 * Set EXPO_PUBLIC_SHARE_BASE_URL once there's a real domain in front of it.
 */
const API_BASE =
  process.env.EXPO_PUBLIC_API_URL ??
  Constants.expoConfig?.extra?.apiUrl ??
  "http://localhost:3001";

const SHARE_BASE =
  process.env.EXPO_PUBLIC_SHARE_BASE_URL ?? `${API_BASE}/list`;

export default function ListsScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();

  const [lists, setLists] = useState<GiftList[] | null>(null);
  const [limits, setLimits] = useState<{
    maxLists: number;
    maxItemsPerList: number;
    used: number;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [linkDraft, setLinkDraft] = useState<Record<string, string>>({});
  const [busyList, setBusyList] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await getLists();
      setLists(result.lists);
      setLimits(result.limits);
      // Keep the first list open — with a 1-list free tier, collapsed is just
      // an extra tap on the only thing there is to look at.
      setExpanded((current) => current ?? result.lists[0]?.id ?? null);
      setError(null);
    } catch (err) {
      const apiError = err as ApiError;
      if (apiError.status === 401) setLists([]);
      else setError(apiError.message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onCreate() {
    if (!newName.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      await createList(newName.trim());
      setNewName("");
      await load();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setCreating(false);
    }
  }

  async function onAddItem(list: GiftList) {
    const url = (linkDraft[list.id] ?? "").trim();
    if (!url) return;
    setBusyList(list.id);
    setError(null);
    try {
      await addListItem(list.id, { url });
      setLinkDraft((current) => ({ ...current, [list.id]: "" }));
      await load();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusyList(null);
    }
  }

  async function onShare(list: GiftList) {
    setBusyList(list.id);
    setError(null);
    try {
      const result = await setListSharing(list.id, !list.isPublic);
      await load();

      if (result.isPublic && result.shareToken) {
        const url = `${SHARE_BASE}/${result.shareToken}`;
        // Offer the OS share sheet — the whole point is that this leaves the
        // app and lands in someone else's messages.
        await Share.share({
          message: `${list.name} — my Sweep wishlist:\n${url}`,
          url,
        });
      } else {
        setNotice("Sharing turned off. The old link no longer works.");
      }
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusyList(null);
    }
  }

  async function onCopyLink(list: GiftList) {
    if (!list.shareToken) return;
    await Clipboard.setStringAsync(`${SHARE_BASE}/${list.shareToken}`);
    setNotice("Link copied.");
  }

  if (lists === null && !error) return <Loading />;

  const atListLimit = limits ? limits.used >= limits.maxLists : false;

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
        {error && <Text style={styles.error}>{error}</Text>}
        {notice && <Text style={styles.notice}>{notice}</Text>}

        {/* ---- create ---- */}
        {!atListLimit ? (
          <View style={styles.createRow}>
            <TextInput
              style={styles.input}
              placeholder="New list — e.g. Christmas 2026"
              placeholderTextColor={colors.textTertiary}
              value={newName}
              onChangeText={setNewName}
              onSubmitEditing={onCreate}
              returnKeyType="done"
              maxLength={60}
            />
            <Button
              label="Create"
              onPress={onCreate}
              busy={creating}
              disabled={!newName.trim()}
              compact
            />
          </View>
        ) : (
          <Pressable style={styles.limitBanner} onPress={() => router.push("/plans")}>
            <Ionicons name="lock-closed-outline" size={15} color={colors.warning} />
            <Text style={styles.limitText}>
              {limits?.maxLists === 1
                ? "Your plan includes 1 list."
                : `You've used all ${limits?.maxLists} lists on your plan.`}{" "}
              Pro gives 5, Ultimate 20.
            </Text>
            <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
          </Pressable>
        )}

        {(lists ?? []).length === 0 && (
          <EmptyState
            title="No lists yet"
            body="Build a gift list or wishlist, then share a link. Whoever you send it to sees live prices — and can mark off what they've bought, so nobody doubles up."
          />
        )}

        {(lists ?? []).map((list) => {
          const isOpen = expanded === list.id;
          const atItemLimit = limits
            ? list.itemCount >= limits.maxItemsPerList
            : false;

          return (
            <View key={list.id} style={styles.card}>
              <Pressable
                style={styles.cardHeader}
                onPress={() => setExpanded(isOpen ? null : list.id)}
              >
                <View style={styles.cardTitleWrap}>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {list.name}
                  </Text>
                  <Text style={styles.cardMeta}>
                    {list.itemCount}
                    {limits ? `/${limits.maxItemsPerList}` : ""} item
                    {list.itemCount === 1 ? "" : "s"}
                    {list.totalValue > 0 ? ` · ${formatPrice(list.totalValue)}` : ""}
                    {list.isPublic ? " · shared" : ""}
                  </Text>
                </View>
                <Ionicons
                  name={isOpen ? "chevron-up" : "chevron-down"}
                  size={18}
                  color={colors.textTertiary}
                />
              </Pressable>

              {isOpen && (
                <>
                  {/* ---- items ---- */}
                  {list.items.length === 0 ? (
                    <Text style={styles.emptyItems}>
                      Nothing on this list yet. Paste a product link below.
                    </Text>
                  ) : (
                    <View style={styles.items}>
                      {list.items.map((item) => (
                        <View key={item.id} style={styles.item}>
                          <View
                            style={[
                              styles.dot,
                              { backgroundColor: retailerColor(colors, item.product.retailer) },
                            ]}
                          />
                          <View style={styles.itemBody}>
                            <Text
                              style={[styles.itemTitle, item.claimed && styles.itemClaimed]}
                              numberOfLines={2}
                            >
                              {item.product.title}
                            </Text>
                            <Text style={styles.itemMeta}>
                              {formatPrice(item.product.price)} ·{" "}
                              {retailerLabel(item.product.retailer)}
                              {item.claimed ? " · claimed" : ""}
                            </Text>
                          </View>
                          {/* A visible button rather than making the title
                              tappable — nothing about the title says it opens
                              the store, so nobody would think to press it. */}
                          <Pressable
                            style={({ pressed }) => [
                              styles.openButton,
                              pressed && styles.openPressed,
                            ]}
                            onPress={() => Linking.openURL(item.product.url)}
                            hitSlop={6}
                          >
                            <Ionicons
                              name="open-outline"
                              size={13}
                              color={colors.accent}
                            />
                            <Text style={styles.openLabel}>Open</Text>
                          </Pressable>
                          <Pressable
                            onPress={async () => {
                              await removeListItem(list.id, item.id);
                              await load();
                            }}
                            hitSlop={10}
                          >
                            <Ionicons name="close" size={16} color={colors.textTertiary} />
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* ---- add ---- */}
                  {atItemLimit ? (
                    <Text style={styles.itemLimit}>
                      This list is full ({limits?.maxItemsPerList} items on your plan).
                    </Text>
                  ) : (
                    <View style={styles.addRow}>
                      <TextInput
                        style={styles.input}
                        placeholder="Paste a product link…"
                        placeholderTextColor={colors.textTertiary}
                        value={linkDraft[list.id] ?? ""}
                        onChangeText={(text) =>
                          setLinkDraft((current) => ({ ...current, [list.id]: text }))
                        }
                        onSubmitEditing={() => onAddItem(list)}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="url"
                      />
                      <Button
                        label="Add"
                        onPress={() => onAddItem(list)}
                        busy={busyList === list.id}
                        disabled={!(linkDraft[list.id] ?? "").trim()}
                        compact
                      />
                    </View>
                  )}

                  {/* ---- actions ---- */}
                  <View style={styles.actions}>
                    <View style={styles.actionMain}>
                      <Button
                        label={list.isPublic ? "Share again" : "Share this list"}
                        onPress={() => onShare(list)}
                        busy={busyList === list.id}
                        compact
                      />
                    </View>
                    {list.isPublic && (
                      <Pressable onPress={() => onCopyLink(list)} hitSlop={8}>
                        <Text style={styles.linkAction}>Copy link</Text>
                      </Pressable>
                    )}
                    <Pressable
                      onPress={async () => {
                        await deleteList(list.id);
                        await load();
                      }}
                      hitSlop={8}
                    >
                      <Text style={styles.deleteAction}>Delete</Text>
                    </Pressable>
                  </View>

                  {list.isPublic && (
                    <Text style={styles.shareNote}>
                      Anyone with the link can see this list and mark items as
                      bought. Turn sharing off to kill the link.
                      {SHARE_BASE.includes("localhost")
                        ? " Note: the link only works on your own network until the backend is deployed."
                        : ""}
                    </Text>
                  )}
                </>
              )}
            </View>
          );
        })}
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
    error: { color: colors.danger, fontSize: type.label.fontSize },
    notice: { color: colors.success, fontSize: type.label.fontSize },
    createRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
    addRow: {
      flexDirection: "row",
      gap: spacing.sm,
      alignItems: "center",
      marginTop: spacing.sm,
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
    limitBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      padding: spacing.md,
    },
    limitText: { flex: 1, color: colors.textSecondary, fontSize: type.label.fontSize },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      padding: spacing.md,
    },
    cardHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    cardTitleWrap: { flex: 1, gap: 2 },
    cardTitle: {
      color: colors.textPrimary,
      fontSize: type.heading.fontSize,
      fontWeight: "800",
    },
    cardMeta: { color: colors.textTertiary, fontSize: type.caption.fontSize },
    emptyItems: {
      color: colors.textTertiary,
      fontSize: type.label.fontSize,
      marginTop: spacing.md,
    },
    items: { marginTop: spacing.md, gap: spacing.sm },
    item: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    dot: { width: 7, height: 7, borderRadius: radius.pill },
    itemBody: { flex: 1, gap: 1 },
    openButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
    },
    openPressed: { opacity: 0.6, borderColor: colors.accent },
    openLabel: {
      color: colors.accent,
      fontSize: type.caption.fontSize,
      fontWeight: "700",
    },
    itemTitle: {
      color: colors.textPrimary,
      fontSize: type.label.fontSize,
      fontWeight: "600",
    },
    itemClaimed: { textDecorationLine: "line-through", color: colors.textTertiary },
    itemMeta: { color: colors.textTertiary, fontSize: type.caption.fontSize },
    itemLimit: {
      color: colors.warning,
      fontSize: type.caption.fontSize,
      marginTop: spacing.sm,
    },
    actions: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      marginTop: spacing.md,
    },
    actionMain: { flex: 1 },
    linkAction: {
      color: colors.accent,
      fontSize: type.label.fontSize,
      fontWeight: "700",
    },
    deleteAction: {
      color: colors.danger,
      fontSize: type.label.fontSize,
      fontWeight: "700",
    },
    shareNote: {
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
      lineHeight: 15,
      marginTop: spacing.sm,
    },
  });
