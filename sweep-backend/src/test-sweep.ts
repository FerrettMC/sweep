// src/test-sweep.ts — "Sweep this deal" end to end.
//   npm run dev && npm run test:sweep
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "./lib/prisma.js";

const API = process.env.TEST_API_URL ?? "http://localhost:3001";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
let pass = 0, fail = 0;
const check = (l: string, ok: boolean, d?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${l}`);
  if (!ok && d !== undefined) console.log("     ", JSON.stringify(d).slice(0, 300));
};
const call = async (t: string | null, m: string, p: string, b?: unknown) => {
  const r = await fetch(API + p, {
    method: m,
    headers: { ...(b !== undefined ? { "Content-Type": "application/json" } : {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    ...(b !== undefined ? { body: JSON.stringify(b) } : {}),
  });
  const txt = await r.text();
  let j: any = null; try { j = JSON.parse(txt); } catch { j = { raw: txt.slice(0, 200) }; }
  return { status: r.status, body: j };
};

const email = `sweep-sw-${Date.now()}@example.com`;
const { data } = await sb.auth.signUp({ email, password: "sweep-test-password-123" });
const token = data.session!.access_token;
const userId = data.session!.user.id;
await call(token, "POST", "/auth/sync-user", { email });

// A product with real history, so the sale verdict has something to judge.
const product = await prisma.product.create({
  data: {
    retailer: "walmart", retailerId: `sweep-test-${Date.now()}`,
    url: "https://www.walmart.com/ip/test/1",
    title: "Sony WH-1000XM5 Wireless Noise Cancelling Headphones Black",
    currentPrice: 29800, listPrice: 39900, currency: "USD",
  },
});
for (const p of [29900, 29800, 30100, 29800]) {
  await prisma.priceHistory.create({ data: { productId: product.id, price: p } });
}

console.log("\n— tier gate —");
let r = await call(token, "GET", "/sweep/quota");
check("free tier reports the feature unavailable", r.body.quota?.available === false && r.body.quota?.limit === 0, r.body);
r = await call(token, "POST", "/sweep", { productId: product.id });
check("free tier is refused", r.status === 403 && r.body.code === "SWEEP_REQUIRES_TIER", r.body);

console.log("\n— pro gets one a day —");
await prisma.wallet.update({ where: { userId }, data: { tier: "pro" } });
r = await call(token, "GET", "/sweep/quota");
check("pro reports 1 available", r.body.quota?.limit === 1 && r.body.quota?.available === true, r.body);

r = await call(token, "POST", "/sweep", { productId: product.id });
check("the sweep succeeds", r.status === 200, r.body?.error ?? r.body?.code);
const result = r.body.result;
check("it returns a verdict on the sale", typeof result?.sale?.verdict === "string", result?.sale);
check("it reads our history, not the store's claim", result?.history?.points === 4, result?.history);
check("it notices the claimed discount", result?.sale?.claimedPercentOff === 25, result?.sale);
check("it has a headline", typeof result?.headline === "string" && result.headline.length > 0, result?.headline);
check("confident matches are never contaminated with weak ones",
  (result?.cheaperElsewhere ?? []).every((a: any) => a.confidence === "same"), result?.cheaperElsewhere);
check("quota was spent", r.body.quota?.remaining === 0, r.body.quota);

r = await call(token, "POST", "/sweep", { productId: product.id });
check("a second sweep on pro is refused", r.status === 429 && r.body.code === "SWEEP_QUOTA_EXHAUSTED", r.body);

console.log("\n— ultimate gets three —");
await prisma.wallet.update({ where: { userId }, data: { tier: "ultimate", sweepsUsedToday: 0 } });
r = await call(token, "GET", "/sweep/quota");
check("ultimate reports 3", r.body.quota?.limit === 3, r.body.quota);

console.log("\n— failures don't cost a sweep —");
await prisma.wallet.update({ where: { userId }, data: { sweepsUsedToday: 0 } });
r = await call(token, "POST", "/sweep", { productId: "does-not-exist" });
check("an unknown product 404s", r.status === 404, r.body);
r = await call(token, "GET", "/sweep/quota");
check("...and the allowance is untouched", r.body.quota?.used === 0, r.body.quota);

console.log("\n— auth —");
check("auth is required", (await call(null, "POST", "/sweep", { productId: product.id })).status === 401);

await prisma.priceHistory.deleteMany({ where: { productId: product.id } });
await prisma.product.delete({ where: { id: product.id } });
await prisma.wallet.deleteMany({ where: { userId } });
await prisma.user.deleteMany({ where: { id: userId } });
console.log(`\n${pass} passed, ${fail} failed  (cleaned up)`);
process.exit(fail ? 1 : 0);
