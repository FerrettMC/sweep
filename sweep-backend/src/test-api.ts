// src/test-api.ts
//
// End-to-end check of the tracking loop against a running server.
// Signs in as a real Supabase user, then exercises the endpoints the app uses:
//
//   npm run dev                     # in one terminal
//   npm run test:api                # in another
//
// Creates a throwaway account on each run unless TEST_EMAIL/TEST_PASSWORD are
// set. Skips Amazon by default so a test run costs no Bright Data quota.

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const API = process.env.TEST_API_URL ?? "http://localhost:3001";
const RETAILERS = process.env.TEST_RETAILERS ?? "walmart,bestbuy";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
);

let token = "";
let passed = 0;
let failed = 0;

async function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      // Only declare a JSON body when there is one — Fastify rejects
      // Content-Type: application/json with an empty body outright.
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
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

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.log(`  ❌ ${label}`);
    if (detail !== undefined) {
      console.log(`     ${JSON.stringify(detail).slice(0, 300)}`);
    }
  }
}

async function signIn() {
  const email = process.env.TEST_EMAIL ?? `sweep-test-${Date.now()}@example.com`;
  const password = process.env.TEST_PASSWORD ?? "sweep-test-password-123";

  const signedIn = await supabase.auth.signInWithPassword({ email, password });

  // First run for a generated address won't have an account yet.
  const data = signedIn.error
    ? await (async () => {
        const created = await supabase.auth.signUp({ email, password });
        if (created.error) throw new Error(`auth failed: ${created.error.message}`);
        return created.data;
      })()
    : signedIn.data;

  if (!data.session) {
    throw new Error(
      "No session returned. Email confirmation is probably ON in Supabase — " +
        "turn it off for local dev, or set TEST_EMAIL/TEST_PASSWORD to a confirmed account.",
    );
  }

  token = data.session.access_token;
  console.log(`Signed in as ${email}\n`);
  return email;
}

