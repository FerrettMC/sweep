# Sweep — third-party setup

Everything Sweep talks to, what it costs, and exactly how to get the keys.

The code for each of these is already written and wired. Each one reads its
config from the environment and degrades honestly when it's missing — a missing
key makes one feature unavailable with a clear message, it never crashes the
app. So you can add these one at a time, in any order.

**Status right now:**

| Integration      | Needed for                  | Status                   |
| ---------------- | --------------------------- | ------------------------ |
| Bright Data      | Amazon prices               | ✅ Configured            |
| Walmart scraper  | Walmart prices              | ✅ Working, free, no key |
| Best Buy scraper | Best Buy prices             | ✅ Working, free, no key |
| Target           | Target prices               | ⛔ Blocked — see below   |
| eBay Buy API     | eBay prices                 | ⬜ Needs keys            |
| SMTP (Resend)    | Scraper-failure alerts      | ✅ Configured            |
| Sentry           | Error tracking              | ✅ Configured            |
| AdMob            | Rewarded + interstitial ads | ⛔ Parked — Kotlin clash |
| Expo Push        | Price-drop notifications    | ⬜ Code done, needs EAS  |

---

## 1. eBay Buy API — free, do this one first

The cheapest win on the list: 5,000 calls/day, free forever, no card. It's the
one retailer with a real official API, and it's currently the only missing leg
of compiled search that's actually obtainable today.

1. Go to <https://developer.ebay.com/> and sign in with a normal eBay account.
2. Join the **eBay Developers Program** (free, instant).
3. Go to **My Account → Application Keysets**.
4. You'll see two environments — **Sandbox** and **Production**. You want
   **Production**. Sandbox returns fake listings with fake prices, which is
   worse than nothing for a price tracker.
5. Create a keyset. Copy two values:
   - **App ID (Client ID)** → `EBAY_CLIENT_ID`
   - **Cert ID (Client Secret)** → `EBAY_CLIENT_SECRET`
6. Put both in `sweep-backend/.env`.
7. Verify: `npm run test:scrapers` — eBay should stop saying "skipped" and
   start returning priced results.

No OAuth consent screen is involved. Sweep uses a client-credentials
(application) token, which is all the Browse API needs for public search.

**If you hit the rate limit later:** eBay has a free "Application Growth Check"
you can request to raise it. There's no scraping fallback here — ebay.com
answers a plain fetch with HTTP 403.

---

## 2. SMTP — ✅ done, via Resend

Working. A test alert was delivered successfully.

```
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASS=<resend api key>
SMTP_FROM=Sweep Alerts <onboarding@resend.dev>
ALERT_EMAIL=chester.t.ferret@gmail.com
```

Verified end to end: the alert path in `src/lib/health.ts` fires, Resend
accepts it, and the delivery status comes back `delivered`.

### The `from` address is the only thing that trips this up

Resend rejects any sender on a domain that isn't **registered and verified on
your account**. Two senders were tried and refused:

```
550 The gmail.com domain is not verified.          ← chester.t.ferret@gmail.com
550 The nflope.resend.app domain is not verified.  ← sweep@nflope.resend.app
```

The second is worth understanding: a `*.resend.app` address only works if that
subdomain is actually claimed on your account. Ask the API what you really have:

```bash
KEY=$(grep '^SMTP_PASS=' .env | cut -d= -f2-)
curl -s https://api.resend.com/domains \
  -H "Authorization: Bearer $KEY" -H "User-Agent: curl/8.5.0"
```

This account returns `{"object":"list","has_more":false,"data":[]}` — **zero
domains**. So `onboarding@resend.dev` is the only sender that can work right
now, and it's what's configured.

Its one limitation: it delivers **only to the address you signed up to Resend
with**. Fine for alerts to yourself, useless for emailing users later.

**To send from your own domain:** add it at <https://resend.com/domains>, add
the DNS records it gives you, wait for the status to read _Verified_, then set
`SMTP_FROM=alerts@yourdomain.com`. Re-run the curl above to confirm it shows
`status='verified'` before changing `.env` — that's faster than debugging a 550.

### Checking whether an alert actually arrived

SMTP returning `250` means accepted, not delivered. To see real delivery status:

```bash
KEY=$(grep '^SMTP_PASS=' .env | cut -d= -f2-)
curl -s "https://api.resend.com/emails?limit=5" \
  -H "Authorization: Bearer $KEY" -H "User-Agent: curl/8.5.0"
```

