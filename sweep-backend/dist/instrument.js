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
        // Scrape failures are recorded in ScrapeCheck and alerted on by email —
        // they're expected operational events, not exceptions, and shipping them
        // to Sentry as well would bury real bugs under retailer flakiness.
        ignoreErrors: ["ScrapeHttpError", "BrightDataError"],
        beforeSend(event) {
            // Never let a product URL's query string carry tracking params into an
            // error report.
            if (event.request?.query_string)
                delete event.request.query_string;
            return event;
        },
    });
    console.log("[sentry] initialised");
}
else {
    console.log("[sentry] SENTRY_DSN not set — error tracking disabled");
}
export { Sentry };
