# Before free time disappears

Written for a period of **school plus five nights a week** — so the filter is
"what breaks badly if nobody looks at it for a fortnight", not "what would be
nice to build".

The app is done. Nothing on this list is a feature.

---

## 1. ~~Turn on failure alerts~~ — done, the Railway vars are set

The backend already runs a health sweep every hour and knows when a retailer
starts failing. Right now, if SMTP isn't set on Railway, that alert goes to
`console.error` — which nobody reads. So a scraper breaking at 9am on a
Tuesday is discovered by a user complaining, or never.

**Set these on Railway** (the Resend credentials already exist):

| Variable      | Value                       |
| ------------- | --------------------------- |
| `SMTP_HOST`   | `smtp.resend.com`           |
| `SMTP_PORT`   | `465`                       |
| `SMTP_USER`   | `resend`                    |
| `SMTP_PASS`   | a Resend API key            |
| `SMTP_FROM`   | `noreply@sweepshopping.com` |
| `ALERT_EMAIL` | `support@sweepshopping.com` |

That single change is the difference between finding out a store broke from an
email and finding out from a one-star review.

**Verify it**: `sweep-backend/src/lib/health.ts` sends on the hour when a
retailer's failure rate spikes. Easiest confirmation is to check nothing is
logging `ALERT (SMTP not configured)` in the Railway logs.

## 2. Check Sentry is actually receiving — 2 minutes

Both halves are wired (`sweep-app` via `@sentry/react-native`, backend via
`src/instrument.ts`). Worth opening the Sentry dashboard once to confirm events
are arriving from the **released** build, not just from development. Crash
reporting that was never verified is crash reporting you don't have.

## 3. Nothing else in code

Seriously. The remaining roadmap items — Walmart, Best Buy, ads — are all
**waiting on other people**, not on work:

- **Walmart**: emailed, awaiting reply
- **Best Buy**: applied, awaiting reply
- **AdMob**: account under review, needs a public listing first

When any of them answers, each is a small, well-documented change. None needs a
free weekend.

---

## What's actually worth the time you have

**Making videos is the right call**, and not just because it's fun:

- It's the only work here that can't break production
- It's asynchronous — fifteen minutes at a time, no flow state needed
- The app is finished enough to demo honestly
- **It's the bottleneck.** Sweep has no users problem that more features fix;
  it has a nobody-knows-it-exists problem.

The strongest single video is already identified in `SELLINGPOINTS.md`: a store
showing "40% off" next to Sweep's own price history proving it's been that
price for a month. Fifteen seconds, visual, and it's the one claim no
competitor can copy.

Second best is the "why are features limited?" page — an app explaining its own
costs is unusual enough to travel on its own.

---

## The one thing to avoid

**Don't start a feature you can't finish in one sitting.** Half-built work
across a long gap is worse than none: you lose the context that made it make
sense, and the next session starts by re-reading your own code instead of
shipping.

If a genuinely good idea turns up, write it in `ROADMAP.md` and leave it there.
That file has been right about what mattered every time so far.

We should be all done with features till after launch