Look at `last_event` — `delivered`, `bounced`, or `complained`.

Alerts are deduped: one email per incident, plus at most one repeat every 6
hours while it stays broken. A flood of emails is as useless as no alert.

---

## 3. Sentry — ✅ done (backend)

Working. A test exception was delivered and appears in the dashboard.

Wired in `src/instrument.ts`, imported first in `src/index.ts`. **That import
order is load-bearing** — the SDK patches http/pg/fastify at import time, so
anything imported above it runs untraced. Don't let a formatter sort it into
the alphabetical block below.

What it's configured to do:

- Sample traces at 100% in dev, 10% in production.
- **Ignore `ScrapeHttpError` and `BrightDataError`.** Retailer flakiness is an
  expected operational event — it's already captured in `ScrapeCheck` and
  alerted on by email. Sending it to Sentry too would bury real bugs under
  Target being blocked every 15 minutes.
- Strip query strings from error reports, so product tracking params don't end
  up in your error log.
- Catch `unhandledRejection` / `uncaughtException`, which is how a background
  scheduler crash would otherwise vanish into the logs.

**Still to do — the mobile app.** Create a second Sentry project (React Native)
and run `npx @sentry/wizard@latest -i reactNative` from `sweep-app/`. It adds a
native module, so it needs `expo prebuild --clean` and a rebuild — worth
batching with the push-notification rebuild in §4 rather than doing twice.

---

## 4. Expo Push Notifications — free

**All the code is written and tested.** What's left is three account steps that
only you can do. Roughly 20 minutes, and Android-only is fine to start.

### What's already done

| Piece                                    | Where                            | Status                 |
| ---------------------------------------- | -------------------------------- | ---------------------- |
| `PushToken` table                        | `prisma/schema.prisma`           | ✅ pushed to Supabase  |
| Register / unregister / status endpoints | `src/routes/notifications.ts`    | ✅ tested              |
| Send + dead-token pruning                | `src/lib/push.ts`                | ✅ tested against Expo |
| Fires on price drops                     | `src/lib/scheduler.ts`           | ✅ wired               |
| Permission + token registration          | `sweep-app/lib/notifications.ts` | ✅                     |
| Tap notification → open product          | `sweep-app/app/_layout.tsx`      | ✅                     |
| Enable/disable UI                        | `sweep-app/app/profile.tsx`      | ✅                     |
| `expo-notifications` plugin + icon       | `sweep-app/app.json`             | ✅                     |

Until you finish the steps below, the app degrades cleanly: the Profile screen
shows "Price alerts: Off" and, if you tap Enable, tells you the EAS project id
is missing. Nothing crashes.

### Step 1 — Create the EAS project (5 min)

```bash
cd sweep-app
npx eas login       # create a free Expo account if you don't have one
npx eas init
```

`eas init` writes `extra.eas.projectId` into `app.json`. **That ID is the whole
point of this step** — `getExpoPushTokenAsync` cannot issue a token without it,
which is exactly the error you'd hit otherwise.

Verify it landed:

```bash
grep -A2 '"eas"' app.json
```

### Step 2 — Firebase, for Android delivery (10 min)

Expo's push service hands Android notifications to FCM, so this is required —
there's no way around it for Android.

1. Create a project at <https://console.firebase.google.com> (disable Analytics,
   you don't need it).
2. Add an **Android** app. The package name must be exactly:
   ```
   com.anonymous.sweep
   ```
   That's from `app.json` → `android.package`. A mismatch here fails silently
   at delivery time, which is a miserable thing to debug — copy it carefully.
3. Download **`google-services.json`** into `sweep-app/`, **and point app.json
   at it** — dropping the file in the folder does nothing on its own:
   ```json
   "android": {
     "package": "com.anonymous.sweep",
     "googleServicesFile": "./google-services.json"
   }
   ```
   Skipping this line is what produces _"Unable to get Firebase Messaging
   instance. Did you configure googleServicesFile path in app config?"_
4. In Firebase: **Project Settings → Service accounts → Generate new private
   key**. This downloads a JSON file. Keep it out of git.
5. Upload it to Expo:
   ```bash
   npx eas credentials
   ```
   Choose **Android** → **production** (or whichever profile you build) →
   **Google Service Account** → **Manage FCM V1 credentials** → upload the JSON
   from step 4.

### Step 3 — Rebuild (5 min, mostly waiting)

Adding a native module means a JS reload is not enough:

```bash
cd sweep-app
npx expo prebuild --clean     # regenerates android/ with the notifications plugin
npm run android
```

