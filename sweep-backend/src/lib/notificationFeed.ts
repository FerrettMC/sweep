// lib/notificationFeed.ts
//
// The record behind the bell.
//
// A push notification is an interruption, not a record. It lands on a lock
// screen and is gone the moment it's swiped — so someone whose phone was off,
// who never granted permission, or who dismissed one by accident has no way to
// discover what they missed. That makes price alerts feel unreliable even on
// the occasions they worked perfectly.
//
// Every alert is written here as well. Recording is deliberately best-effort:
// failing to file a record must never stop the push that someone is actually
// waiting for.

import { prisma } from "./prisma.js";

export interface NotificationInput {
  userId: string;
  kind: "price-drop" | "radar-match" | "announcement";
  title: string;
  body: string;
  /** In-app path to open, e.g. "/lookup?productId=abc". */
  href?: string | null;
}

/**
 * File one notification.
 *
 * Never throws. The caller is in the middle of sending a push, and a database
 * hiccup here is not worth losing that over.
 */
export async function recordNotification(input: NotificationInput): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        title: input.title,
        body: input.body,
        href: input.href ?? null,
      },
    });
  } catch {
    // The push still goes out. A missing row costs the bell one entry.
  }
}

/** File the same notification for several people, e.g. one product's watchers. */
export async function recordNotifications(
  inputs: NotificationInput[],
): Promise<void> {
  if (inputs.length === 0) return;
  try {
    await prisma.notification.createMany({
      data: inputs.map((input) => ({
        userId: input.userId,
        kind: input.kind,
        title: input.title,
        body: input.body,
        href: input.href ?? null,
      })),
    });
  } catch {
    // Same reasoning as above.
  }
}

/**
 * How long a notification is worth keeping.
 *
 * A price drop from two months ago is not news, and the row is the only thing
 * making the list long enough to need paging. Pruned rather than archived
 * because nothing reads them after the fact.
 */
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Newest first, bounded. */
export async function listNotifications(userId: string, limit = 50) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function countUnread(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

/**
 * Mark everything read.
 *
 * Deliberately a bulk operation rather than per-row: the bell's badge is the
 * only thing "unread" drives, and opening the list is the act that clears it.
 * Tracking which individual rows were looked at would be state nobody sees.
 */
export async function markAllRead(userId: string): Promise<number> {
  const { count } = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return count;
}

export async function pruneNotifications(): Promise<number> {
  const { count } = await prisma.notification.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - RETENTION_MS) } },
  });
  return count;
}
