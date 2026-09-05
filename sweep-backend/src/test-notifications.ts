// test-notifications.ts — the feed behind the bell.
//   npm run test:notifications
//
// Runs on the DEV database. The point of the feed is that it works for people
// push doesn't reach, so that's what's tested hardest.
import "./testEnv.js";
import { prisma } from "./lib/prisma.js";
import {
  clearNotifications,
  countUnread,
  deleteNotification,
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

  console.log("\n— age alone removes nothing —");
  // The behaviour this replaced deleted anything older than thirty days, so a
  // feed emptied itself while its owner was doing nothing wrong. A price drop
  // is the only lasting evidence that tracking a product did something.
  const beforeAging = (await listNotifications(user)).length;
  await prisma.notification.updateMany({
    where: { userId: user },
    data: { createdAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000) },
  });
  await pruneNotifications();
  check(
    "a year-old feed is still there",
    (await listNotifications(user)).length === beforeAging,
    { beforeAging, now: (await listNotifications(user)).length },
  );

  console.log("\n— only its owner removes one —");
  const feed = await listNotifications(user);
  check("delete reports it deleted something", await deleteNotification(user, feed[0].id));
  check("and it is gone", (await listNotifications(user)).length === beforeAging - 1);
  // The client removes the row on tap and needs to know when it was already
  // gone, rather than being told yes twice.
  check("deleting the same one twice says no", !(await deleteNotification(user, feed[0].id)));
  // An id alone must not be enough. This is the check that stops one account
  // clearing another's bell.
  check("another account cannot delete it", !(await deleteNotification(other, feed[1].id)));
  check("so it survives", (await listNotifications(user)).length === beforeAging - 1);

  console.log("\n— clearing all is scoped to one account —");
  const cleared = await clearNotifications(user);
  check("reports how many went", cleared === beforeAging - 1, cleared);
  check("that feed is empty", (await listNotifications(user)).length === 0);
  check("and nobody else's is", (await listNotifications(a)).length === 1);

  console.log("\n— but one account cannot grow without bound —");
  const hoarder = await makeUser();
  await prisma.notification.createMany({
    data: Array.from({ length: 305 }, (_, i) => ({
      userId: hoarder,
      kind: "price-drop",
      title: `Drop ${i}`,
      body: "b",
      // Distinct timestamps, oldest first, so "trims oldest" is actually
      // testable rather than depending on insertion order.
      createdAt: new Date(Date.now() - (305 - i) * 60_000),
    })),
  });
  const trimmed = await pruneNotifications();
  check("trims the overflow", trimmed === 5, trimmed);
  const kept = await listNotifications(hoarder, 400);
  check("keeps the cap exactly", kept.length === 300, kept.length);
  check("and keeps the NEWEST", kept[0].title === "Drop 304", kept[0].title);
  check("dropping the oldest", !kept.some((n) => n.title === "Drop 0"));
  check("an account under the cap is untouched", (await listNotifications(a)).length === 1);
  console.log("\n— the announcement endpoint is guarded —");
  // It writes to every user's screen, so the failure mode of getting this
  // wrong is worse than for anything else in the app.
  const route = (await import("node:fs")).readFileSync(
    new URL("./routes/notifications.ts", import.meta.url),
    "utf8",
  );
  check("refuses when no secret is configured", /ADMIN_API_KEY is not set/.test(route));
  check("compares the key in constant time", /timingSafeEqual/.test(route));
  check("caps the length of what can be sent", /TOO_LONG/.test(route));
  check(
    "only accepts in-app paths as the tap target",
    /startsWith\("\/"\)/.test(route),
  );

} finally {
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
