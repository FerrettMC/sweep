// lib/push.ts
//
// Price-drop push notifications, via Expo's push service.
//
// This is the app's core value prop, and it's on every tier — free users get
// alerts too. Gating it behind a paywall would undercut the whole point.
//
// Two things this is careful about:
//   1. Not spamming. A product that oscillates by a cent shouldn't buzz a
//      phone, and no user should get more than one alert per product per day.
//   2. Pruning dead tokens. Uninstalled apps return DeviceNotRegistered
//      forever unless you delete the token, and Expo will eventually rate-limit
//      a sender that keeps pushing to dead devices.

import { Expo, type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk";
import { prisma } from "./prisma.js";
import {
  type NotificationInput,
  recordNotification,
  recordNotifications,
} from "./notificationFeed.js";
import { TIER_LIMITS, type Tier, effectiveTier } from "./tiers.js";

// No access token needed for sending to Expo push tokens; EXPO_ACCESS_TOKEN
// only matters if you enable enhanced push security in your Expo account.
const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });

/**
 * Outcome of the most recent send, for diagnostics only.
 *
 * A push that Expo accepts and then fails to deliver is otherwise invisible:
 * the count of messages sent says nothing about whether any arrived. The admin
 * test endpoint reads this to answer "it didn't buzz — why?" with the reason
 * rather than a shrug.
 *
 * Deliberately a single module-level value rather than anything durable. It is
 * a debugging aid, and giving it a table would imply somebody reads it later.
 */
let lastTickets: string[] = [];

export function lastPushOutcomes(): string[] {
  return lastTickets;
}

/** Don't notify for trivial movement — noise costs trust. */
const MIN_DROP_PERCENT = 3;
const MIN_DROP_CENTS = 100;

/** At most one alert per tracked product per user per this window. */
const NOTIFY_COOLDOWN_HOURS = 12;

export interface DropNotification {
  productId: string;
  previousPrice: number;
  newPrice: number;
  /**
   * Restrict to a single tracker.
   *
   * Only used by the admin test endpoint, so exercising the real notification
   * path can't reach anyone else who happens to track the same product. A
   * genuine drop always leaves this unset and tells everybody.
   */
  onlyUserId?: string;
}

/**
 * Notify everyone tracking a product that its price dropped.
 * Returns how many notifications were actually sent.
 */
export async function notifyPriceDrop({
  productId,
  previousPrice,
  newPrice,
  onlyUserId,
}: DropNotification): Promise<number> {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return 0;

  const dropCents = previousPrice - newPrice;
  const dropPercent = Math.round((dropCents / previousPrice) * 100);

  const trackers = await prisma.trackedProduct.findMany({
    where: { productId, ...(onlyUserId ? { userId: onlyUserId } : {}) },
    include: {
      user: {
        include: {
          pushTokens: true,
          wallet: { select: { tier: true, tierExpiresAt: true } },
        },
      },
    },
  });

  const cooldownCutoff = new Date(
    Date.now() - NOTIFY_COOLDOWN_HOURS * 60 * 60 * 1000,
  );

  const messages: ExpoPushMessage[] = [];
  const notifiedTrackedIds: string[] = [];
  const feed: NotificationInput[] = [];

  for (const tracked of trackers) {
    // NOT skipped for users without a push token any more. They are precisely
    // the people the bell exists for: someone who never granted permission,
    // or whose phone was off, still needs to be able to find out the price
    // dropped. The token check now gates only the push itself.

    // Already told this user about this product recently.
    if (tracked.lastNotifiedAt && tracked.lastNotifiedAt > cooldownCutoff) continue;

    const tier: Tier = tracked.user.wallet
      ? effectiveTier(tracked.user.wallet)
      : "free";

    // A custom threshold replaces the default rule entirely: they asked to
    // hear about $X, not about "any meaningful drop".
    const hasThreshold =
      tracked.customThreshold !== null && TIER_LIMITS[tier].customThresholds;

    if (hasThreshold) {
      if (newPrice > tracked.customThreshold!) continue;
    } else if (dropPercent < MIN_DROP_PERCENT && dropCents < MIN_DROP_CENTS) {
      continue;
    }

    const body = hasThreshold
      ? `Now ${formatCents(newPrice)} — below your ${formatCents(tracked.customThreshold!)} alert.`
      : `Down ${dropPercent}% to ${formatCents(newPrice)} (was ${formatCents(previousPrice)}).`;

    // Filed for everyone who qualifies, with or without a push token.
    feed.push({
      userId: tracked.userId,
      kind: "price-drop",
      title: truncate(product.title, 60),
      body,
      // The tracked-product page, NOT /lookup. Two reasons, and the second is
      // the one that matters: /lookup spends a product lookup from the user's
      // daily allowance, so tapping a notification we sent would quietly cost
      // them something. It's also the wrong screen — someone told a price
      // dropped wants the history and the tracking controls for the item they
      // already follow, not a fresh page about it.
      //
      // This is also where the push itself goes, so both routes to the same
      // event land in the same place.
      href: `/product/${product.id}`,
    });

    for (const { token } of tracked.user.pushTokens) {
      if (!Expo.isExpoPushToken(token)) continue;

      messages.push({
        to: token,
        sound: "default",
        title: truncate(product.title, 60),
        body,
        // Consumed by the app to deep-link straight to the product.
        data: { productId: product.id, type: "price_drop" },
        // Must match the channel the app creates, or Android silently drops it.
        channelId: "price-drops",
      });
    }

    notifiedTrackedIds.push(tracked.id);
  }

  await recordNotifications(feed);

  if (messages.length === 0) {
    // No push to send, but people were still notified in the app, so the
    // cooldown has to be stamped or the bell fills with duplicates.
    if (notifiedTrackedIds.length > 0) {
      await prisma.trackedProduct.updateMany({
        where: { id: { in: notifiedTrackedIds } },
        data: { lastNotifiedAt: new Date() },
      });
    }
    return 0;
  }

  const tickets = await send(messages);
  await pruneDeadTokens(messages, tickets);
  lastTickets = tickets.map((ticket) =>
    ticket.status === "error"
      ? (ticket.details?.error ?? "error")
      : "ok",
  );

  // Stamp the cooldown for everyone told, by push or in the app.
  if (notifiedTrackedIds.length > 0) {
    await prisma.trackedProduct.updateMany({
      where: { id: { in: notifiedTrackedIds } },
      data: { lastNotifiedAt: new Date() },
    });
  }

  return messages.length;
}

