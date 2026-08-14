// src/instrument.ts
//
// Sentry initialisation. This file MUST be imported before anything else in
// index.ts — the SDK patches the modules it instruments (http, pg, fastify) at
// require time, so anything imported ahead of it goes untraced.
//
// Safe to run with no DSN: Sentry becomes a no-op rather than throwing, so a
// missing key degrades to "no error tracking" instead of breaking boot.

import "dotenv/config";
import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",

    // Performance sampling. Full rate in development is useful; in production
    // it's noise and quota, so sample down.
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

    // Never attach sentry-trace/baggage headers to outgoing requests.
    //
    // This is not a preference — it is load-bearing. Sentry's HTTP
    // instrumentation adds those headers to EVERY outbound request, including
    // the ones we make to retailers, and Walmart's bot detection treats them
    // as a fingerprint: with tracing headers attached, its search page returns
    // the "Robot or human?" interstitial 100% of the time. Measured 0/4 with
    // them and 4/4 without, back to back.
    //
    // We gain nothing by propagating traces to a third party we don't operate,
    // so the empty list costs us nothing and keeps the scrapers working.
    tracePropagationTargets: [],

    // Scrape failures are recorded in ScrapeCheck and alerted on by email —
    // they're expected operational events, not exceptions, and shipping them
    // to Sentry as well would bury real bugs under retailer flakiness.
    ignoreErrors: ["ScrapeHttpError", "BrightDataError"],

    beforeSend(event) {
      // Never let a product URL's query string carry tracking params into an
      // error report.
      if (event.request?.query_string) delete event.request.query_string;
      return event;
    },
  });

  console.log("[sentry] initialised");
} else {
  console.log("[sentry] SENTRY_DSN not set — error tracking disabled");
}

export { Sentry };
