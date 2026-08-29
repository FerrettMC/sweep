# Sweep

Search several stores at once, track what you're waiting on, and find out
whether a sale is actually a sale.

- `sweep-backend` — Node + Fastify + Prisma (Supabase Postgres), on Railway
- `sweep-app` — Expo SDK 57 / React Native, expo-router

Live at [sweepshopping.com](https://sweepshopping.com) · API at
`api.sweepshopping.com` · Android app in closed testing.

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

**Tests write to a real Supabase project**, so `sweep-backend/.env.test` must
point at the dev one. `src/testEnv.ts` refuses to run if it sees production —
that guard exists because the failure it prevents is deleting real users.

## Checking it works

```bash
cd sweep-backend

npm run test:scrapers              # live check of every retailer
npm run test:scrapers -- "airpods" # with your own search term
npm run test:api                   # end-to-end tracking loop, needs the server running
npm run test:paste                 # the paste-a-link flow, with messy real-world URLs
npm run test:promo                 # promo codes, including the redemption race
npm run test:landing               # the public site renders and says true things
npm run test:discount              # inflated-MSRP handling
```

`test:scrapers` is the one to run when a retailer tile goes quiet. It tells you
whether a scraper broke because the page structure changed or because you're
being blocked — different problems with different fixes.

**Avoid `test:amazon` and anything touching Walmart unless you mean it.** Both
spend real provider quota.

## Retailers

| Retailer | How | Cost | Status |
| --- | --- | --- | --- |
| Amazon | Bright Data Scraper API | **Metered** — per record | Live |
| Walmart | `__NEXT_DATA__` via Decodo | **Metered** — per request | Live |
| eBay | Official Buy Browse API | Free, 5k calls/day | Live |
| Etsy | Official Open API v3 | Free, plain API key | Live |
| Best Buy | Apollo SSR payload, self-written | Free | Off — waiting on their API key |
| Newegg | Inline JSON blob, self-written | Free | Off — blocked from datacenter IPs |
| ASOS | Inline JSON island, self-written | Free | Off — blocked from datacenter IPs |

Stores are switched on and off with the `DISABLED_RETAILERS` environment
variable, not in code, so a store can be pulled without a deploy and without an
app release — the app reads the live list from `/search/retailers`.

**Nothing here is free except eBay and Etsy.** Walmart looked free for a while
and isn't: our datacenter IP is refused outright, so every fetch goes through
Decodo and is billed. Newegg and ASOS are the same story without the proxy —
both work perfectly from a home IP and both failed on deploy. That difference
has now caused three separate re-investigations, so it's written up properly in
[ROADMAP.md](ROADMAP.md).

**One retailer per proxy account** while on free credits. Decodo serves Walmart
and nothing else joins it: 2,000 requests split two ways burns twice as fast and
takes the working store down when they run out.

## Adding something to track

Paste a product link on the **Tracking** tab. That's the primary path, and it
costs no search quota. The backend normalizes whatever you paste:

- missing scheme (`www.walmart.com/ip/…`)
- share and short links (`a.co/d/…`, `amzn.to/…`) — resolved by following redirects
- tracking params — stripped, so two people pasting the same item with
  different `utm_` junk land on **one** shared Product row rather than two

The **Search** tab is for comparison. It doesn't track anything by itself,
because a search costs real money and tracking shouldn't.

## How it fits together

**The shared cache is the core design decision.** There is one `Product` row per
unique item across the entire app. Ten users tracking the same TV means one price
check, not ten. Cost scales with distinct products tracked, not with signups.

A product's check interval is the *shortest* interval among everyone tracking it,
so one Ultimate user's cadence makes that item fresher for everyone at no extra
cost.

**Search results are cached by keyword**, not by price — the match set is stored
and prices are read live from the Product rows, so a cached search is never a
stale price. Metered retailers hold for 3 hours, free ones for 45 minutes.

**Health monitoring is not optional.** Every check writes a `ScrapeCheck` row
with its outcome. An hourly sweep alerts by email when a retailer's failure rate
crosses 50%, once per incident. The failure mode this exists to prevent is a
scraper quietly returning nothing while users see stale prices.

**The server is the only source of truth** for tier caps, quotas and history
windows. The client is told its limits so it can render them, never so it can
enforce them.

**A new app must survive an old server, and an old app a new one.** Response
fields are added as optional and never removed or repurposed; see the header of
`sweep-app/lib/api.ts`.

## Tiers

Set in `sweep-backend/src/lib/tiers.ts`, which is the only place they exist.

| | Free | Pro | Ultimate |
| --- | --- | --- | --- |
| Searches / day | 10 | 75 | 400 |
| Product lookups / day | 12 | 30 | 100 |
| Tracked products | 3 | 20 | 100 |
| Price history | 30 days | 90 days | All |
| Check interval | 2 fixed times | 4 hours | 1 hour |
| Ads | Rewarded only | — | — |

Guests get 3 lookups and 2 searches a day without an account.

Stores are **not** gated by tier. Everyone compares the same retailers; tiers buy
limits and frequency.

## Endpoints

```
GET    /                         landing page          GET  /privacy
GET    /health                                         GET  /delete-account
GET    /health/scrapers          failure rates per retailer

POST   /auth/sync-user           upsert Supabase user + wallet
GET    /auth/me

GET    /search?q=…               compiled multi-store search (guests allowed)
POST   /search/start             async search, returns a job id
GET    /search/job/:id           poll a running search
GET    /search/quota             searches remaining today
GET    /search/retailers         which stores are live, and how slow
POST   /search/rewarded          +1 search — dev only, see below
GET    /ads/admob/ssv            AdMob server-side verification callback

POST   /lookup                   one enriched product page
GET    /lookup/quota

GET    /products                 everything the user tracks
POST   /products/track           start tracking (url, or retailer + retailerId)
DELETE /products/track/:id       stop tracking
PATCH  /products/track/:id       custom alert threshold (Ultimate)
GET    /products/:id             detail + price history + stats
POST   /products/:id/refresh     force a re-check (rate-limited)
POST   /products/preview         resolve a pasted link without tracking it

GET    /cart  POST /cart  PATCH /cart/:id  DELETE /cart/:id
GET    /lists POST /lists        shareable wishlists with live prices
GET    /radar POST /radar        keep hunting a product at a target price
POST   /budget                   GET /budget/export.csv
GET    /deals                    GET /leaderboard   GET /me/xp

GET    /notifications            the bell feed
POST   /notifications/register   register this device for price alerts
GET    /notifications/status     are alerts actually reaching this account?

POST   /promo/redeem             redeem a code
GET    /promo/status             what grant is active

GET    /admin                    one-page portal, ADMIN_API_KEY in a header
GET    /admin/stats              usage, cost and retailer health
GET/POST/DELETE /admin/promo     create, list and delete codes

POST   /webhooks/revenuecat      subscription events
```

`POST /search/rewarded` is a **development-only** shortcut. In production the
only thing that grants a bonus search is `GET /ads/admob/ssv`, Google's
server-side verification callback — the client claiming it watched an ad is not
evidence, and a search costs real money.

## Where things stand

**Shipping:** multi-store search, product lookup with reviews and price history,
tracking with push alerts, Deal Radar, lists, cart, budget, XP and leaderboard,
promo codes, guest mode, and an admin portal.

**Waiting on other people, not on code:**

- **Best Buy** — adapter written, needs their developer API key. Three contacts
  since 15 Aug and no record kept on their end; see `BESTBUY-EMAIL.md`.
- **AdMob** — integrated and server-verified, but the account isn't approved,
  and AdMob generally won't approve an app that isn't publicly listed. Set
  `REWARDED_ADS_ENABLED=false` until it is, which hides the button without a
  release.
- **Walmart affiliate API** — two unanswered emails. Would make Walmart free.

Everything argued about, tried, or ruled out lives in [ROADMAP.md](ROADMAP.md) —
including which retailers a plain scraper can reach, why residential bandwidth
was rejected on price, and how inflated list prices are handled.
