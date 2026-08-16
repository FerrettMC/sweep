// routes/billing.ts
//
// RevenueCat tells us when someone's subscription changes; this turns that
// into a tier on their wallet.
//
// Everything downstream already works off `Wallet.tier` and TIER_LIMITS, so
// this file is deliberately the only place that knows subscriptions exist. It
// sets a tier and an expiry, and the rest of the app carries on as it did when
// tiers were set by hand.
//
// Two things it gets right that are easy to get wrong:
//
// A cancellation is NOT a revocation. Cancelling turns off auto-renew; the
// person keeps what they paid for until the period ends. Revoking on
// CANCELLATION would take away access somebody is still owed, on the day they
// were most annoyed with us.
//
// Events arrive out of order and more than once. Webhooks retry, and a
// RENEWAL can land after the EXPIRATION it supersedes. So this never applies a
// delta — it reads the state the event describes and writes that, and an event
// describing an expiry older than what we already have is ignored.

import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";

/** Entitlement ids as configured in RevenueCat, best tier first. */
const ENTITLEMENTS = ["ultimate", "pro"] as const;

/**
 * Event types that mean "this person currently has access".
 *
 * CANCELLATION is deliberately absent — see the note above. BILLING_ISSUE is
 * absent for the opposite reason: access continues through the grace period,
 * and RevenueCat sends EXPIRATION if it ever actually lapses.
 */
const GRANTING = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "UNCANCELLATION",
  "NON_RENEWING_PURCHASE",
  "SUBSCRIPTION_EXTENDED",
]);

/** Event types that end access immediately. */
const REVOKING = new Set(["EXPIRATION", "SUBSCRIPTION_PAUSED"]);

interface RevenueCatEvent {
  type?: string;
  app_user_id?: string;
  original_app_user_id?: string;
  entitlement_ids?: string[] | null;
  expiration_at_ms?: number | null;
  event_timestamp_ms?: number | null;
}

function tierFor(entitlements: string[] | null | undefined): string | null {
  if (!entitlements?.length) return null;
  return ENTITLEMENTS.find((id) => entitlements.includes(id)) ?? null;
}

export async function billingRoutes(app: FastifyInstance) {
  app.post("/webhooks/revenuecat", async (request, reply) => {
    const expected = process.env.REVENUECAT_WEBHOOK_SECRET;
    if (!expected) {
      // Refuse rather than accept unauthenticated calls: this endpoint grants
      // paid access, and an unset secret would let anyone hand themselves
      // Ultimate.
      request.log.error("REVENUECAT_WEBHOOK_SECRET is not set");
      return reply.status(503).send({ error: "Billing webhook not configured" });
    }

    const auth = request.headers.authorization;
    if (auth !== expected) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const body = request.body as { event?: RevenueCatEvent } | undefined;
    const event = body?.event;
    if (!event?.type) return reply.status(400).send({ error: "Missing event" });

    // We set app_user_id to the Supabase user id when the app logs in, so this
    // maps straight to a wallet. original_app_user_id is the fallback for
    // events raised before an anonymous id was aliased.
    const userId = event.app_user_id ?? event.original_app_user_id;
    if (!userId) return reply.status(400).send({ error: "Missing app_user_id" });

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      // Not an error worth retrying: a purchase from an account we've never
      // seen means the ids don't line up, and returning 200 stops RevenueCat
      // retrying something that will never succeed.
      request.log.warn({ userId, type: event.type }, "billing event for unknown user");
      return { ok: true, ignored: "unknown user" };
    }

    const granting = GRANTING.has(event.type);
    const revoking = REVOKING.has(event.type);
    if (!granting && !revoking) {
      // CANCELLATION, BILLING_ISSUE, TRANSFER and the rest are real events we
      // deliberately don't act on. Acknowledged so they aren't retried.
      return { ok: true, ignored: event.type };
    }

    const expiresAt =
      granting && event.expiration_at_ms ? new Date(event.expiration_at_ms) : null;

    // Out-of-order protection. A retried RENEWAL that describes an expiry we
    // have already moved past would otherwise walk the subscription backwards.
    if (
      granting &&
      expiresAt &&
      wallet.tierExpiresAt &&
      expiresAt < wallet.tierExpiresAt
    ) {
      return { ok: true, ignored: "stale event" };
    }

    const tier = granting ? (tierFor(event.entitlement_ids) ?? "free") : "free";

    // A paid tier with no expiry never expires — effectiveTier only downgrades
    // when tierExpiresAt is in the past. RevenueCat always sends one for
    // subscriptions, so an absent value means something unexpected. Granting
    // is still the right call (they paid), but it must not pass silently.
    if (tier !== "free" && !expiresAt) {
      request.log.warn(
        { userId, type: event.type, tier },
        "granting a paid tier with no expiry — will not lapse on its own",
      );
    }

    await prisma.wallet.update({
      where: { userId },
      data: {
        tier,
        // Free has no expiry to speak of, and leaving a stale one behind is how
        // a lapsed subscriber gets silently re-upgraded by effectiveTier.
        tierExpiresAt: tier === "free" ? null : expiresAt,
      },
    });

    request.log.info(
      { userId, type: event.type, tier, expiresAt },
      "billing event applied",
    );
    return { ok: true, tier };
  });
}
