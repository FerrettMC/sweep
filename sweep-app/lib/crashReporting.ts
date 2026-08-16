// lib/crashReporting.ts
//
// Crash and error reporting for the app itself.
//
// The backend has had Sentry since early on; the app has had nothing. That was
// survivable while the only user was the person writing it, and stops being
// survivable the moment the app is on phones we have never seen. Half the bugs
// found so far were device-specific layout problems — a button under a
// keyboard, a header behind a punch-hole camera — and those arrive as "it
// didn't work" unless something is watching.
//
// Off unless a DSN is configured, so development stays quiet and a build
// without credentials degrades to exactly today's behaviour rather than
// crashing on start-up.
//
// Note this is the third declaration that flips when it ships: Play's Data
// Safety form currently says we collect no crash logs, and that stops being
// true here. It has to be updated in the same release.

import * as Sentry from "@sentry/react-native";

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim();

export const CRASH_REPORTING_ENABLED = Boolean(DSN);

/**
 * Start reporting. Safe to call more than once; only the first takes effect.
 *
 * Deliberately conservative about what leaves the device — see `beforeSend`.
 */
export function startCrashReporting() {
  if (!DSN) return;

  Sentry.init({
    dsn: DSN,
    // Errors only. Performance tracing samples every navigation and costs
    // quota we have no use for while the question is "did it crash".
    tracesSampleRate: 0,
    // The backend learned this the hard way: Sentry's trace headers on
    // outgoing requests were enough for Walmart's bot detection to serve a
    // challenge page every single time. The app talks to our own API, but
    // there is no reason to attach them anywhere.
    tracePropagationTargets: [],
    // Breadcrumbs are the useful part of a crash report — what happened just
    // before. Console breadcrumbs can carry whatever a log statement held, so
    // they stay off.
    integrations: (defaults) =>
      defaults.filter((integration) => integration.name !== "Breadcrumbs"),
    beforeSend(event) {
      // Never ship anything that identifies a person. A crash report needs a
      // stack trace and a device, not who was holding it.
      delete event.user;
      if (event.request) delete event.request.headers;
      return event;
    },
    // Dev builds throw constantly while editing; that isn't signal.
    enabled: !__DEV__,
  });
}

/**
 * Report something we caught and handled.
 *
 * For failures worth knowing about that the user already saw a message for —
 * a sync that failed, a screen that couldn't load — where throwing would be
 * worse than continuing.
 */
export function reportError(error: unknown, context?: Record<string, unknown>) {
  if (!DSN) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
