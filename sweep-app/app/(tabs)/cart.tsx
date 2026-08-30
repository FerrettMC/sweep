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
import { EmptyState, Loading, Screen } from "@/components/ui";
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

  /**
   * Remove outright. Reached from the trash icon the minus button becomes at a
   * quantity of one — setting the quantity to zero would do the same thing, but
   * this is the endpoint that means it, and saying so here keeps the intent
   * visible at the call site.
   */
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
                  // An empty square reads as a hole in the row now that the row
                  // has an edge of its own. A faint glyph reads as "no picture",
                  // which is the true thing and a quieter one.
                  <View style={[styles.thumb, styles.thumbEmpty]}>
                    <Ionicons name="image-outline" size={22} color={colors.textTertiary} />
                  </View>
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
                  {/*
                    Real buttons rather than bare icons with hitSlop. An 18px
                    glyph plus 8 of slop is a ~34dp target, under both
                    platforms' minimums, and invisible slop also means nothing
                    on screen shows where to press. These are 40dp with a
                    surface behind them, so the target is the thing you can see.

                    The old slop overlapped, too: 8 either side across a 4dp gap
                    left 12dp claimed by both buttons, where a near-miss on one
                    silently hit the other. Sized boxes can't do that.
                  */}
                  <Pressable
                    style={({ pressed }) => [
                      styles.qtyBtn,
                      pressed && styles.qtyBtnPressed,
                      busy === item.productId && styles.qtyBtnBusy,
                    ]}
                    disabled={busy === item.productId}
                    onPress={() =>
                      item.quantity === 1
                        ? drop(item.productId)
                        : change(item.productId, item.quantity - 1)
                    }
                    accessibilityRole="button"
                    accessibilityLabel={
                      item.quantity === 1 ? t("cart.removeItem") : t("cart.decrease")
                    }
                  >
                    {/* At one, this doesn't decrement — it removes the item. A
                        minus sign there promises a 0 that never appears, so it
                        says what it will actually do. */}
                    <Ionicons
                      name={item.quantity === 1 ? "trash-outline" : "remove"}
                      size={19}
                      color={item.quantity === 1 ? colors.danger : colors.textPrimary}
                    />
                  </Pressable>

                  <Text style={styles.qtyNum}>{item.quantity}</Text>

                  <Pressable
                    style={({ pressed }) => [
                      styles.qtyBtn,
                      pressed && styles.qtyBtnPressed,
                      busy === item.productId && styles.qtyBtnBusy,
                    ]}
                    disabled={busy === item.productId}
                    onPress={() => change(item.productId, item.quantity + 1)}
                    accessibilityRole="button"
                    accessibilityLabel={t("cart.increase")}
                  >
                    <Ionicons name="add" size={19} color={colors.textPrimary} />
                  </Pressable>
                </View>
              </View>
            ))}

            {/*
              Grouped by store, one row per item.

              This was one button per store labelled "Open Amazon (2)", which
              opened the FIRST Amazon item and silently dropped the other. The
              count promised something the tap didn't do, and with two items
              from one shop you had no way to reach the second at all.

              There is no honest one-tap version: Sweep can't put anything in a
              retailer's actual basket, so buying two things from Amazon means
              opening two pages however it's presented. Grouping keeps the "one
              shop at a time" idea that the store buttons were reaching for,
              while every tap now does exactly what its row says.
            */}
            <Text style={styles.sectionTitle}>{t("cart.goBuy")}</Text>
            {cart.stores.map((store) => {
              const items = cart.items.filter((i) => i.retailer === store.retailer);
              return (
                <View key={store.retailer} style={styles.buyGroup}>
                  <View style={styles.buyHead}>
                    <View
                      style={[
                        styles.dot,
                        { backgroundColor: retailerColor(colors, store.retailer) },
                      ]}
                    />
                    <Text style={styles.buyStore}>
                      {items.length === 1
                        ? t("cart.storeGroupOne", { store: store.label })
                        : t("cart.storeGroup", {
                            store: store.label,
                            count: items.length,
                          })}
                    </Text>
                  </View>

                  {items.map((item, index) => (
                    <Pressable
                      key={item.productId}
                      style={({ pressed }) => [
                        styles.buyRow,
                        index > 0 && styles.buyRowDivided,
                        pressed && styles.buyRowPressed,
                      ]}
                      onPress={() => void Linking.openURL(item.url).catch(() => {})}
                      accessibilityRole="link"
                      accessibilityLabel={`${t("cart.openItem")} — ${item.title}`}
                    >
                      <Text style={styles.buyTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                      {/* Only when it matters. Otherwise you arrive at the shop
                          having forgotten you wanted two, and the cart total
                          you were shown quietly stops being the price you pay.
                          The glyph needs no translating. */}
                      {item.quantity > 1 && (
                        <Text style={styles.buyQty}>&times;{item.quantity}</Text>
                      )}
                      <Text style={styles.buyPrice}>{formatPrice(item.price)}</Text>
                      <Ionicons
                        name="open-outline"
                        size={16}
                        color={colors.textTertiary}
                      />
                    </Pressable>
                  ))}
                </View>
              );
            })}

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
      padding: spacing.md,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    thumb: {
      // Grown with the row. The quantity stepper is 40dp tall twice over, so a
      // 52px image sat marooned in the middle of a much taller row.
      width: 64,
      height: 64,
      borderRadius: radius.md,
      backgroundColor: colors.background,
      resizeMode: "contain",
    },
    thumbEmpty: { alignItems: "center", justifyContent: "center" },

    // The hierarchy here used to be flat — title, store and price were all
    // within two points of each other and all at or near the smallest size in
    // the scale, so the row read as a block of grey with no entry point. Three
    // levels now: the title is what you read, the price is what you check, the
    // store is context.
    body: { flex: 1, gap: 5 },
    title: {
      color: colors.textPrimary,
      fontSize: type.body.fontSize,
      fontWeight: "600",
      lineHeight: 20,
    },
    storeRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    store: {
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
      fontWeight: "700",
      letterSpacing: 0.2,
    },
    priceRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.xs },
    // The number the whole screen exists for. It was 13px, two points above the
    // store name it sits under.
    price: {
      color: colors.textPrimary,
      fontSize: type.heading.fontSize,
      fontWeight: "800",
      letterSpacing: -0.3,
    },
    downSmall: { color: colors.success, fontSize: type.label.fontSize, fontWeight: "800" },
    upSmall: { color: colors.danger, fontSize: type.label.fontSize, fontWeight: "800" },

    qty: { alignItems: "center", gap: 3 },
    qtyBtn: {
      width: 40,
      height: 40,
      borderRadius: radius.md,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surfaceRaised,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    qtyBtnPressed: { backgroundColor: colors.accentMuted, borderColor: colors.accent },
    qtyBtnBusy: { opacity: 0.45 },
    qtyNum: {
      color: colors.textPrimary,
      fontSize: type.label.fontSize,
      fontWeight: "800",
      // Stops the row twitching sideways between 9 and 10.
      minWidth: 24,
      textAlign: "center",
      paddingVertical: 1,
    },

    buyGroup: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      overflow: "hidden",
    },
    buyHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: 6,
    },
    buyStore: {
      color: colors.textSecondary,
      fontSize: type.caption.fontSize,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    buyRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      // 48dp of row, so every one of these is a comfortable target.
      paddingVertical: 13,
    },
    buyRowDivided: { borderTopWidth: 1, borderTopColor: colors.surfaceBorder },
    buyRowPressed: { backgroundColor: colors.surfaceRaised },
    buyTitle: { flex: 1, color: colors.textPrimary, fontSize: type.label.fontSize },
    buyQty: {
      color: colors.accent,
      fontSize: type.caption.fontSize,
      fontWeight: "800",
    },
    buyPrice: {
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
      fontWeight: "800",
    },

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
