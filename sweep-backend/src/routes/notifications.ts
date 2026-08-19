// routes/notifications.ts
//
// Push token registration, and the feed behind the bell.
//
// Registration: the app calls this once permission is granted, and again
// whenever the token changes — Expo can rotate a token after a reinstall or an
// OS update, so registration is idempotent by design.
//
// The feed is the other half of the same idea. A push is an interruption that
// vanishes when it's swiped; the feed is the record, and it exists for
// everyone, including people who never granted permission at all.

import type { FastifyInstance } from "fastify";
import { Expo } from "expo-server-sdk";
import { requireAuth } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";
import { lastPushOutcomes, notifyPriceDrop } from "../lib/push.js";
import { timingSafeEqual } from "node:crypto";
import {
  countUnread,
  listNotifications,
  markAllRead,
  recordNotification,
  recordNotifications,
} from "../lib/notificationFeed.js";

export async function notificationRoutes(app: FastifyInstance) {
  // ---- register this device ----
  app.post(
    "/notifications/register",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.userId!;
      const { token, platform } = (request.body ?? {}) as {
        token?: unknown;
        platform?: unknown;
      };

      if (typeof token !== "string" || !Expo.isExpoPushToken(token)) {
        return reply.status(400).send({
          error: "Not a valid Expo push token",
          code: "INVALID_PUSH_TOKEN",
        });
      }

      const normalizedPlatform =
        platform === "ios" || platform === "android" ? platform : null;

      // Upsert on token, not on (user, token): if a device is handed to someone
      // else, the token must move to the new user rather than notifying the old
      // one about products they no longer track.
      await prisma.pushToken.upsert({
        where: { token },
        create: { token, userId, platform: normalizedPlatform },
        update: {
          userId,
          platform: normalizedPlatform,
          lastUsedAt: new Date(),
        },
      });

      return { ok: true };
    },
  );

  // ---- unregister (sign out, or permission revoked) ----
  app.delete(
    "/notifications/register",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.userId!;
      const { token } = (request.body ?? {}) as { token?: unknown };

      if (typeof token !== "string") {
        return reply.status(400).send({ error: "token is required" });
      }

      // Scoped by userId so one user can't deregister another's device.
      await prisma.pushToken.deleteMany({ where: { token, userId } });

      return { ok: true };
    },
  );

  // ---- what devices are registered? ----
  // Used by the profile screen to tell the user whether alerts are actually
  // going to reach them, rather than assuming permission implies delivery.
  app.get(
    "/notifications/status",
    { preHandler: requireAuth },
    async (request) => {
      const devices = await prisma.pushToken.count({
        where: { userId: request.userId! },
      });
      return { registered: devices > 0, devices };
    },
  );
  // ---- the bell ----

  app.get("/notifications", { preHandler: requireAuth }, async (request) => {
    const userId = request.userId!;
    const [items, unread] = await Promise.all([
      listNotifications(userId),
      countUnread(userId),
    ]);

    return {
      unread,
      notifications: items.map((n) => ({
        id: n.id,
        kind: n.kind,
        title: n.title,
        body: n.body,
        href: n.href,
        read: n.readAt !== null,
        createdAt: n.createdAt.toISOString(),
      })),
    };
  });

  // Separate from the GET rather than clearing on read, so fetching the list
  // and clearing the badge stay two decisions. A list that marks itself read
  // the moment it's fetched can never be refreshed in the background.
  app.post("/notifications/read", { preHandler: requireAuth }, async (request) => {
    return { cleared: await markAllRead(request.userId!) };
  });

  // ---- sending an announcement ----
  //
  // Also the only way to test the bell without waiting for a real price drop.
  //
  // Guarded by a shared secret rather than by a user session, because there is
  // no "admin" concept in this app and inventing one would be a bigger change
  // than the feature. Same shape as the RevenueCat webhook: an unset secret
  // refuses outright rather than defaulting open, since an unauthenticated
  // version of this writes to every user's screen.
  app.post("/notifications/announce", async (request, reply) => {
    const expected = process.env.ADMIN_API_KEY;
    if (!expected) {
      request.log.error("ADMIN_API_KEY is not set");
      return reply.status(503).send({ error: "Announcements not configured" });
    }

    const provided = request.headers["x-admin-key"];
    if (typeof provided !== "string" || !secretsMatch(provided, expected)) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const body = (request.body ?? {}) as {
      title?: unknown;
      body?: unknown;
      href?: unknown;
      email?: unknown;
    };

    const title = typeof body.title === "string" ? body.title.trim() : "";
    const text = typeof body.body === "string" ? body.body.trim() : "";
    if (!title || !text) {
      return reply
        .status(400)
        .send({ error: "title and body are required", code: "MISSING_FIELDS" });
    }
    // Bounded so a typo can't write a novel onto everyone's screen.
    if (title.length > 80 || text.length > 300) {
      return reply.status(400).send({
        error: "title must be 80 characters or fewer, body 300",
        code: "TOO_LONG",
      });
    }

    const href = typeof body.href === "string" && body.href.startsWith("/")
      ? body.href
      : null;

    // With an email, one person — which is how you send yourself a test.
    // Without, everyone.
    if (typeof body.email === "string") {
      const user = await prisma.user.findUnique({
        where: { email: body.email.trim().toLowerCase() },
        select: { id: true },
      });
      if (!user) return reply.status(404).send({ error: "No user with that email" });

      await recordNotification({
        userId: user.id,
        kind: "announcement",
        title,
        body: text,
        href,
      });
      return { sent: 1 };
    }

    const users = await prisma.user.findMany({ select: { id: true } });
    await recordNotifications(
      users.map((user) => ({
        userId: user.id,
        kind: "announcement" as const,
        title,
        body: text,
        href,
      })),
    );
    return { sent: users.length };
  });

  // ---- fire a test price drop ----
  //
  // Exercises the real notification path — the same wording, the same push
  // channel, the same feed record, the same cooldown — rather than faking
  // something that looks like it. Testing a lookalike proves nothing about
  // the thing that actually runs.
  //
  // It sends to ONE person, always, even for a product several people track.
  // A test that can reach strangers is not a test.
  //
  // It does NOT change any stored price. Nothing is written to price history,
  // so this can't pollute the data the sale verdict is judged against.
  app.post("/notifications/test-drop", async (request, reply) => {
    const expected = process.env.ADMIN_API_KEY;
    if (!expected) {
      return reply.status(503).send({ error: "Announcements not configured" });
    }
    const provided = request.headers["x-admin-key"];
    if (typeof provided !== "string" || !secretsMatch(provided, expected)) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const body = (request.body ?? {}) as {
      email?: unknown;
      match?: unknown;
      percent?: unknown;
    };
    if (typeof body.email !== "string") {
      return reply.status(400).send({ error: "email is required" });
    }

    const user = await prisma.user.findUnique({
      where: { email: body.email.trim().toLowerCase() },
      select: { id: true },
    });
    if (!user) return reply.status(404).send({ error: "No user with that email" });

    const tracked = await prisma.trackedProduct.findMany({
      where: { userId: user.id },
      include: { product: true },
      orderBy: { addedAt: "desc" },
    });

    // `match` is a substring of the title, because finding a product id by
    // hand to send yourself a test is exactly the sort of friction that means
    // the test doesn't get run.
    const needle = typeof body.match === "string" ? body.match.toLowerCase() : null;
    const target = needle
      ? tracked.find((t) => t.product.title.toLowerCase().includes(needle))
      : tracked[0];

    if (!target) {
      return reply.status(404).send({
        error: needle
          ? `Nothing tracked matching "${needle}"`
          : "That account isn't tracking anything",
        tracking: tracked.map((t) => t.product.title),
      });
    }
    if (target.product.currentPrice === null) {
      return reply.status(409).send({ error: "That product has no price to drop from" });
    }

    // Clear the cooldown first, or a second test within the window would
    // silently do nothing and look like a broken feature.
    await prisma.trackedProduct.update({
      where: { id: target.id },
      data: { lastNotifiedAt: null },
    });

    const percent =
      typeof body.percent === "number" && body.percent > 0 && body.percent < 90
        ? body.percent
        : 20;
    const previousPrice = target.product.currentPrice;
    const newPrice = Math.max(1, Math.round(previousPrice * (1 - percent / 100)));

    const sent = await notifyPriceDrop({
      productId: target.productId,
      previousPrice,
      newPrice,
      onlyUserId: user.id,
    });

    const tokens = await prisma.pushToken.count({ where: { userId: user.id } });

    return {
      product: target.product.title,
      previousPrice,
      newPrice,
      // Attempted, not delivered — which is exactly why the two fields below
      // exist. Expo accepting a message says nothing about it arriving.
      pushesAttempted: sent,
      devicesRegistered: tokens,
      /**
       * What Expo said about each message. "ok" means accepted;
       * "DeviceNotRegistered" means the token is dead and has now been
       * removed; anything else is Expo's own error name.
       */
      pushOutcomes: sent > 0 ? lastPushOutcomes() : [],
      // Says so explicitly, because "0 pushes" looks like failure when it
      // usually means notifications simply aren't switched on — and the bell
      // entry was still filed either way.
      note:
        tokens === 0
          ? "This account has no registered device, so nothing could buzz. Open the app, allow notifications, and check Profile says alerts are on. The bell entry was filed either way."
          : sent === 0
            ? "A device is registered but no message was built — the drop may not have met the alert rules."
            : "Accepted by Expo. If nothing arrived, check pushOutcomes above and that notifications are allowed for Sweep in Android settings.",
    };
  });
}

/**
 * Constant-time comparison, so a wrong key can't be found a character at a
 * time by watching how long the rejection takes.
 */
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length. Compare lengths separately and still run the check.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
