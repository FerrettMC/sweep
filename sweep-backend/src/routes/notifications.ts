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
import {
  countUnread,
  listNotifications,
  markAllRead,
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

}
