// Sentry must be first — it instruments modules at import time, so anything
// loaded before it runs untraced.
import { Sentry } from "./instrument.js";

import "dotenv/config";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { GLOBAL_LIMIT, rateLimitKey } from "./lib/rateLimit.js";
import { getHealthReport } from "./lib/health.js";
import { startScheduler } from "./lib/scheduler.js";
import { authRoutes } from "./routes/auth.js";
import { dealRoutes } from "./routes/deals.js";
import { leaderboardRoutes } from "./routes/leaderboard.js";
import { videoMockRoutes } from "./routes/videoMock.js";
import { adminRoutes } from "./routes/admin.js";
import { cartRoutes } from "./routes/cart.js";
import { billingRoutes } from "./routes/billing.js";
import { landingRoutes } from "./routes/landing.js";
import { legalRoutes } from "./routes/legal.js";
import { budgetRoutes } from "./routes/budget.js";
import { listRoutes } from "./routes/lists.js";
import { sharePageRoutes } from "./routes/sharePage.js";
import { notificationRoutes } from "./routes/notifications.js";
import { productRoutes } from "./routes/products.js";
import { radarRoutes } from "./routes/radar.js";
import { searchRoutes } from "./routes/search.js";
import { lookupRoutes } from "./routes/lookup.js";
import { sweepRoutes } from "./routes/sweep.js";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
  },
  // Behind a platform load balancer in production, so the client IP arrives in
  // X-Forwarded-For. Without this every request looks like it came from the
  // proxy and rate limiting would throttle all users as one.
  trustProxy: process.env.NODE_ENV === "production",
  // Nothing we accept is large. The biggest body is a list name and a note.
  bodyLimit: 64 * 1024,
});

// Registered before the routes so it wraps all of them. Per-route overrides
// live on the routes that spend money — see lib/rateLimit.ts.
await app.register(rateLimit, {
  global: true,
  ...GLOBAL_LIMIT,
  // preHandler, not the default onRequest. The plugin appends its handler
  // AFTER a route's own preHandler, so by the time the key is computed
  // requireAuth has already set request.userId — which is the whole point.
  //
  // At onRequest the key is computed before auth runs, so every signed-in user
  // falls back to their IP and everyone behind one mobile carrier shares a
  // single bucket. That throttles real users and scales with nothing.
  //
  // The trade: a request that fails auth never reaches the limiter, so 401s
  // aren't counted. Acceptable here — there's no password endpoint to brute
  // force (Supabase handles sign-in directly), and a bad token costs one
  // upstream call.
  hook: "preHandler",
  keyGenerator: rateLimitKey,
  // The SSV callback is Google calling us on their schedule, not a user, and
  // its authenticity is proven by signature rather than by volume.
  allowList: (request) => request.url.startsWith("/ads/admob/ssv"),
  // Must return a real Error, not a plain object: the plugin THROWS whatever
  // this returns, and Fastify reads `statusCode` off an Error instance. Return
  // an object literal and a throttled client gets a 500 — so it reads the
  // refusal as a server fault and retries instead of backing off.
  errorResponseBuilder: (_request, context) => {
    const error = new Error(
      `Too many requests. Try again in ${Math.ceil(context.ttl / 1000)}s.`,
    ) as Error & { statusCode: number; code: string };
    error.statusCode = 429;
    error.code = "RATE_LIMITED";
    return error;
  },
});

/**
 * One shape for every error the API returns.
 *
 * Routes send `{ error, code }` explicitly, but a THROWN error would otherwise
 * be serialized by Fastify as `{ statusCode, error, message }` — where `error`
 * is the HTTP status text, not anything a user should read. The app parses
 * `error` as the message, so without this a rate-limit refusal reads as the
 * literal words "Too Many Requests".
 *
 * 5xx bodies are deliberately vague. Internal messages can name tables and
 * query fragments, and none of that belongs on a phone screen.
 */
app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, request, reply) => {
  const status = error.statusCode ?? 500;

  if (status >= 500) {
    Sentry.captureException(error);
    request.log.error({ err: error }, "unhandled route error");
  }

  reply.status(status).send({
    error: status >= 500 ? "Something went wrong. Try again." : error.message,
    // Only codes we set deliberately on 4xx replies are ours to expose. A 500
    // carries whatever the failing library used — Prisma's P2024, Postgres'
    // 23505 — and those mean nothing to a user while telling anyone else more
    // about our stack than they need.
    ...(error.code && status < 500 ? { code: error.code } : {}),
  });
});

app.register(adminRoutes);
app.register(videoMockRoutes);
app.register(authRoutes);
app.register(budgetRoutes);
app.register(dealRoutes);
app.register(leaderboardRoutes);
app.register(billingRoutes);
app.register(cartRoutes);
app.register(landingRoutes);
app.register(legalRoutes);
app.register(listRoutes);
app.register(sharePageRoutes);
app.register(notificationRoutes);
app.register(productRoutes);
app.register(radarRoutes);
app.register(lookupRoutes);
app.register(searchRoutes);
app.register(sweepRoutes);

app.get("/health", async () => {
  return { status: "ok" };
});

// Scraper health, for eyeballing which retailers are actually working without
// waiting for an alert email. Read-only and cheap — it reads the check log,
// it does not scrape anything.
app.get("/health/scrapers", async () => {
  return { retailers: await getHealthReport() };
});

// A background job that throws has no request to attach it to, so it would
// otherwise die in the logs. These two handlers are the safety net.
process.on("unhandledRejection", (reason) => {
  console.error("[fatal] unhandled rejection:", reason);
  Sentry.captureException(reason);
});

process.on("uncaughtException", (err) => {
  console.error("[fatal] uncaught exception:", err);
  Sentry.captureException(err);
  // Flush before exiting or the report never leaves the process.
  Sentry.flush(2000).finally(() => process.exit(1));
});

const port = Number(process.env.PORT ?? 3001);

app.listen({ port, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error(err);
    Sentry.captureException(err);
    process.exit(1);
  }
  console.log(`Server running at ${address}`);
  startScheduler();
});
