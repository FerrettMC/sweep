// src/test-paste.ts
//
// Exercises the paste-a-link tracking flow against a running server, using the
// messy URL shapes people actually paste rather than clean canonical ones.
//
//   npm run dev          # in one terminal
//   npm run test:paste   # in another
//
// Uses Walmart and Best Buy only, so a run costs no Bright Data quota.

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { createTestUser, purgeTestUser } from "./testCleanup.js";

const API = process.env.TEST_API_URL ?? "http://localhost:3001";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
);

let token = "";
// Remembered so the run can delete the account it created — otherwise
// every suite run leaves a Supabase auth record behind forever.
let createdUserId: string | null = null;
let passed = 0;
let failed = 0;

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body: json };
}

function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.log(`  ❌ ${label}`);
    if (detail !== undefined) console.log(`     ${JSON.stringify(detail).slice(0, 260)}`);
  }
}

async function signIn() {
  // Created pre-confirmed through the admin API. Plain signUp would try to
  // email an @example.com address, which can't receive, and email confirmation
  // is now on for real users.
  const user = await createTestUser("paste", API);
  token = user.token;
  createdUserId = user.id;
  console.log(`Signed in as ${user.email}\n`);
}

async function main() {
  await signIn();

  console.log("— links people actually paste —");

  // Canonical.
  const clean = await call("POST", "/products/track", {
    url: "https://www.walmart.com/ip/Apple-AirPods-4/11381374703",
  });
  check("a clean Walmart link tracks", clean.status === 201, clean.body);
  const firstId = clean.body?.tracked?.id;
  const productId = clean.body?.tracked?.product?.id;
  if (clean.status === 201) {
    const p = clean.body.tracked.product;
    console.log(`     → ${p.title?.slice(0, 46)} @ $${(p.price / 100).toFixed(2)}`);
  }

  // Same item, tracking junk attached. Must resolve to the SAME product row —
  // otherwise the shared cache splits and we scrape the same item twice.
  const dirty = await call("POST", "/products/track", {
    url: "https://www.walmart.com/ip/Apple-AirPods-4/11381374703?classType=REGULAR&athbdg=L1103&utm_source=share",
  });
  check(
    "the same link with tracking params is deduped, not double-tracked",
    dirty.status === 201 && dirty.body?.tracked?.id === firstId,
    { got: dirty.body?.tracked?.id, expected: firstId },
  );

  // No scheme — what you get copying from an address bar. Uses Walmart:
  // Best Buy rate-limits on cumulative volume, so leaning on it in a test
  // loop measures our own hammering rather than whether the code works.
  const noScheme = await call("POST", "/products/track", {
    url: "www.walmart.com/ip/Apple-AirPods-4-with-Active-Noise-Cancellation/11384707978",
  });
  check("a link with no https:// still works", noScheme.status === 201, noScheme.body);
  if (noScheme.status === 201) {
    const p = noScheme.body.tracked.product;
    console.log(`     → ${p.title?.slice(0, 46)} @ $${(p.price / 100).toFixed(2)}`);
  }

  // Whitespace, as pasted from a share sheet.
  const padded = await call("POST", "/products/track", {
    url: "  https://www.walmart.com/ip/Apple-AirPods-4/11381374703  ",
  });
  check("surrounding whitespace is tolerated", padded.status === 201, padded.body);

  console.log("\n— links that should be refused —");

  const unsupported = await call("POST", "/products/track", {
    url: "https://www.costco.com/some-product.html",
  });
  check(
    "an unsupported store is refused with a useful message",
    unsupported.status === 400 && unsupported.body?.code === "UNSUPPORTED_RETAILER",
    unsupported.body,
  );

  const garbage = await call("POST", "/products/track", { url: "hello world" });
  check(
    "non-link text is refused",
    garbage.status === 400 && garbage.body?.code === "INVALID_URL",
    garbage.body,
  );

  const empty = await call("POST", "/products/track", { url: "   " });
  check("an empty link is refused", empty.status === 400, empty.body);

  console.log("\n— the tracked product is real —");
  if (productId) {
    const detail = await call("GET", `/products/${productId}`);
    check("detail loads for a pasted product", detail.status === 200, detail.body);
    check(
      "it has a price and a history point",
      detail.body?.product?.price > 0 && detail.body?.history?.length >= 1,
      { price: detail.body?.product?.price, points: detail.body?.history?.length },
    );
  }

  const list = await call("GET", "/products");
  check(
    "exactly 2 distinct products tracked from 4 paste attempts",
    list.body?.tracked?.length === 2,
    list.body?.tracked?.map((t: any) => t.product.title?.slice(0, 30)),
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (createdUserId) {
    await purgeTestUser(createdUserId);
    console.log("(cleaned up)");
  }
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("\n💥", err.message);
  process.exitCode = 1;
});
