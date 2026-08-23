// test-cart.ts — the cart.
//   npm run test:cart
//
// Runs on the DEV database. The interesting behaviour isn't adding things —
// it's the arithmetic across stores, and "since you added it", which is the
// only thing here a shop's own basket can't do.
import "./testEnv.js";
import { prisma } from "./lib/prisma.js";
import {
  addToCart,
  buildCart,
  clearCart,
  removeFromCart,
  setCartQuantity,
} from "./lib/cart.js";

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok && detail !== undefined) console.log("     ", JSON.stringify(detail).slice(0, 300));
};

const TAG = `carttest-${Date.now()}`;
const userId = `${TAG}-user`;
const made: string[] = [];

async function product(title: string, retailer: string, price: number | null) {
  const row = await prisma.product.create({
    data: {
      retailer, retailerId: `${TAG}-${made.length}`,
      url: `https://example.com/${TAG}/${made.length}`,
      title, currentPrice: price, currency: "USD", lastCheckedAt: new Date(),
    },
  });
  made.push(row.id);
  return row.id;
}

const get = () => buildCart(userId);

try {
  await prisma.user.create({ data: { id: userId, email: `${userId}@example.com` } });

  const a = await product("Sony WH-1000XM5", "amazon", 23999);
  const b = await product("Kindle Paperwhite", "ebay", 13499);
  const c = await product("Mug", "etsy", null);

  console.log("\n— adding —");
  await addToCart(userId, a);
  let cart = await get();
  check("one item in", cart.items.length === 1, cart.items.length);
  check("total is its price", cart.total === 23999, cart.total);
  check("records what it cost on the way in", cart.items[0].priceAtAdd === 23999);

  console.log("\n— the same thing twice is one line —");
  await addToCart(userId, a);
  cart = await get();
  check("still one line", cart.items.length === 1, cart.items.length);
  check("quantity went up", cart.items[0].quantity === 2, cart.items[0].quantity);
  check("total counts the quantity", cart.total === 47998, cart.total);

  console.log("\n— across stores —");
  await addToCart(userId, b);
  cart = await get();
  check("total spans both stores", cart.total === 47998 + 13499, cart.total);
  check("grouped by store", cart.stores.length === 2, cart.stores);
  const amazon = cart.stores.find((s: { retailer: string }) => s.retailer === "amazon");
  check("store totals respect quantity", amazon.total === 47998, amazon);

  console.log("\n— an unpriced item still goes in —");
  await addToCart(userId, c);
  cart = await get();
  check("it appears", cart.items.length === 3, cart.items.length);
  check("without breaking the total", cart.total === 47998 + 13499, cart.total);
  check("and is reported as unpriced", cart.pricedCount === 2, cart.pricedCount);

  console.log("\n— since you added it —");
  // The whole reason this isn't just a list: a basket that quietly costs more
  // than when you filled it is exactly what Sweep should notice.
  await prisma.product.update({ where: { id: b }, data: { currentPrice: 11499 } });
  cart = await get();
  const kindle = cart.items.find((i: { productId: string }) => i.productId === b);
  check("a drop shows as negative", kindle.since === -2000, kindle.since);
  check("the cart total reflects it", cart.since === -2000, cart.since);

  await prisma.product.update({ where: { id: a }, data: { currentPrice: 25999 } });
  cart = await get();
  // Two of the Sony at +$20 each, one Kindle at -$20.
  check("a rise counts per unit", cart.since === 4000 - 2000, cart.since);

  console.log("\n— quantity and removal —");
  await setCartQuantity(userId, a, 1);
  cart = await get();
  check("quantity can be set", cart.items.find((i: { productId: string }) => i.productId === a).quantity === 1);

  await setCartQuantity(userId, a, 0);
  cart = await get();
  check("zero removes it", !cart.items.some((i: { productId: string }) => i.productId === a));

  await removeFromCart(userId, b);
  cart = await get();
  check("delete removes one", cart.items.length === 1, cart.items.length);

  await clearCart(userId);
  cart = await get();
  check("clearing empties it", cart.items.length === 0 && cart.total === 0, cart);

  console.log("\n— refusals —");
  const missing = await addToCart(userId, "does-not-exist");
  check("an unknown product is refused", !missing.ok && missing.reason === "not-found", missing);
  check("removing something absent is harmless", (await setCartQuantity(userId, a, 0)) === false);
} finally {
  await prisma.cartItem.deleteMany({ where: { userId } });
  await prisma.product.deleteMany({ where: { id: { in: made } } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
