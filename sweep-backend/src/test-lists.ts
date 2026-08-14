// src/test-lists.ts — end-to-end check of lists + sharing.
//   npm run dev && npm run test:lists
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "./lib/prisma.js";
import { createTestUser, purgeTestUser } from "./testCleanup.js";

const API = process.env.TEST_API_URL ?? "http://localhost:3001";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
let pass = 0, fail = 0;
const check = (l: string, ok: boolean, d?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${l}`);
  if (!ok && d !== undefined) console.log("     ", JSON.stringify(d).slice(0, 240));
};

async function mkUser(tag: string) {
  // Shared helper: creates the account pre-confirmed via the admin API,
  // because email confirmation is on and @example.com can't receive mail.
  return createTestUser(tag, API);
}

const call = async (token: string | null, m: string, p: string, b?: unknown) => {
  const r = await fetch(API + p, {
    method: m,
    headers: { ...(b ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(b ? { body: JSON.stringify(b) } : {}),
  });
  const t = await r.text();
  let j: any = null; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 150) }; }
  return { status: r.status, body: j };
};

const owner = await mkUser("lo");
const other = await mkUser("lx");

console.log("— creating —");
const created = await call(owner.token, "POST", "/lists", { name: "Christmas 2026", description: "ideas" });
check("creates a list", created.status === 201 && created.body.list.name === "Christmas 2026", created.body);
const listId = created.body?.list?.id;

check("free tier is capped at 1 list",
  (await call(owner.token, "POST", "/lists", { name: "Second" })).body?.code === "LIST_LIMIT_REACHED");
check("rejects an empty name", (await call(owner.token, "POST", "/lists", { name: "  " })).status === 400);

console.log("\n— items —");
const added = await call(owner.token, "POST", `/lists/${listId}/items`,
  { url: "https://www.walmart.com/ip/Apple-AirPods-4/11381374703", note: "size M" });
check("adds a product by pasted link", added.status === 201 && added.body.item.product.price > 0, added.body);
const itemId = added.body?.item?.id;
check("keeps the note", added.body?.item?.note === "size M", added.body?.item?.note);

const dupe = await call(owner.token, "POST", `/lists/${listId}/items`,
  { url: "https://www.walmart.com/ip/Apple-AirPods-4/11381374703" });
check("adding the same product twice is idempotent", dupe.body?.item?.id === itemId, dupe.body?.item?.id);

const mine = await call(owner.token, "GET", "/lists");
check("list shows its item count and total value",
  mine.body.lists[0].itemCount === 1 && mine.body.lists[0].totalValue > 0, mine.body.lists[0]);

console.log("\n— sharing —");
check("an unshared list 404s publicly", (await call(null, "GET", "/shared/madeuptoken")).status === 404);

const shared = await call(owner.token, "POST", `/lists/${listId}/share`, { enabled: true });
const token = shared.body?.shareToken;
check("sharing returns a token", shared.status === 200 && typeof token === "string" && token.length > 8, shared.body);

const publicView = await call(null, "GET", `/shared/${token}`);
check("anyone with the link can read it", publicView.status === 200 && publicView.body.items.length === 1, publicView.body);
check("shows the owner's display name", typeof publicView.body?.owner === "string" && publicView.body.owner.length > 0);
check("leaks no email", !JSON.stringify(publicView.body).includes("@example.com"), "LEAKED");
check("leaks no user id", !JSON.stringify(publicView.body).includes(owner.id), "LEAKED ID");

console.log("\n— claiming —");
const claimed = await call(null, "POST", `/shared/${token}/items/${itemId}/claim`, { claimed: true });
check("a visitor can claim an item without an account", claimed.status === 200 && claimed.body.claimed === true, claimed.body);
check("the claim shows on the shared view",
  (await call(null, "GET", `/shared/${token}`)).body.items[0].claimed === true);

console.log("\n— ownership —");
check("another user can't add to it",
  (await call(other.token, "POST", `/lists/${listId}/items`, { url: "https://www.walmart.com/ip/x/11381374703" })).status === 404);
check("another user can't rename it",
  (await call(other.token, "PATCH", `/lists/${listId}`, { name: "hacked" })).status === 404);
check("another user can't delete it",
  (await call(other.token, "DELETE", `/lists/${listId}`)).status === 404);
check("another user's list index is empty", (await call(other.token, "GET", "/lists")).body.lists.length === 0);

console.log("\n— unsharing —");
await call(owner.token, "POST", `/lists/${listId}/share`, { enabled: false });
check("the old link stops working immediately", (await call(null, "GET", `/shared/${token}`)).status === 404);
const reshared = await call(owner.token, "POST", `/lists/${listId}/share`, { enabled: true });
check("re-sharing mints a DIFFERENT token", reshared.body.shareToken !== token, {
  old: token, new: reshared.body.shareToken,
});

// cleanup
for (const u of [owner, other]) {
  await prisma.list.deleteMany({ where: { userId: u.id } });
  await prisma.transaction.deleteMany({ where: { userId: u.id } });
  await prisma.trackedProduct.deleteMany({ where: { userId: u.id } });
  await purgeTestUser(u.id);
}
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
for (const u of [owner, other]) await admin.auth.admin.deleteUser(u.id);

console.log(`\n${pass} passed, ${fail} failed  (cleaned up)`);
if (fail > 0) process.exitCode = 1;
await prisma.$disconnect();
