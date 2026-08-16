// src/test-billing.ts — the RevenueCat webhook.
//   npm run test:billing     (needs the dev server running)
//
// This endpoint decides who has paid access. The failure modes are asymmetric
// and both bad: grant too freely and the subscriptions are pointless; revoke
// too eagerly and someone loses what they paid for, usually on the day they
// were already annoyed enough to cancel.
//
// The cases worth pinning down are the ones that are easy to reason about
// wrongly — a cancellation is not an expiry, and webhooks retry out of order.
import { assertNotProduction, targetSummary } from "./testEnv.js";

assertNotProduction();
console.log(`target: ${targetSummary()}`);

import { createClient } from "@supabase/supabase-js";
import { prisma } from "./lib/prisma.js";
import { purgeTestUser } from "./testCleanup.js";
import { effectiveTier } from "./lib/tiers.js";

const API = process.env.TEST_API_URL ?? "http://localhost:3001";
const SECRET = process.env.REVENUECAT_WEBHOOK_SECRET ?? "test-webhook-secret";

let pass = 0,
  fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok && detail !== undefined) console.log("     ", JSON.stringify(detail));
};

const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
const email = `billing-${Date.now()}@sweepshopping.com`;
const { data: made, error } = await admin.auth.admin.createUser({
  email,
  password: "Test-Passw0rd!x",
  email_confirm: true,
});
if (error) throw error;
const userId = made.user!.id;
await prisma.user.create({ data: { id: userId, email } });
await prisma.wallet.create({ data: { userId } });

const DAY = 24 * 60 * 60 * 1000;

async function send(
  type: string,
  opts: { entitlements?: string[]; expiresInMs?: number | null; auth?: string } = {},
) {
  const res = await fetch(`${API}/webhooks/revenuecat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: opts.auth ?? SECRET,
    },
    body: JSON.stringify({
      event: {
        type,
        app_user_id: userId,
        entitlement_ids: opts.entitlements ?? null,
        expiration_at_ms:
          opts.expiresInMs === null ? null : Date.now() + (opts.expiresInMs ?? 30 * DAY),
      },
    }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function tier() {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  return { stored: wallet!.tier, effective: effectiveTier(wallet!), expires: wallet!.tierExpiresAt };
}

try {
  console.log("\n— authentication —");
  const bad = await send("INITIAL_PURCHASE", { entitlements: ["pro"], auth: "wrong" });
  check("a wrong secret is rejected", bad.status === 401, bad);
  check("and grants nothing", (await tier()).effective === "free");

  console.log("\n— buying —");
  const bought = await send("INITIAL_PURCHASE", { entitlements: ["pro"] });
  check("purchase accepted", bought.status === 200, bought);
  check("tier is pro", (await tier()).effective === "pro", await tier());

  console.log("\n— upgrading —");
  await send("PRODUCT_CHANGE", { entitlements: ["ultimate"] });
  check("tier is ultimate", (await tier()).effective === "ultimate", await tier());

  console.log("\n— cancelling is not expiring —");
  await send("CANCELLATION", { entitlements: ["ultimate"] });
  const afterCancel = await tier();
  // They turned off auto-renew. They keep what they paid for until it lapses.
  check("access survives cancellation", afterCancel.effective === "ultimate", afterCancel);

  console.log("\n— out-of-order events —");
  // A retried RENEWAL describing an expiry we've already passed must not walk
  // the subscription backwards.
  const before = await tier();
  await send("RENEWAL", { entitlements: ["ultimate"], expiresInMs: 1 * DAY });
  const after = await tier();
  check(
    "a stale renewal doesn't shorten the subscription",
    after.expires?.getTime() === before.expires?.getTime(),
    { before: before.expires, after: after.expires },
  );

  console.log("\n— renewing —");
  await send("RENEWAL", { entitlements: ["ultimate"], expiresInMs: 60 * DAY });
  const renewed = await tier();
  check("expiry moved out", (renewed.expires?.getTime() ?? 0) > (before.expires?.getTime() ?? 0));

  console.log("\n— expiring —");
  await send("EXPIRATION", { entitlements: ["ultimate"] });
  const expired = await tier();
  check("tier is free", expired.effective === "free", expired);
  // A leftover expiry on a free wallet is how a lapsed subscriber gets
  // silently re-upgraded when effectiveTier next reads it.
  check("no stale expiry left behind", expired.expires === null, expired);

  console.log("\n— an expiry in the past means no access —");
  await prisma.wallet.update({
    where: { userId },
    data: { tier: "pro", tierExpiresAt: new Date(Date.now() - DAY) },
  });
  check("lapsed subscription reads as free", (await tier()).effective === "free");

  console.log("\n— unknown users —");
  const stranger = await fetch(`${API}/webhooks/revenuecat`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: SECRET },
    body: JSON.stringify({
      event: { type: "INITIAL_PURCHASE", app_user_id: "nobody", entitlement_ids: ["pro"] },
    }),
  });
  // 200 on purpose: retrying an event for an account that doesn't exist will
  // never succeed, and RevenueCat would keep trying for days.
  check("acknowledged rather than retried forever", stranger.status === 200, stranger.status);
} finally {
  await purgeTestUser(userId);
  await prisma.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
