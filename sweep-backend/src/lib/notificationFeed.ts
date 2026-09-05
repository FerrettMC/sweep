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
 * How many notifications one account keeps.
 *
 * Deliberately a count and not an age. These used to be deleted after thirty
 * days, which meant the record quietly emptied itself: someone who tracked a
 * price for a season would come back to a bell that had thrown away the drops
 * it caught. A notification is the only lasting evidence that tracking a
 * product did anything, so it stays until its owner decides otherwise.
 *
 * The cap exists solely so one account cannot grow without bound. It is set
 * far above what anyone accumulates in normal use, and it discards oldest
 * first, so in practice it is a backstop rather than a policy.
 */
const MAX_PER_USER = 300;

/** Newest first, bounded. */
export async function listNotifications(userId: string, limit = 100) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/**
 * Delete one, on the owner's instruction.
 *
 * Scoped by userId as well as id: an id is guessable enough that deleting on
 * id alone would let one account clear another's bell.
 */
export async function deleteNotification(userId: string, id: string): Promise<boolean> {
  const { count } = await prisma.notification.deleteMany({ where: { id, userId } });
  return count > 0;
}

/** Delete all of one account's, on its owner's instruction. */
export async function clearNotifications(userId: string): Promise<number> {
  const { count } = await prisma.notification.deleteMany({ where: { userId } });
  return count;
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

/**
 * Trim any account that has gone past the cap, oldest first.
 *
 * Raw SQL because the alternative is a query per user, and this runs against
 * every account on a schedule. The window function ranks each account's rows
 * newest-first and deletes everything past the cap in one statement.
 *
 * Note this deletes nothing at all until an account is over the cap — unlike
 * the age-based prune it replaces, an idle account never loses a row.
 */
export async function pruneNotifications(): Promise<number> {
  return prisma.$executeRaw`
    DELETE FROM "Notification"
    WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY "userId" ORDER BY "createdAt" DESC, id DESC
        ) AS rn
        FROM "Notification"
      ) ranked
      WHERE rn > ${MAX_PER_USER}
    )
  `;
}
