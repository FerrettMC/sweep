// src/test-notify.ts
//
// Force a price-drop notification right now, without waiting for a scheduled
// check or for a retailer to actually change its price.
//
//   npm run test:notify              # drop the first tracked product by $50
//   npm run test:notify -- 25        # ...by $25 instead
//
// How it works: it raises the STORED price, then runs a real check. The live
// price is unchanged, so the check reads as a genuine drop and goes down the
// exact same path a real one would — including the noise floor, the per-user
// cooldown, Ultimate thresholds, and dead-token pruning.
//
// Note this deliberately does NOT use the app's "Check price now" button:
// that calls checkProduct() directly and never notifies, because you're already
// looking at the screen when you press it.

import "dotenv/config";
import { checkProduct } from "./lib/priceChecker.js";
import { prisma } from "./lib/prisma.js";
import { notifyPriceDrop } from "./lib/push.js";

const dropDollars = Number(process.argv[2] ?? 50);

async function main() {
  const tracked = await prisma.trackedProduct.findFirst({
    include: { product: true, user: { include: { pushTokens: true } } },
    orderBy: { addedAt: "desc" },
  });

  if (!tracked) {
    console.log("Nothing is being tracked — add a product in the app first.");
    return;
  }

  const { product, user } = tracked;
  console.log(`User:    ${user.email}`);
  console.log(`Product: ${product.title.slice(0, 56)}`);
  console.log(`Devices: ${user.pushTokens.length}`);

  if (user.pushTokens.length === 0) {
    console.log(
      "\n⚠️  No push tokens registered for this user. Open the app, go to " +
        "Profile, and tap Enable price alerts first.",
    );
    return;
  }

  // This script clears the cooldown on every run so you can test repeatedly —
  // which also means running it twice sends twice. Catch the accidental
  // double-run rather than leaving you wondering why you got two buzzes.
  if (
    tracked.lastNotifiedAt &&
    Date.now() - tracked.lastNotifiedAt.getTime() < 60_000
  ) {
    const seconds = Math.round(
      (Date.now() - tracked.lastNotifiedAt.getTime()) / 1000,
    );
    console.log(
      `\n⚠️  Already notified ${seconds}s ago. Running again would send a second ` +
        `notification for the same product.\n    Re-run with --force if that's what you want.`,
    );
    if (!process.argv.includes("--force")) return;
  }

  const inflated =
    (product.currentPrice ?? 10000) + Math.round(dropDollars * 100);

  await prisma.$transaction([
    // Pretend the price used to be higher...
    prisma.product.update({
      where: { id: product.id },
      data: { currentPrice: inflated },
    }),
    // ...and clear the cooldown so the alert isn't suppressed as a repeat.
    prisma.trackedProduct.update({
      where: { id: tracked.id },
      data: { lastNotifiedAt: null },
    }),
  ]);

  console.log(
    `\nStored price bumped to $${(inflated / 100).toFixed(2)} — re-checking...`,
  );

  const outcome = await checkProduct(product.id);

  if (outcome.status !== "success") {
    console.log(
      `❌ Check failed (${outcome.status}). Can't test the drop path.`,
    );
    console.log(`   ${outcome.detail?.slice(0, 200)}`);
    return;
  }

  const { previousPrice, newPrice } = outcome;
  console.log(
    `Check OK: $${((previousPrice ?? 0) / 100).toFixed(2)} → $${((newPrice ?? 0) / 100).toFixed(2)}`,
  );

  if (
    newPrice === null ||
    previousPrice === null ||
    newPrice >= previousPrice
  ) {
    console.log("No drop detected — nothing to notify about.");
    return;
  }

  const sent = await notifyPriceDrop({
    productId: product.id,
    previousPrice,
    newPrice,
  });

  console.log(
    sent > 0
      ? `\n✅ Sent to ${sent} device(s). Check your phone.`
      : "\n⚠️  Nothing sent. Either the drop was under the noise floor " +
          "(3% / $1), the cooldown is still active, or the token was pruned as dead.",
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