`--clean` matters here: your `android/` folder predates the `expo-notifications`
plugin and won't pick up the new manifest entries otherwise.

### Step 4 — Verify it actually works

1. Open the app on a **physical device** — emulators cannot receive remote push.
2. Sign in. Registration happens automatically right after account sync.
3. Go to **Profile** — "Price alerts" should read **On**.
4. Confirm the server sees the device:
   ```bash
   curl -s localhost:3001/notifications/status \
     -H "Authorization: Bearer <a real supabase access token>"
   # {"registered":true,"devices":1}
   ```
5. Force a real notification without waiting for a price to move — temporarily
   lower a tracked product's stored price so the next check reads as a drop:
   ```sql
   -- in npx prisma studio, or psql
   UPDATE "Product" SET "currentPrice" = "currentPrice" + 5000 WHERE id = '<product id>';
   ```
   Then hit `POST /products/<id>/refresh` from the app ("Check price now"). The
   real price now looks like a $50 drop and you should get a push within
   seconds.

### Things that will bite you

- **Emulators get nothing.** Physical device only.
- **A notification arriving with no icon / a grey square** means the build
  didn't pick up `notification-icon.png`. Re-run `expo prebuild --clean`.
- **Nothing arrives, no errors anywhere.** Almost always the Firebase package
  name not matching `com.anonymous.sweep`.
- **It worked, then stopped after a reinstall.** Expected — the old token is
  dead. The server prunes it automatically on the next send
  (`DeviceNotRegistered`), and the app registers the new one on next launch.
- **Don't test by reinstalling repeatedly** without reopening the app; you'll
  accumulate dead tokens until a send prunes them.

### Tuning the noise

In `src/lib/push.ts`:

- `MIN_DROP_PERCENT` (3%) and `MIN_DROP_CENTS` ($1) — a drop must clear one of
  these, so a one-cent flutter never buzzes a phone.
- `NOTIFY_COOLDOWN_HOURS` (12) — at most one alert per product per user per
  half-day.
- Ultimate's custom threshold **replaces** these rules rather than stacking with
  them: someone who asked to hear about "$X" gets told at $X, full stop.

### iOS, when you get there

Needs an Apple Developer account ($99/yr). Once enrolled, `npx eas credentials`
handles the APNs key. No code changes — `lib/notifications.ts` already branches
on platform.

---

## 5. AdMob — ⛔ BLOCKED on a toolchain conflict, parked

**Don't reinstall the package until you've dealt with the Kotlin mismatch
below.** It fails the Android build immediately.

### What happened

`react-native-google-mobile-ads@16.4.0` pulls in `play-services-ads:25.4.0`,
which Google compiled with **Kotlin 2.3.0** metadata. Expo SDK 57 / RN 0.86
compiles with **Kotlin 2.1.0**, so the build dies at
`:react-native-google-mobile-ads:compileDebugKotlin` with dozens of:

```
e: play-services-ads-25.4.0-api.jar!/META-INF/....kotlin_module
   Module was compiled with an incompatible version of Kotlin.
   The binary version of its metadata is 2.3.0, expected version is 2.1.0.
```

Nothing to do with our integration — the ads SDK is simply newer than the
toolchain can read.

### Two ways out, when you come back to it

1. **Pin an older ads SDK** (least disruptive). `react-native-google-mobile-ads`
   lets you override the native dependency version; a `play-services-ads` 24.x
   release built against Kotlin ≤ 2.1 should compile as-is.
2. **Raise the project's Kotlin version** with `expo-build-properties`
   (`android.kotlinVersion`). Cleaner long-term, but it changes the toolchain
   for every native module in the app, so expect to retest the whole build.

Also worth simply waiting — Expo bumping its Kotlin baseline would resolve this
with no work on your side.

### What survived

**The backend half is done, tested, and has no native dependency:**

| Piece | Where | Status |
| --- | --- | --- |
| SSV signature verification | `src/lib/admobSsv.ts` | ✅ 7/7 crypto tests |
| `GET /ads/admob/ssv` callback | `src/routes/search.ts` | ✅ |
| Replay protection | `AdReward.transactionId` unique | ✅ pushed |
| Production lockout of the client path | `POST /search/rewarded` | ✅ 403 verified |

Verified: a correctly signed callback is accepted, while a tampered `user_id`,
a forged signature, a missing signature and an unknown `key_id` are all
rejected. With `NODE_ENV=production` the client reward endpoint returns 403
`SSV_REQUIRED` even for a fully authenticated user — so **the "anyone can mint
free searches" hole is already closed**, ads or no ads.

