# Sweep

Price tracking + shopping companion. Track products across five retailers, get
told when the price actually drops, and see who's really cheapest before you buy.

- `sweep-backend` — Node + Fastify + Prisma (Supabase Postgres)
- `sweep-app` — Expo / React Native, expo-router

## Running it

Two terminals.

```bash
# terminal 1 — backend
cd sweep-backend
npm install
npx prisma generate
npm run dev            # http://localhost:3001

# terminal 2 — app
cd sweep-app
npm install
npm run android        # also runs adb reverse for ports 8081 + 3001
```

`npm run android` sets up `adb reverse tcp:3001`, which is what makes
`localhost:3001` reach your machine from the phone. If you run the app another
way, set `EXPO_PUBLIC_API_URL` to your machine's LAN IP instead.

## Checking it works

```bash
cd sweep-backend

npm run test:scrapers              # live check of every retailer — free
npm run test:scrapers -- "airpods" # with your own search term

npm run test:api                   # end-to-end tracking loop, needs the server running
npm run test:paste                 # the paste-a-link flow, with messy real-world URLs
```

`test:scrapers` is the one to run when a retailer tile goes quiet. It tells you
whether a scraper broke because the page structure changed or because you're
being blocked — different problems with different fixes.

Avoid `test:amazon` unless you mean it: it spends Bright Data quota.

## Retailer status

| Retailer | Method | Status |
| --- | --- | --- |
| Walmart | `__NEXT_DATA__`, self-written | ✅ Working, free |
| Best Buy | Apollo SSR payload, self-written | ✅ Working, free (via search) |
| Amazon | Bright Data Scraper API | ✅ Working, metered |
| Target | RedSky API | ⛔ Blocked by PerimeterX |
| eBay | Official Buy Browse API | ⬜ Needs free API keys |

Target, Best Buy and eBay all have write-ups in
[`sweep-backend/docs/INTEGRATIONS.md`](sweep-backend/docs/INTEGRATIONS.md),
along with how to get every remaining credential.

**Best Buy does not serve product pages to datacenter IPs.** Measured from a
clean state with no other traffic: homepage 200 in 0.5s, search 200 in 2.0s,
any product page times out at 25s, every time. Searching the numeric SKU
doesn't help — that 308-redirects to the product page and inherits the hang.

So its adapter never fetches product pages. It recovers the product name from
the url slug, searches that, and matches the result by SKU/BSIN — ~2s, and it
fails rather than guessing if no confident match comes back. Nothing to fix if
you see this; it's the intended path.

## Adding something to track

Paste a product link on the **Tracking** tab. That's the primary path, and it
costs no search quota. The backend normalizes whatever you paste:

- missing scheme (`www.walmart.com/ip/…`)
- share and short links (`a.co/d/…`, `amzn.to/…`) — resolved by following redirects
- tracking params — stripped, so two people pasting the same item with
  different `utm_` junk land on **one** shared Product row rather than two

The **Search** tab is for comparison only — seeing who's cheapest before you
buy. It deliberately doesn't track, because a search costs real money (five
scrapes, one metered) and tracking shouldn't.

## How it fits together

**The shared cache is the core design decision.** There is one `Product` row
per unique item across the entire app. Ten users tracking the same TV means one
price check, not ten. Cost scales with distinct products tracked, not with
signups.

A product's check interval is the *shortest* interval among everyone tracking
it, so one Ultimate user's 30-minute cadence makes that item fresher for
everyone, at no extra cost.

**Health monitoring is not optional.** Every check — scheduled or from a search
— writes a `ScrapeCheck` row with its outcome. An hourly sweep alerts by email
when a retailer's failure rate crosses 50%, once per incident. The failure mode
this exists to prevent is a scraper quietly returning nothing while users see
stale prices.

**The server is the only source of truth** for tier caps, quotas, and history
windows. The client is told its limits so it can render them, never so it can
enforce them.

## Endpoints

```
GET    /health
GET    /health/scrapers          scraper failure rates per retailer

POST   /auth/sync-user           upsert Supabase user + wallet

POST   /notifications/register   register this device for price alerts
DELETE /notifications/register   deregister (called on sign-out)
GET    /notifications/status     are alerts actually reaching this account?

GET    /search?q=…               compiled multi-site search (guests allowed)
GET    /search/quota             searches remaining today
POST   /search/rewarded          +1 search for a watched ad  ⚠️ see below
GET    /search/retailers         which stores are currently working

GET    /products                 everything the user tracks
POST   /products/track           start tracking (url, or retailer + retailerId)
DELETE /products/track/:id       stop tracking
PATCH  /products/track/:id       custom alert threshold (Ultimate)
GET    /products/:id             detail + price history + stats
POST   /products/:id/refresh     force a re-check (rate-limited)
```

⚠️ `POST /search/rewarded` currently trusts the client's claim that an ad was
watched. That must move behind AdMob server-side verification before launch —
see INTEGRATIONS.md §5.

## What's built, what's next

**Done:** all five scrapers, compiled search, tracking, price history + chart,
the scheduler, health monitoring with email alerts (Resend), error tracking
(Sentry), tier caps, guest mode, and price-drop push notifications.

**Push needs three account steps from you** before it delivers — `eas init`,
Firebase, and a rebuild. All the code is written and tested; see
[INTEGRATIONS.md §4](sweep-backend/docs/INTEGRATIONS.md).

**Next pass:** XP + leaderboard, the Best Deals Found feed, the budget tracker,
shareable wishlists, and ads. The Deals and Budget tabs are placeholders today;
their data models already exist in the schema.
