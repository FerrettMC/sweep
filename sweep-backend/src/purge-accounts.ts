// src/purge-accounts.ts — empty the production database of accounts.
//
//   npm run purge:accounts            dry run, deletes nothing
//   npm run purge:accounts -- --burn  actually does it
//
// Written for one job: clearing the closed-testing accounts before launch, so
// the first real user is genuinely the first user.
//
// WHAT IT KEEPS, deliberately. Product and PriceHistory are not personal data —
// they are a shared catalogue with no owner, and PriceHistory in particular is
// weeks of recorded prices that cannot be recreated by any means except waiting.
// judgeSale needs three points before it will say anything, so wiping it would
// have every product answer "not enough history yet" on launch day, which is
// precisely when the one feature nothing else has needs to work.
//
// It does NOT import testEnv. That guard exists to stop tests touching
// production and would refuse to run this, which is the opposite of what this
// is for. In exchange it prints the project it is pointed at, refuses to do
// anything without --burn, and shows the full count first.
//
// Deletion order matters: children before parents, or foreign keys reject it.
// Several tables cascade from User and would go anyway; they are listed
// explicitly regardless, because relying on a cascade you have not verified is
// how rows survive a purge that reported success.

import { createClient } from "@supabase/supabase-js";
import { prisma } from "./lib/prisma.js";

const BURN = process.argv.includes("--burn");

const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function projectRef(): string {
  return (process.env.SUPABASE_URL ?? "").match(/https:\/\/([a-z0-9]+)\./)?.[1] ?? "unknown";
}

async function main() {
  console.log(`\ntarget project: ${projectRef()}`);
  console.log(BURN ? "mode: BURN — this will delete\n" : "mode: dry run — nothing will be deleted\n");

  // ---- what is there ----
  const [
    users, wallets, pushTokens, notifications, tracked, searchHistory,
    cartItems, lists, listItems, budgetEntries, budgetLimits, savedSearches,
    transactions, adRewards, redemptions,
    products, priceHistory, checks, deals, promoCodes,
  ] = await Promise.all([
    prisma.user.count(), prisma.wallet.count(), prisma.pushToken.count(),
    prisma.notification.count(), prisma.trackedProduct.count(), prisma.searchHistory.count(),
    prisma.cartItem.count(), prisma.list.count(), prisma.listItem.count(),
    prisma.budgetEntry.count(), prisma.budgetLimit.count(), prisma.savedSearch.count(),
    prisma.transaction.count(), prisma.adReward.count(), prisma.promoCodeRedemption.count(),
    prisma.product.count(), prisma.priceHistory.count(), prisma.scrapeCheck.count(),
    prisma.deal.count(), prisma.promoCode.count(),
  ]);

  const { data: authList } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const authUsers = authList?.users ?? [];

  console.log("WILL DELETE");
  for (const [name, n] of [
    ["Supabase auth records", authUsers.length], ["User", users], ["Wallet", wallets],
    ["PushToken", pushTokens], ["Notification", notifications], ["TrackedProduct", tracked],
    ["SearchHistory", searchHistory], ["CartItem", cartItems], ["List", lists],
    ["ListItem", listItems], ["BudgetEntry", budgetEntries], ["BudgetLimit", budgetLimits],
    ["SavedSearch", savedSearches], ["Transaction", transactions], ["AdReward", adRewards],
    ["PromoCodeRedemption", redemptions],
  ] as const) {
    console.log(`  ${String(n).padStart(6)}  ${name}`);
  }

  console.log("\nWILL KEEP");
  for (const [name, n, why] of [
    ["Product", products, "shared catalogue, no owner"],
    ["PriceHistory", priceHistory, "weeks of prices, cannot be recreated"],
    ["ScrapeCheck", checks, "retailer health history"],
    ["Deal", deals, "the feed; finder is un-linked, not deleted"],
    ["PromoCode", promoCodes, "codes you created"],
  ] as const) {
    console.log(`  ${String(n).padStart(6)}  ${name.padEnd(14)} ${why}`);
  }

  if (!BURN) {
    console.log("\nDry run. Nothing was deleted. Re-run with --burn to do it.\n");
    return;
  }

  // ---- do it ----
  console.log("\ndeleting...");

  // Children first. Deal keeps its row and loses its finder, so the public feed
  // survives an account being removed — the same thing deleteAccount.ts does.
  await prisma.promoCodeRedemption.deleteMany({});
  await prisma.adReward.deleteMany({});
  await prisma.transaction.deleteMany({});
  await prisma.savedSearch.deleteMany({});
  await prisma.budgetLimit.deleteMany({});
  await prisma.budgetEntry.deleteMany({});
  await prisma.listItem.deleteMany({});
  await prisma.list.deleteMany({});
  await prisma.cartItem.deleteMany({});
  await prisma.searchHistory.deleteMany({});
  await prisma.trackedProduct.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.pushToken.deleteMany({});
  await prisma.deal.updateMany({ where: {}, data: { finderUserId: null } });
  await prisma.wallet.deleteMany({});
  const removed = await prisma.user.deleteMany({});
  console.log(`  ${removed.count} User rows`);

  // Then the auth records. Missing this is how 39 orphans accumulated before:
  // they are invisible from our own tables, and the only symptom is a real
  // email one day colliding with a stale record and being unable to sign up.
  let gone = 0;
  for (const user of authUsers) {
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error && !/not found/i.test(error.message)) {
      console.warn(`  auth ${user.email}: ${error.message}`);
    } else {
      gone++;
    }
  }
  console.log(`  ${gone} auth records`);

  const left = await prisma.user.count();
  const { data: check } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  console.log(`\nremaining: ${left} users, ${check?.users?.length ?? 0} auth records`);
  console.log("kept: catalogue and price history\n");
}

await main();
await prisma.$disconnect();
