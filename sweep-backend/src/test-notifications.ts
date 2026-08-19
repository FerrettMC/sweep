// test-notifications.ts — the feed behind the bell.
//   npm run test:notifications
//
// Runs on the DEV database. The point of the feed is that it works for people
// push doesn't reach, so that's what's tested hardest.
import "./testEnv.js";
import { prisma } from "./lib/prisma.js";
import {
  countUnread,
  listNotifications,
  markAllRead,
  pruneNotifications,
  recordNotification,
  recordNotifications,
} from "./lib/notificationFeed.js";

let pass = 0,
  fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok && detail !== undefined) console.log("     ", JSON.stringify(detail).slice(0, 300));
};

const TAG = `notiftest-${Date.now()}`;
const userIds: string[] = [];

async function makeUser(): Promise<string> {
  const id = `${TAG}-${userIds.length}`;
  await prisma.user.create({ data: { id, email: `${id}@example.com` } });
  userIds.push(id);
  return id;
}

try {
  const user = await makeUser();
  const other = await makeUser();

  console.log("\n— filing and reading —");
  await recordNotification({
    userId: user,
    kind: "price-drop",
    title: "Sony WH-1000XM5",
    body: "Down 20% to $319.00",
    href: "/lookup?productId=abc",
  });
  const listed = await listNotifications(user);
  check("one notification is filed", listed.length === 1, listed.length);
  check("it starts unread", listed[0].readAt === null);
  check("unread count agrees", (await countUnread(user)) === 1);
  check("the tap target survives", listed[0].href === "/lookup?productId=abc");

  console.log("\n— one person's bell is not another's —");
  check("nobody else sees it", (await listNotifications(other)).length === 0);
  check("and their count is zero", (await countUnread(other)) === 0);

  console.log("\n— newest first —");
  // The list is read top-down; an old drop above a new one is a bug you only
  // notice when it matters.
  await recordNotification({ userId: user, kind: "radar-match", title: "Newer", body: "b" });
  const ordered = await listNotifications(user);
  check("most recent is first", ordered[0].title === "Newer", ordered.map((n) => n.title));

  console.log("\n— clearing the badge —");
  check("marks everything read at once", (await markAllRead(user)) === 2);
  check("count drops to zero", (await countUnread(user)) === 0);
  check("but the notifications stay", (await listNotifications(user)).length === 2);
  check("clearing twice clears nothing extra", (await markAllRead(user)) === 0);

  console.log("\n— a new one after clearing shows again —");
  await recordNotification({ userId: user, kind: "announcement", title: "Hello", body: "b" });
  check("badge returns", (await countUnread(user)) === 1);

  console.log("\n— filing for several people at once —");
  const a = await makeUser();
  const b = await makeUser();
  await recordNotifications([
    { userId: a, kind: "price-drop", title: "Shared", body: "b" },
    { userId: b, kind: "price-drop", title: "Shared", body: "b" },
  ]);
  check("each gets their own copy", (await countUnread(a)) === 1 && (await countUnread(b)) === 1);

  console.log("\n— recording never throws —");
  // Callers are mid-push when they call this. A database problem here must not
  // cost someone the alert they were actually waiting for.
  let threw = false;
  try {
    await recordNotification({
      userId: "does-not-exist",
      kind: "price-drop",
      title: "x",
      body: "y",
    });
  } catch {
    threw = true;
  }
  check("a bad user id is swallowed, not thrown", !threw);
  check("nothing is filed for it", (await prisma.notification.count({ where: { userId: "does-not-exist" } })) === 0);

  console.log("\n— old notifications are pruned —");
  await prisma.notification.updateMany({
    where: { userId: user },
    data: { createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) },
  });
  const pruned = await pruneNotifications();
  check("two-month-old rows are removed", pruned >= 3, pruned);
  check("that user's feed is empty", (await listNotifications(user)).length === 0);
  check("recent ones survive", (await listNotifications(a)).length === 1);
} finally {
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
