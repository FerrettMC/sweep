// Sentry must be first — it instruments modules at import time, so anything
// loaded before it runs untraced.
import { Sentry } from "./instrument.js";

import "dotenv/config";
import Fastify from "fastify";
import { getHealthReport } from "./lib/health.js";
import { startScheduler } from "./lib/scheduler.js";
import { authRoutes } from "./routes/auth.js";
import { dealRoutes } from "./routes/deals.js";
import { leaderboardRoutes } from "./routes/leaderboard.js";
import { budgetRoutes } from "./routes/budget.js";
import { listRoutes } from "./routes/lists.js";
import { sharePageRoutes } from "./routes/sharePage.js";
import { notificationRoutes } from "./routes/notifications.js";
import { productRoutes } from "./routes/products.js";
import { radarRoutes } from "./routes/radar.js";
import { searchRoutes } from "./routes/search.js";
import { sweepRoutes } from "./routes/sweep.js";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
  },
});

// Routes any unhandled route error into Sentry with request context attached.
Sentry.setupFastifyErrorHandler(app);

app.register(authRoutes);
app.register(budgetRoutes);
app.register(dealRoutes);
app.register(leaderboardRoutes);
app.register(listRoutes);
app.register(sharePageRoutes);
app.register(notificationRoutes);
app.register(productRoutes);
app.register(radarRoutes);
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
