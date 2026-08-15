# Deploying the Sweep backend

Written for Railway, because the scheduler rules out most free tiers: Sweep
needs a process that is always running, and anything that sleeps on inactivity
stops checking prices. Expect roughly $5/month.

Render, Fly and a plain VPS all work too. The settings below are what matter
anywhere; only the UI differs.

---

## 1. Create the service

1. Sign in at [railway.com](https://railway.com) with GitHub.
2. **New Project → Deploy from GitHub repo → `FerrettMC/sweep`**.
3. Open the service → **Settings → Source → Root Directory → `/sweep-backend`**,
   and save it before deploying.

The build uses `sweep-backend/Dockerfile`, so Root Directory is what makes the
build context this folder. Two failure modes to recognise, because both happened:

- *"Railpack could not determine how to build the app"*, listing `sweep-app/`
  and `sweep-backend/` — the Root Directory hadn't saved, so it was inspecting
  the repo root. Save it, then redeploy.
- *`"/sweep-backend/src": not found`* — the opposite: Root Directory applied, so
  the context is already `sweep-backend/`, and a `COPY sweep-backend/...` path
  is one level too deep. Paths in the Dockerfile are relative to this folder.

## 2. Environment variables

**Settings → Variables.** Copy these from your local `.env`:

```
DATABASE_URL          the pooler URL, port 6543, with ?pgbouncer=true
DIRECT_URL            port 5432 — migrations cannot run through the pooler
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SECRET_KEY   service role; only used by account deletion
BRIGHTDATA_API_KEY
BRIGHTDATA_AMAZON_DATASET_ID
BRIGHTDATA_AMAZON_SEARCH_DATASET_ID
EBAY_CLIENT_ID
EBAY_CLIENT_SECRET
SENTRY_DSN
SMTP_USER
SMTP_FROM
ALERT_EMAIL
```

And set these fresh:

```
NODE_ENV=production
SUPPORT_EMAIL=support@sweepshopping.com
SCHEDULER_ENABLED=true
LOG_LEVEL=info
```

`NODE_ENV=production` is load-bearing, not cosmetic. It turns on `trustProxy`,
without which every request appears to come from Railway's load balancer and
rate limiting throttles all users as a single key.

Do **not** set `PORT`. Railway injects it; the app already reads it.

## 3. Get the URL

**Settings → Networking → Generate Domain.** You get something like
`sweep-production.up.railway.app`. That's your public HTTPS URL — no domain
purchase needed.

Check it works:

```
https://<your-url>/health          -> {"status":"ok"}
https://<your-url>/privacy         -> the policy, with the right support email
https://<your-url>/delete-account  -> the deletion page
```

## 4. Point the app at it

In `sweep-app/.env`:

```
EXPO_PUBLIC_API_URL=https://<your-url>
```

Then rebuild. Without this a release build still talks to `localhost:3001` and
fails on every device that isn't the one you developed on.

## 5. The thing to actually watch: retailer blocking

Four of the six stores are scraped directly from whatever IP the host has, and
datacenter ranges get blocked far more aggressively than home connections.
Amazon (via Bright Data) and eBay (official API) are insulated; Walmart, Best
Buy, Newegg and ASOS are not.

Run one compiled search from the app, then open:

```
https://<your-url>/search/retailers
```

It reports each store's live success rate from the health log. If a store is
failing from the host but works locally, that's an IP problem, not a code one.

Options if it happens, cheapest first:

- Retry from a different region — Railway lets you change it.
- Increase `minIntervalMs` for that retailer in `lib/scrapers/index.ts`. The
  current values were tuned from a home connection and are a starting point.
- Route it through Bright Data, the way Amazon already is. Costs per request,
  but the shared product cache keeps volume low.
- Ship without it. `storeListPhrase()` generates every user-facing store list,
  so removing one is a config change with no copy to rewrite.

## 6. After it's up

- **Rotate every secret**, then update the variables here. All of them have
  been on a developer machine and in terminal scrollback.
- Add the privacy and deletion URLs to the Play Store listing and the Data
  Safety form.
- Watch the first scheduler run in the logs — `[scheduler] checking N products`
  roughly every five minutes.

## Scaling note

`numReplicas` is pinned to 1 on purpose. Two instances would both run the
scheduler, so every price drop would send two notifications and every retailer
would get double the traffic. Before scaling out, the scheduler needs a lease
and the rate-limit store and search jobs need to move to Redis.
