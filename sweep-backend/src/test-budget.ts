// src/test-budget.ts — end-to-end check of the budget tracker.
//   npm run dev && npm run test:budget
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "./lib/prisma.js";
import { purgeTestUser } from "./testCleanup.js";

const API = process.env.TEST_API_URL ?? "http://localhost:3001";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
let pass = 0, fail = 0;
const check = (l: string, ok: boolean, d?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${l}`);
  if (!ok && d !== undefined) console.log("     ", JSON.stringify(d).slice(0, 240));
};

async function mkUser(tag: string) {
  const email = `sweep-${tag}-${Date.now()}@example.com`;
  const { data, error } = await sb.auth.signUp({ email, password: "sweep-test-password-123" });
  if (error || !data.session) throw new Error("auth: " + error?.message);
  const token = data.session.access_token;
  await fetch(`${API}/auth/sync-user`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ email }),
  });
  return { id: data.session.user.id, token };
}

const call = async (token: string | null, m: string, p: string, b?: unknown) => {
  const r = await fetch(API + p, {
    method: m,
    headers: { ...(b !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(b !== undefined ? { body: JSON.stringify(b) } : {}),
  });
  const t = await r.text();
  let j: any = null; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 300) }; }
  return { status: r.status, body: j };
};

const free = await mkUser("bf");
const other = await mkUser("bo");

const thisMonth = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

console.log("\n— logging —");
const a = await call(free.token, "POST", "/budget", {
  amount: 4999, category: "Electronics", description: "Headphones",
});
check("an entry is created", a.status === 201 && a.body.entry?.amount === 4999, a.body);

const b = await call(free.token, "POST", "/budget", { amount: 1250, category: "Clothing" });
check("a second entry in another category", b.status === 201, b.body);

check("zero is refused", (await call(free.token, "POST", "/budget", { amount: 0, category: "Home" })).status === 400);
check("negative is refused", (await call(free.token, "POST", "/budget", { amount: -500, category: "Home" })).status === 400);
check("a missing category is refused", (await call(free.token, "POST", "/budget", { amount: 100 })).status === 400);
check(
  "a future date is refused",
  (await call(free.token, "POST", "/budget", {
    amount: 100, category: "Home", spentAt: new Date(Date.now() + 90 * 86400000).toISOString(),
  })).status === 400,
);

console.log("\n— the month view —");
const m = await call(free.token, "GET", `/budget?month=${thisMonth()}`);
check("totals the month", m.status === 200 && m.body.total === 4999 + 1250, m.body.total);
check("groups by category, biggest first", m.body.categories?.[0]?.category === "Electronics", m.body.categories);
check("no budget set yet", m.body.budget === null);
check("offers the default categories", m.body.availableCategories?.includes("Gifts"));
check("a bad month string is refused", (await call(free.token, "GET", "/budget?month=nonsense")).status === 400);

console.log("\n— the overall budget (every tier) —");
check("a free user can set one", (await call(free.token, "PUT", "/budget/limits", { category: null, amount: 20000 })).status === 200);
const withBudget = await call(free.token, "GET", "/budget");
check("it comes back on the month view", withBudget.body.budget === 20000, withBudget.body.budget);
check(
  "setting it again replaces rather than duplicates",
  (await call(free.token, "PUT", "/budget/limits", { category: null, amount: 25000 })).status === 200 &&
    (await call(free.token, "GET", "/budget")).body.budget === 25000,
);
check("it can be cleared", (await call(free.token, "PUT", "/budget/limits", { category: null, amount: null })).status === 200 &&
  (await call(free.token, "GET", "/budget")).body.budget === null);

console.log("\n— tier gates —");
const catLimit = await call(free.token, "PUT", "/budget/limits", { category: "Electronics", amount: 10000 });
check("per-category limits are refused on free", catLimit.status === 403 && catLimit.body.code === "CATEGORY_LIMIT_REQUIRES_TIER", catLimit.body);
const custom = await call(free.token, "POST", "/budget", { amount: 100, category: "Vinyl Records" });
check("a custom category is refused on free", custom.status === 403 && custom.body.code === "CUSTOM_CATEGORY_REQUIRES_TIER", custom.body);
const exp = await call(free.token, "GET", "/budget/export.csv");
check("export is refused on free", exp.status === 403, exp.body);

const old = await call(free.token, "GET", "/budget?month=2024-01");
check("a month beyond the history window is refused with a reason", old.status === 403 && old.body.code === "HISTORY_LIMIT_REACHED", old.body);

console.log("\n— the same user on pro —");
await prisma.wallet.update({ where: { userId: free.id }, data: { tier: "pro" } });
check("per-category limits now work", (await call(free.token, "PUT", "/budget/limits", { category: "Electronics", amount: 10000 })).status === 200);
const proMonth = await call(free.token, "GET", "/budget");
check("the limit shows against its category", proMonth.body.categories?.find((c: any) => c.category === "Electronics")?.limit === 10000, proMonth.body.categories);
check("a custom category now works", (await call(free.token, "POST", "/budget", { amount: 100, category: "Vinyl Records" })).status === 201);
const proExport = await call(free.token, "GET", "/budget/export.csv");
check("export works and has a header row", proExport.status === 200 && String(proExport.body.raw ?? "").startsWith("Date,Amount"), proExport.body);

console.log("\n— a limit with no spending still shows —");
await call(free.token, "PUT", "/budget/limits", { category: "Gifts", amount: 5000 });
const withEmpty = await call(free.token, "GET", "/budget");
const gifts = withEmpty.body.categories?.find((c: any) => c.category === "Gifts");
check("a capped category with no spend appears at $0", gifts?.spent === 0 && gifts?.limit === 5000, withEmpty.body.categories);

console.log("\n— editing and deleting —");
const entryId = a.body.entry.id;
check("an entry can be edited", (await call(free.token, "PATCH", `/budget/${entryId}`, { amount: 5500 })).status === 200);
const edited = await call(free.token, "GET", "/budget");
check("the edit is reflected in the total", edited.body.entries.find((e: any) => e.id === entryId)?.amount === 5500);

console.log("\n— ownership —");
check("another user can't read your spending", (await call(other.token, "GET", "/budget")).body.total === 0);
check("another user can't edit your entry", (await call(other.token, "PATCH", `/budget/${entryId}`, { amount: 1 })).status === 404);
check("another user can't delete your entry", (await call(other.token, "DELETE", `/budget/${entryId}`)).status === 404);
check("auth is required", (await call(null, "GET", "/budget")).status === 401);

check("you can delete your own", (await call(free.token, "DELETE", `/budget/${entryId}`)).status === 200);
check("deleting twice 404s", (await call(free.token, "DELETE", `/budget/${entryId}`)).status === 404);

// ---- cleanup ----
for (const id of [free.id, other.id]) {
  await prisma.budgetEntry.deleteMany({ where: { userId: id } });
  await prisma.budgetLimit.deleteMany({ where: { userId: id } });
  await purgeTestUser(id);
}

console.log(`\n${pass} passed, ${fail} failed  (cleaned up)`);
process.exit(fail ? 1 : 0);
