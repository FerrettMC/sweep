// lib/deleteAccount.ts
//
// Erasing an account and everything attached to it.
//
// Google Play requires this for any app with accounts, but the requirement is
// also just correct: someone who wants out should be able to leave without
// emailing a human.
//
// Order matters and is not arbitrary:
//
//   1. Application rows first, children before parents, because the schema has
//      restrictive foreign keys in places and a half-deleted user is worse
//      than an undeleted one.
//   2. The Supabase auth record LAST. If it went first and the row deletion
//      then failed, the account would be unreachable but its data would live
//      on forever with no way for the user to ask again.
//
// Deliberately does NOT delete Product rows. Those are a shared cache of public
// catalogue data — not personal information — and removing them would degrade
// the app for everyone else who happens to watch the same item.

import { createClient } from "@supabase/supabase-js";
import { prisma } from "./prisma.js";

/**
 * The service-role client. Only ever used here: it can delete any user, so it
 * must never be reachable from a path that takes a user-supplied id.
 */
function adminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) return null;
  return createClient(process.env.SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface DeletionSummary {
  deleted: Record<string, number>;
  authRecordRemoved: boolean;
}

export async function deleteAccount(userId: string): Promise<DeletionSummary> {
  const deleted: Record<string, number> = {};
  const record = (name: string, result: { count: number }) => {
    if (result.count > 0) deleted[name] = result.count;
  };

  // ---- 1. everything the user created ----
  record("budgetEntries", await prisma.budgetEntry.deleteMany({ where: { userId } }));
  record("budgetLimits", await prisma.budgetLimit.deleteMany({ where: { userId } }));
  record("listItems", await prisma.listItem.deleteMany({ where: { list: { userId } } }));
  record("lists", await prisma.list.deleteMany({ where: { userId } }));
  record("savedSearches", await prisma.savedSearch.deleteMany({ where: { userId } }));
  record("trackedProducts", await prisma.trackedProduct.deleteMany({ where: { userId } }));
  record("pushTokens", await prisma.pushToken.deleteMany({ where: { userId } }));

  // Deals stay on the public feed but stop being attributable — the price drop
  // genuinely happened and other people's XP is computed against that history.
  const orphanedDeals = await prisma.deal.updateMany({
    where: { finderUserId: userId },
    data: { finderUserId: null },
  });
  if (orphanedDeals.count > 0) deleted.dealsAnonymised = orphanedDeals.count;

  record("adRewards", await prisma.adReward.deleteMany({ where: { userId } }));
  record("promoRedemptions", await prisma.promoCodeRedemption.deleteMany({ where: { userId } }));
  record("transactions", await prisma.transaction.deleteMany({ where: { userId } }));
  record("wallet", await prisma.wallet.deleteMany({ where: { userId } }));
  record("user", await prisma.user.deleteMany({ where: { id: userId } }));

  // ---- 2. the auth record, last ----
  const admin = adminClient();
  let authRecordRemoved = false;
  if (admin) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    // A missing user is a success: it means a previous attempt got this far.
    authRecordRemoved = !error || /not found/i.test(error.message);
    if (error && !authRecordRemoved) {
      console.error(`[delete] auth record for ${userId}:`, error.message);
    }
  }

  return { deleted, authRecordRemoved };
}