async function main() {
  const email = await signIn();

  console.log("— auth —");
  const sync = await call("POST", "/auth/sync-user", { email });
  check("sync-user creates the user + wallet", sync.status === 200, sync.body);

  console.log("\n— quota —");
  const quota = await call("GET", "/search/quota");
  check("quota is readable", quota.status === 200, quota.body);
  check(
    "free tier gets 1 search/day",
    quota.body?.quota?.limit === 1,
    quota.body,
  );

  console.log("\n— compiled search —");
  const search = await call("GET", `/search?q=airpods&retailers=${RETAILERS}`);
  check("search returns results", search.status === 200, search.body);

  const successful = (search.body?.results ?? []).filter(
    (r: any) => r.status === "success" && r.products.length > 0,
  );
  check(
    `at least one retailer returned products (${successful.length} did)`,
    successful.length > 0,
    search.body?.results?.map((r: any) => `${r.retailer}:${r.status}`),
  );
  check("search spent one from the quota", search.body?.quota?.used === 1, search.body?.quota);

  // Sanity-check the prices themselves. A tracker that records the list price
  // as the current price is worse than one that records nothing, and Walmart
  // ships two different payload shapes that make this easy to get wrong.
  const sample = successful.flatMap((r: any) => r.products);
  check(
    "every product has a positive price",
    sample.length > 0 && sample.every((p: any) => typeof p.price === "number" && p.price > 0),
    sample.map((p: any) => [p.title?.slice(0, 30), p.price]),
  );
  check(
    "no product's price exceeds its list price",
    sample.every((p: any) => p.listPrice === null || p.price <= p.listPrice),
    sample
      .filter((p: any) => p.listPrice !== null && p.price > p.listPrice)
      .map((p: any) => [p.title?.slice(0, 30), p.price, p.listPrice]),
  );

  console.log("\n— quota enforcement —");
  const second = await call("GET", `/search?q=laptop&retailers=walmart`);
  check(
    "second search is refused once the daily cap is hit",
    second.status === 429 && second.body?.code === "SEARCH_LIMIT_REACHED",
    second.body,
  );

  console.log("\n— tracking —");
  const first = sample[0];
  if (!first) {
    console.log("  ⏭️  no product to track, skipping the rest");
    return summary();
  }

  const track = await call("POST", "/products/track", {
    retailer: first.retailer,
    retailerId: first.retailerId,
  });
  check("track a product from search results", track.status === 201, track.body);

  const trackedId = track.body?.tracked?.id;
  const productId = track.body?.tracked?.product?.id;

  const again = await call("POST", "/products/track", {
    retailer: first.retailer,
    retailerId: first.retailerId,
  });
  check(
    "tracking the same product twice is idempotent",
    again.status === 201 && again.body?.tracked?.id === trackedId,
    again.body,
  );

  const list = await call("GET", "/products");
  check("tracked list contains it", list.body?.tracked?.length >= 1, list.body);
  check(
    "free tier cap is reported as 3",
    list.body?.limits?.maxTrackedProducts === 3,
    list.body?.limits,
  );

  console.log("\n— detail + history —");
  const detail = await call("GET", `/products/${productId}`);
  check("detail loads", detail.status === 200, detail.body);
  check(
    "history has a seeded point",
    (detail.body?.history?.length ?? 0) >= 1,
    detail.body?.history,
  );
  check(
    "stats are computed",
    detail.body?.stats?.average !== null,
    detail.body?.stats,
  );
  check(
    "free tier sees a 30-day window",
    detail.body?.historyWindow?.days === 30,
    detail.body?.historyWindow,
  );

  console.log("\n— tier enforcement —");
  const threshold = await call("PATCH", `/products/track/${trackedId}`, {
    customThreshold: 5000,
  });
  check(
    "custom thresholds are refused on the free tier",
    threshold.status === 403 && threshold.body?.code === "TIER_REQUIRED",
    threshold.body,
  );

  // A product checked seconds ago is served from the shared cache instead of
  // being re-scraped, and costs nothing from the manual-check budget.
  const refresh = await call("POST", `/products/${productId}/refresh`);
  check(
    "refresh right after tracking is served fresh, not re-scraped",
    refresh.status === 200 && refresh.body?.status === "fresh",
    refresh.body?.status,
  );
  check(
    "a fresh result doesn't spend a manual check",
    refresh.body?.manualChecks?.used === 0,
    refresh.body?.manualChecks,
  );
  check(
    "free tier reports 5 manual checks a day",
    refresh.body?.manualChecks?.limit === 5,
    refresh.body?.manualChecks,
  );

  console.log("\n— track limit —");
  // Fill the remaining free slots, then confirm the 4th is refused.
  const rest = sample.slice(1, 3);
  for (const product of rest) {
    await call("POST", "/products/track", {
      retailer: product.retailer,
      retailerId: product.retailerId,
    });
  }
  const overflow = sample[3];
  if (overflow) {
    const denied = await call("POST", "/products/track", {
      retailer: overflow.retailer,
      retailerId: overflow.retailerId,
    });
    check(
      "4th product is refused on the free tier",
      denied.status === 403 && denied.body?.code === "TRACK_LIMIT_REACHED",
      denied.body,
    );
  } else {
    console.log("  ⏭️  not enough search results to test the cap");
  }

  console.log("\n— untrack —");
  const untrack = await call("DELETE", `/products/track/${trackedId}`);
  check("untrack works", untrack.status === 200, untrack.body);

  const missing = await call("DELETE", `/products/track/${trackedId}`);
  check("untracking twice 404s", missing.status === 404, missing.body);

  console.log("\n— push registration —");
  const malformedPush = await call("POST", "/notifications/register", {
    token: "not-an-expo-token",
  });
  check(
    "a malformed push token is rejected",
    malformedPush.status === 400 &&
      malformedPush.body?.code === "INVALID_PUSH_TOKEN",
    malformedPush.body,
  );

  // Well-formed but not a real device. Registration only validates shape —
  // liveness is discovered at send time and the token is pruned then.
  const fakePushToken = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]";
  const register = await call("POST", "/notifications/register", {
    token: fakePushToken,
    platform: "android",
  });
  check("a well-formed push token registers", register.status === 200, register.body);

  const pushStatus = await call("GET", "/notifications/status");
  check(
    "status reports the device",
    pushStatus.body?.registered === true && pushStatus.body?.devices >= 1,
    pushStatus.body,
  );

  const reregister = await call("POST", "/notifications/register", {
    token: fakePushToken,
    platform: "android",
  });
  const afterRe = await call("GET", "/notifications/status");
  check(
    "re-registering the same token doesn't duplicate it",
    reregister.status === 200 && afterRe.body?.devices === pushStatus.body?.devices,
    afterRe.body,
  );

  const unregister = await call("DELETE", "/notifications/register", {
    token: fakePushToken,
  });
  check("unregister works", unregister.status === 200, unregister.body);

  console.log("\n— auth gate —");
  const savedToken = token;
  token = "";
  const anon = await call("GET", "/products");
  check("tracked list requires auth", anon.status === 401, anon.body);
  const badToken = await call("GET", "/products", undefined, {
    Authorization: "Bearer not-a-real-token",
  });
  check("a garbage token is rejected", badToken.status === 401, badToken.body);
  token = savedToken;

  summary();
}

function summary() {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("\n💥", err.message);
  process.exitCode = 1;
});
