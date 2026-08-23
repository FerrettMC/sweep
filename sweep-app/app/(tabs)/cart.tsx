// app/(tabs)/cart.tsx
//
// The cart — what you've decided to buy, wherever you found it.
//
// Not a checkout. Sweep sells nothing and takes no payment; every line links
// out to the shop that has it. What this can do that a shop's own basket
// can't is add up across all of them, and say what has moved since you
// decided.
//
// That last part is the reason it isn't just another list. A basket quietly
// costing $40 more than when you filled it is exactly the thing Sweep exists
// to notice, and the only place anyone would notice it is here.

import { useCallback, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  Image,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button, EmptyState, Loading, Screen } from "@/components/ui";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { useTranslate } from "@/lib/i18n";
import {
  type Cart,
  clearCart,
  getCart,
  removeFromCart,
  setCartQuantity,
} from "@/lib/api";
import { formatPrice, retailerColor } from "@/lib/format";

export default function CartScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();
  const router = useRouter();

  const [cart, setCart] = useState<Cart | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const load = useCallback(async () => {
    try {
      setCart(await getCart());
    } catch {
      // Signed out, or offline. An empty cart is the honest thing to show
      // rather than an error over something with nothing at stake.
      setCart({ items: [], total: 0, since: 0, pricedCount: 0, stores: [] });
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function change(productId: string, quantity: number) {
    setBusy(productId);
    try {
      setCart(await setCartQuantity(productId, quantity));
    } catch {
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function drop(productId: string) {
    setBusy(productId);
    try {
      setCart(await removeFromCart(productId));
    } catch {
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (cart === null) return <Loading />;

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
        {cart.items.length === 0 ? (
          <EmptyState title={t("cart.emptyTitle")} body={t("cart.emptyBody")} />
        ) : (
          <>
            {/* The total first, because it's the thing you can't get anywhere
                else and the reason to open this screen at all. */}
            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>{t("cart.total")}</Text>
              <Text style={styles.total}>{formatPrice(cart.total)}</Text>
              <Text style={styles.totalMeta}>
                {t("cart.acrossStores", { count: cart.stores.length })}
              </Text>

              {/* Only shown when it has actually moved. "No change" is not
                  news, and a row that's usually zero stops being read. */}
              {cart.since !== 0 && (
                <Text style={cart.since < 0 ? styles.down : styles.up}>
                  {cart.since < 0
                    ? t("cart.down", { amount: formatPrice(Math.abs(cart.since)) })
                    : t("cart.up", { amount: formatPrice(cart.since) })}
                </Text>
              )}

              {cart.pricedCount < cart.items.length && (
                <Text style={styles.totalMeta}>
                  {t("cart.someUnpriced", {
                    count: cart.items.length - cart.pricedCount,
                  })}
                </Text>
              )}
            </View>

            {cart.items.map((item) => (
              <View key={item.productId} style={styles.row}>
                {item.imageUrl ? (
                  <Image source={{ uri: item.imageUrl }} style={styles.thumb} />
                ) : (
                  <View style={styles.thumb} />
                )}

                <Pressable
                  style={styles.body}
                  onPress={() => router.push(`/product/${item.productId}`)}
                >
                  <Text style={styles.title} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <View style={styles.storeRow}>
                    <View
                      style={[
                        styles.dot,
                        { backgroundColor: retailerColor(colors, item.retailer) },
                      ]}
                    />
                    <Text style={styles.store}>{item.retailerLabel}</Text>
                  </View>
                  <View style={styles.priceRow}>
                    <Text style={styles.price}>{formatPrice(item.price)}</Text>
                    {item.since !== null && item.since !== 0 && (
                      <Text style={item.since < 0 ? styles.downSmall : styles.upSmall}>
                        {item.since < 0 ? "▼ " : "▲ "}
                        {formatPrice(Math.abs(item.since))}
                      </Text>
                    )}
                  </View>
                </Pressable>

                <View style={styles.qty}>
                  <Pressable
                    hitSlop={8}
                    disabled={busy === item.productId}
                    onPress={() => change(item.productId, item.quantity - 1)}
                  >
                    <Ionicons name="remove" size={18} color={colors.textSecondary} />
                  </Pressable>
                  <Text style={styles.qtyNum}>{item.quantity}</Text>
                  <Pressable
                    hitSlop={8}
                    disabled={busy === item.productId}
                    onPress={() => change(item.productId, item.quantity + 1)}
                  >
                    <Ionicons name="add" size={18} color={colors.textSecondary} />
                  </Pressable>
                </View>
              </View>
            ))}

            {/* One button per store, because that's how buying happens — you
                go to a shop and get everything you need from it, rather than
                bouncing between tabs item by item. */}
            <Text style={styles.sectionTitle}>{t("cart.goBuy")}</Text>
            {cart.stores.map((store) => (
              <Button
                key={store.retailer}
                label={t("cart.openStore", {
                  store: store.label,
                  count: store.count,
                })}
                variant="secondary"
                onPress={() => {
                  const first = cart.items.find((i) => i.retailer === store.retailer);
                  if (first) void Linking.openURL(first.url).catch(() => {});
                }}
              />
            ))}

            <Pressable
              style={styles.clear}
              onPress={() => setConfirmingClear(true)}
              hitSlop={8}
            >
              <Text style={styles.clearText}>{t("cart.clear")}</Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      <ConfirmDialog
        content={
          confirmingClear
            ? {
                icon: "trash-outline",
                destructive: true,
                title: t("cart.clearTitle"),
                body: t("cart.clearBody"),
                confirmLabel: t("cart.clearConfirm"),
                cancelLabel: t("common.cancel"),
              }
            : null
        }
        onCancel={() => setConfirmingClear(false)}
        onConfirm={async () => {
          setConfirmingClear(false);
          try {
            setCart(await clearCart());
          } catch {
            await load();
          }
        }}
      />
    </Screen>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    content: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },

    totalCard: {
      backgroundColor: colors.accentMuted,
      borderRadius: radius.lg,
      padding: spacing.md,
      gap: 2,
    },
    totalLabel: {
      color: colors.accent,
      fontSize: type.caption.fontSize,
      fontWeight: "800",
      letterSpacing: 0.5,
      textTransform: "uppercase",
    },
    total: { color: colors.textPrimary, fontSize: type.display.fontSize, fontWeight: "900" },
    totalMeta: { color: colors.textSecondary, fontSize: type.caption.fontSize },
    down: { color: colors.success, fontSize: type.label.fontSize, fontWeight: "700" },
    up: { color: colors.danger, fontSize: type.label.fontSize, fontWeight: "700" },

    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.sm,
    },
    thumb: {
      width: 52,
      height: 52,
      borderRadius: radius.md,
      backgroundColor: colors.background,
      resizeMode: "contain",
    },
    body: { flex: 1, gap: 3 },
    title: { color: colors.textPrimary, fontSize: type.caption.fontSize, lineHeight: 17 },
    storeRow: { flexDirection: "row", alignItems: "center", gap: 5 },
    dot: { width: 7, height: 7, borderRadius: 4 },
    store: { color: colors.textTertiary, fontSize: type.caption.fontSize },
    priceRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.xs },
    price: { color: colors.textPrimary, fontSize: type.label.fontSize, fontWeight: "800" },
    downSmall: { color: colors.success, fontSize: type.caption.fontSize, fontWeight: "700" },
    upSmall: { color: colors.danger, fontSize: type.caption.fontSize, fontWeight: "700" },

    qty: { alignItems: "center", gap: 4, paddingHorizontal: spacing.xs },
    qtyNum: { color: colors.textPrimary, fontSize: type.label.fontSize, fontWeight: "800" },

    sectionTitle: {
      color: colors.textSecondary,
      fontSize: type.caption.fontSize,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginTop: spacing.sm,
    },

    clear: { alignSelf: "center", paddingVertical: spacing.sm, marginTop: spacing.xs },
    clearText: { color: colors.textTertiary, fontSize: type.label.fontSize },
  });
