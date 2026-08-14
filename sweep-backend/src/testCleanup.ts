// src/testCleanup.ts
//
// Removing a test account completely.
//
// The harnesses used to delete their Prisma rows and stop there, which left the
// Supabase auth record behind. Those are invisible from the app's own tables,
// so they accumulated silently — 39 of them before anyone looked, and the only
// symptom would have been a real email one day colliding with a stale record
// and being unable to sign up.
//
// This is deliberately NOT lib/deleteAccount.ts. That function is the product
// feature and is what the security suite asserts against; if the tests cleaned
// up by calling it, a bug in it would hide its own evidence.

import { createClient } from "@supabase/supabase-js";
import { prisma } from "./lib/prisma.js";

const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Delete a test user's rows and its Supabase auth record. */
export async function purgeTestUser(userId: string) {
  await prisma.budgetEntry.deleteMany({ where: { userId } });
  await prisma.budgetLimit.deleteMany({ where: { userId } });
  await prisma.listItem.deleteMany({ where: { list: { userId } } });
  await prisma.list.deleteMany({ where: { userId } });
  await prisma.savedSearch.deleteMany({ where: { userId } });
  await prisma.trackedProduct.deleteMany({ where: { userId } });
  await prisma.pushToken.deleteMany({ where: { userId } });
  await prisma.deal.updateMany({ where: { finderUserId: userId }, data: { finderUserId: null } });
  await prisma.adReward.deleteMany({ where: { userId } });
  await prisma.promoCodeRedemption.deleteMany({ where: { userId } });
  await prisma.transaction.deleteMany({ where: { userId } });
  await prisma.wallet.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });

  // The step that was missing. A failure here is worth seeing rather than
  // swallowing — silence is how the last batch built up.
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error && !/not found/i.test(error.message)) {
    console.warn(`[cleanup] auth record ${userId}: ${error.message}`);
  }
}

/**
 * Sweep up anything earlier runs left behind. Scoped to the throwaway domain,
 * which a real signup can never use.
 */
export async function purgeStrayTestAccounts() {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const strays = (data?.users ?? []).filter((u) => u.email?.endsWith("@example.com"));
  for (const user of strays) await purgeTestUser(user.id);
  return strays.length;
}

/**
 * Create a confirmed test account and return a usable session token.
 *
 * Uses the admin API rather than signUp because email confirmation is now on:
 * signUp would try to send a confirmation email to an @example.com address,
 * fail to deliver, and abort the whole suite with "Error sending confirmation
 * email". Creating the user pre-confirmed skips the mailbox entirely, which is
 * both correct for a test and considerably faster.
 */
export async function createTestUser(tag: string, apiUrl: string) {
  const email = `sweep-${tag}-${Date.now()}@example.com`;
  const password = "sweep-test-password-123";

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError || !created.user) {
    throw new Error(`could not create test user: ${createError?.message}`);
  }

  // Sign in normally to get a token the API will accept — the admin client
  // holds no session of its own.
  const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: session, error: signInError } = await anon.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !session.session) {
    throw new Error(`could not sign in test user: ${signInError?.message}`);
  }

  const token = session.session.access_token;
  await fetch(`${apiUrl}/auth/sync-user`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ email }),
  });

  return { id: created.user.id, email, password, token };
}
