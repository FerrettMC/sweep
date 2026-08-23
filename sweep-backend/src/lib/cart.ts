// lib/cart.ts
//
// The cart: what someone intends to buy, across every store at once.
//
// Sweep sells nothing, so this is not a checkout and never will be. It's a
// staging area — the things you've decided on, gathered from wherever you
// found them, with a total you cannot get anywhere else because no single shop
// can see the others.
//
// Deliberately distinct from a List. A list is a wishlist: long-lived,
// shareable, often for somebody else. A cart is this week's shopping, one per
// person, and it exists to be emptied.
//
// The part that earns its place is `since`: every line records what it cost
// when it went in, so the cart can say what has moved. A basket that quietly
// costs more than when you filled it is exactly what Sweep should notice.

import { prisma } from "./prisma.js";
import { RETAILER_LABELS, type Retailer } from "./scrapers/types.js";

/** Kept small on purpose — a cart is a decision list, not a catalogue. */
export const MAX_CART_ITEMS = 50;

/** Nobody is buying a hundred of anything through a price comparison app. */
const MAX_QUANTITY = 99;

export type AddResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "full" };

export async function addToCart(
  userId: string,
  productId: string,
  quantity = 1,
): Promise<AddResult> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, currentPrice: true },
  });
  if (!product) return { ok: false, reason: "not-found" };

  const existing = await prisma.cartItem.findUnique({
    where: { userId_productId: { userId, productId } },
  });

  if (!existing) {
    const count = await prisma.cartItem.count({ where: { userId } });
    if (count >= MAX_CART_ITEMS) return { ok: false, reason: "full" };
  }

  const add = Math.min(Math.max(Math.floor(quantity), 1), MAX_QUANTITY);

  await prisma.cartItem.upsert({
    where: { userId_productId: { userId, productId } },
    // priceAtAdd is written once, on the way in, and never touched again —
    // that is what makes "since you added it" mean anything.
    create: { userId, productId, quantity: add, priceAtAdd: product.currentPrice },
    update: { quantity: Math.min((existing?.quantity ?? 0) + add, MAX_QUANTITY) },
  });

  return { ok: true };
}

/** Zero removes it, as every basket does. Returns whether anything changed. */
export async function setCartQuantity(
  userId: string,
  productId: string,
  quantity: number,
): Promise<boolean> {
  if (quantity <= 0) {
    const { count } = await prisma.cartItem.deleteMany({ where: { userId, productId } });
    return count > 0;
  }
  const { count } = await prisma.cartItem.updateMany({
    where: { userId, productId },
    data: { quantity: Math.min(Math.floor(quantity), MAX_QUANTITY) },
  });
  return count > 0;
}

export async function removeFromCart(userId: string, productId: string): Promise<void> {
  await prisma.cartItem.deleteMany({ where: { userId, productId } });
}

export async function clearCart(userId: string): Promise<void> {
  await prisma.cartItem.deleteMany({ where: { userId } });
}

export async function buildCart(userId: string) {
  const rows = await prisma.cartItem.findMany({
    where: { userId },
    orderBy: { addedAt: "desc" },
    include: { product: true },
  });

  let total = 0;
  let sinceTotal = 0;
  let priced = 0;

  const items = rows.map((row) => {
    const price = row.product.currentPrice;
    if (price !== null) {
      total += price * row.quantity;
      priced += 1;
      if (row.priceAtAdd !== null) sinceTotal += (price - row.priceAtAdd) * row.quantity;
    }

    return {
      productId: row.productId,
      quantity: row.quantity,
      title: row.product.title,
      imageUrl: row.product.imageUrl,
      url: row.product.url,
      retailer: row.product.retailer,
      retailerLabel:
        RETAILER_LABELS[row.product.retailer as Retailer] ?? row.product.retailer,
      price,
      priceAtAdd: row.priceAtAdd,
      /** Negative means cheaper than when it went in. */
      since: price !== null && row.priceAtAdd !== null ? price - row.priceAtAdd : null,
      addedAt: row.addedAt.toISOString(),
    };
  });

  // Grouped by store, because that's how the buying actually happens — you go
  // to one shop and get everything you need from it.
  const byStore = new Map<string, { label: string; count: number; total: number }>();
  for (const item of items) {
    const entry = byStore.get(item.retailer) ?? {
      label: item.retailerLabel,
      count: 0,
      total: 0,
    };
    entry.count += item.quantity;
    if (item.price !== null) entry.total += item.price * item.quantity;
    byStore.set(item.retailer, entry);
  }

  return {
    items,
    /** Cents, across every store. Null-priced items are simply left out. */
    total,
    /** How the total has moved since things were added. Negative is good. */
    since: sinceTotal,
    /** Items we could price. The rest still show, without a number. */
    pricedCount: priced,
    stores: [...byStore.entries()].map(([retailer, e]) => ({ retailer, ...e })),
  };
}