`sweep-app/lib/ads.ts` is a stub with the real module's exact API. Re-enabling
is: reinstall the package, restore the real implementation, add the config
plugin back to `app.json`. Nothing else in the app changes.

Until then the "+1 search" flow still works in development via the dev-only
endpoint, so the mechanic is testable.

### Remaining account setup, for whenever ads resume

1. Sign up at <https://admob.google.com>, add the app (choose "not published
   yet" — you still get an App ID), create a **Rewarded** and an
   **Interstitial** unit.
2. Set the rewarded unit's server-side verification URL to
   `https://<deployed-backend>/ads/admob/ssv`. This needs a **public** URL, so
   it has to wait for a deploy — `localhost` won't work.
3. Put the app IDs in `app.json` and the unit IDs in
   `EXPO_PUBLIC_ADMOB_REWARDED_UNIT_ID` / `EXPO_PUBLIC_ADMOB_INTERSTITIAL_UNIT_ID`.

**Never point real ad units at your own device.** Viewing or tapping your own
live ads is invalid traffic and gets AdMob accounts suspended.

---

## 6. Target — currently blocked

Target is implemented (`src/lib/scrapers/target.ts`) but does not work, and it's
worth knowing exactly why before spending time on it.

Target is **not** like Walmart, despite both being Next.js sites. Their
`__NEXT_DATA__` contains only `{ statusCode, pageContentQuerySSRPreloadVars }`
— no product data at all. The grid is fetched client-side from **RedSky**,
their internal API.

Calling RedSky directly is the only real path, and the code does that,
including scraping their public web API key out of the page at runtime so a key
rotation heals itself. What stops it is **PerimeterX**: RedSky answers
datacenter IPs with HTTP 403 and a captcha body.

```json
{ "captchaRelativeURL": "/captcha?trackingId=..." }
```

Railway and Render are datacenter IPs too, so this will not fix itself in
production. Options, cheapest first:

1. **Ship without Target.** Four of five retailers work. The tile shows
   "This store is blocking us right now" and the app is honest about it.
2. **Bright Data has a Target dataset.** You already have an account and a
   working integration pattern for Amazon — this is the least new work, and it
   spends from the same 5,000/month free tier.
3. **A residential proxy in front of just this scraper** (Bright Data, Oxylabs,
   Smartproxy). Effective, and the most expensive per request.

The moment requests stop being challenged, the existing code starts returning
data with no rewrite.

---

## 7. Bright Data — already configured

Amazon only. Already working, keys already in `.env`.

What to keep an eye on: the free tier is **5,000 records/month**, and every
compiled search spends one Amazon record per result returned. The scheduler
treats Amazon as `metered` and checks it at concurrency 1, but the ceiling is
real.

Your doc's scale trigger still stands: once you consistently exceed
5,000/month, move to amazonscraperapi.com (~$19/mo for 27,000 requests,
~$0.70/1k) and fund it from subscription revenue rather than pre-revenue. Note
Bright Data's own pay-as-you-go rate after the free tier is $1.50/1,000 — don't
conflate the two.

---

## Full environment variable reference

```bash
# --- Database (set) ---
DATABASE_URL=            # Supabase pooled connection
DIRECT_URL=              # Supabase direct connection, for migrations

# --- Supabase auth (set) ---
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SECRET_KEY=

# --- Amazon via Bright Data (set) ---
BRIGHTDATA_API_KEY=
BRIGHTDATA_AMAZON_DATASET_ID=
BRIGHTDATA_AMAZON_SEARCH_DATASET_ID=

# --- eBay Buy API (needed — see §1) ---
EBAY_CLIENT_ID=
EBAY_CLIENT_SECRET=

# --- Scraper health alerts (set) ---
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASS=
SMTP_FROM=Sweep Alerts <onboarding@resend.dev>
ALERT_EMAIL=

# --- Error tracking (set) ---
SENTRY_DSN=

# --- Push notifications (optional) ---
# Only needed if you turn on enhanced push security in your Expo account.
# Sending to Expo push tokens works without it.
EXPO_ACCESS_TOKEN=

# --- Optional ---
PORT=3001                # defaults to 3001
LOG_LEVEL=info
SCHEDULER_ENABLED=true   # set false on all but one instance if you ever scale out
```

The app side needs `EXPO_PUBLIC_API_URL` once the backend isn't on localhost.