/** Chunked send. Expo caps a request at 100 messages. */
async function send(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
  const tickets: ExpoPushTicket[] = [];

  for (const chunk of expo.chunkPushNotifications(messages)) {
    try {
      tickets.push(...(await expo.sendPushNotificationsAsync(chunk)));
    } catch (err) {
      console.error("[push] chunk failed:", err);
      // Keep ticket indices aligned with messages so pruning can't blame the
      // wrong token for a failure.
      tickets.push(
        ...chunk.map(
          () => ({ status: "error", message: "chunk send failed" }) as ExpoPushTicket,
        ),
      );
    }
  }

  return tickets;
}

/**
 * Delete tokens Expo tells us are dead. DeviceNotRegistered means the app was
 * uninstalled or the token was replaced — it will never succeed again.
 */
async function pruneDeadTokens(
  messages: ExpoPushMessage[],
  tickets: ExpoPushTicket[],
) {
  const dead: string[] = [];

  tickets.forEach((ticket, index) => {
    if (ticket.status !== "error") return;

    const message = messages[index];
    const token = Array.isArray(message?.to) ? message.to[0] : message?.to;
    if (!token) return;

    if (ticket.details?.error === "DeviceNotRegistered") {
      dead.push(token);
    } else {
      console.error(`[push] ${ticket.details?.error ?? "error"}: ${ticket.message}`);
    }
  });

  if (dead.length === 0) return;

  await prisma.pushToken.deleteMany({ where: { token: { in: dead } } });
  console.log(`[push] pruned ${dead.length} dead token(s)`);
}

function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function truncate(text: string, max: number) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * Tell someone their Deal Radar found something.
 *
 * Separate from notifyPriceDrop because the two say genuinely different things:
 * a price drop is "the thing you're watching got cheaper", a radar hit is "the
 * thing you were waiting for exists now, here". Sharing one function would mean
 * one of them wording itself awkwardly forever.
 */
export async function notifyRadarMatch(input: {
  userId: string;
  keyword: string;
  price: number;
  retailerLabel: string;
  title: string;
  searchId: string;
  targetPrice: number | null;
}): Promise<number> {
  const tokens = await prisma.pushToken.findMany({ where: { userId: input.userId } });

  const body = input.targetPrice !== null
    ? `${formatCents(input.price)} at ${input.retailerLabel} — under your ${formatCents(input.targetPrice)} target.`
    : `${formatCents(input.price)} at ${input.retailerLabel} — the cheapest we've seen.`;

  // Filed before the token check, for the same reason as price drops: someone
  // without push notifications still set up this radar and still wants to know
  // it found something.
  await recordNotification({
    userId: input.userId,
    kind: "radar-match",
    title: truncate(input.title, 60),
    body,
    // Matches where the push goes. A radar hit is about the saved search
    // rather than one product — the interesting thing is what it found and
    // whether the search is still worth keeping.
    href: "/radar",
  });

  if (tokens.length === 0) return 0;

  const messages: ExpoPushMessage[] = [];
  for (const { token } of tokens) {
    if (!Expo.isExpoPushToken(token)) continue;
    messages.push({
      to: token,
      sound: "default",
      title: `Radar: ${truncate(input.keyword, 40)}`,
      body,
      data: { searchId: input.searchId, type: "radar_match" },
      channelId: "price-drops",
    });
  }

  if (messages.length === 0) return 0;

  const tickets = await send(messages);
  await pruneDeadTokens(messages, tickets);
  return messages.length;
}
