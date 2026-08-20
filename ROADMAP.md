# Sweep — next release

Rewritten from the 2am notes, with what we worked out since. Ordered roughly by
what I'd do first, not by size.

Struck-through and SHIPPED items are done. They're kept rather than deleted
because the reasoning is the useful part — several of them turned out to be
wrong in an interesting way, and a list that only records what's left invites
re-deriving the same wrong answer twice.

---

## Product lookup — SHIPPED

Replaced "Sweep this deal" entirely. Paste a link, or tap Details on anything
searched or tracked, and get one page about that product.

**What each store actually returns**, verified against live payloads rather
than assumed — this was the open question and it's now closed:

| Store  | What it gives                                                                                                                                                                                               |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Amazon | Its own review summary, keywords split positive/negative/mixed, per-topic sentiment with buyer quotes, review photos, spec table, features, trust badges, `frequently returned` flag, **and coupon fields** |
| eBay   | Seller feedback % and score, shipping cost, delivery window, condition, specs                                                                                                                               |
| Etsy   | Listing detail, tags, materials; per-listing reviews, often absent                                                                                                                                          |

Amazon is far richer than the old note assumed. eBay has no product reviews at
all — it rates sellers, not products — and that is not a gap to fill: showing
99.3% seller feedback under a "reviews" heading would let someone compare it
against Amazon's 4.6 stars as though they measured the same thing.

**Two traps found in the real data, both now guarded:**

- Amazon's `mentions_count` reads **5** alongside **4497** positive mentions,
  so it is not a total. Any percentage built on it would be fiction, so it
  isn't carried through the type at all. Counts are shown as counts.
- A missing shipping cost is not free shipping. Zero and null are different
  claims and are worded differently.

**Coverage is declared per store**, not inferred from nulls, so the page can
tell "this store never returns reviews" from "this listing has none" — they get
different wording, and a thin page reads as a limit of the store rather than a
bug in the app.

**Limits** — its own counter, not shared with search:

| Tier     | Lookups/day |
| -------- | ----------- |
| Guest    | 3           |
| Free     | 12          |
| Pro      | 30          |
| Ultimate | 100         |

**Both follow-ups are done:** price history is a line now, and onboarding has a
lookup slide that absorbed the old "judge it".

---

## Quick wins — all shipped

- ~~**Free searches 1/day → 10/day.**~~ Along with the rest: guest 1→2, free
  1→10, Pro 30→75, Ultimate 200→400. Ten reads as a real allowance rather than
  a sample, and the gap over a guest's 2 is the thing that makes an account
  worth creating. Free users are ~98% of traffic and one
  search a day is not a product anyone can judge.
- ~~**Signup errors.**~~ Two paths passed Supabase's message straight to the
  screen; those are written for whoever integrates the SDK, not whoever is
  signing up. Now mapped to copy you can act on, as a tested pure function.
  It caught two things worth knowing: Supabase has **two** duplicate-account
  phrasings, and its cooldown says "for security purposes, you can only
  request this after 51 seconds" — mentioning neither "rate" nor "limit", so
  it was falling through to the generic message and inviting a retry that
  extends the cooldown.
- ~~**Fix the add-to-list popup.**~~ The bug had **three** instances, not one:
  BudgetEntrySheet (amount, category, note) and TrackedItemSheet (price
  threshold) had it too. All top-anchored now. No bottom-anchored sheet with a
  text input remains.
- ~~**Email verification off the signup page.**~~ Tried, reverted, see below.
- ~~**Price history as a line graph.**~~ Continuous line, drawn as rotated
  Views so no charting library and no `android/` rebuild. Points are spaced by
  **time**, not by position in the list — checks run on an adaptive schedule,
  so even spacing would stretch quiet periods and compress busy ones. The
  geometry is a tested pure module, because a chart that's subtly wrong still
  looks exactly like a chart.

- ~~**Custom SMTP.**~~ Already done — Resend is verified and Supabase Auth is
  sending through it, so confirmation emails were never on the rate-limited
  built-in mailer. Verified from DNS: DKIM at `resend._domainkey`, SPF and
  bounce MX on `send.sweepshopping.com`, and the root MX/SPF still Cloudflare's,
  so inbound `support@` is unaffected. See `sweep-backend/docs/email/`.
  Optional leftover: paste the branded confirm-signup template into Supabase,
  and set `SMTP_*` on Railway so scraper health alerts stop going only to the
  console.
- ~~**Estimated wait times per store.**~~ Done. Median successful *search*
  duration per retailer over the past week, computed in SQL from `ScrapeCheck`
  rows we already keep, shown on each store while a search runs.

  Median rather than mean, because one 240-second Amazon crawl drags an
  average somewhere no individual search has ever been. Failures excluded —
  they sit at whatever timeout we set, so counting them reports our patience
  rather than the store's speed. Fewer than five samples reports nothing:
  "usually 3 seconds" followed by a 40-second wait is worse than silence.

  Replaces a hardcoded "Amazon is slow" branch, which was true but would have
  quietly stopped being true, and said nothing about any other store having a
  bad day.

- ~~**Notification bell.**~~ Done. Top right on Home, hidden until there's
  something behind it.

  The reason it earns its place: a push notification is an interruption, not a
  record — it lands on a lock screen and is gone when it's swiped. Anyone whose
  phone was off, who dismissed one by accident, **or who never granted
  permission at all** had no way to find out a price dropped, which makes the
  whole feature feel unreliable even when it worked.

  So price drops and radar matches are now filed for everyone who qualifies,
  including people with no push token — previously the send loop skipped them
  entirely. Announcements share the same table when you want to send one.

---

## Email verification: tried removing it, put it back

Worth writing down, because the reasoning is easy to re-derive badly.

**The complaint was real.** The confirmation wall at signup is where people
abandon — a tester bounced on exactly that.

**The first fix was wrong.** Turning Supabase's "Confirm email" off and
nagging later doesn't work, because Supabase has no "signed in but
unconfirmed" state. The toggle is binary: on means no session until the link
is clicked, off means the user is created **already confirmed**. A banner
checking `email_confirmed_at` can never fire. Verified rather than assumed —
a signup against the dev project, where confirmation is still required, comes
back with no session at all.

**What removing it actually costs** is not what it looked like. Nothing in the
app gates on a confirmed address, so day to day nothing breaks. But anyone can
sign up as anyone — `mrbeast@gmail.com` — and while the real owner can always
reclaim it (password reset sends a code to the inbox, so whoever reads the
inbox owns the account), they inherit a stranger's data, get no warning, and
hit a message that presumed the account was theirs.

**So confirmation is back on**, and the effort went into the screen people
wait on instead, since that screen is the whole cost of the decision:

- A screen of its own, not a panel above the form. The panel left "Sign up"
  and "Log in" underneath it, so the obvious next action was pressing Sign up
  again.
- **"I've confirmed it"** — the automatic retry fires when the app returns to
  the foreground, which never happens if the link is opened on a laptop. That
  left the phone stuck forever.
- **"Use a different email"** — a typo was otherwise a dead end that survived
  restarting the app: the account exists, so sign-in is refused until it's
  confirmed, and it never can be.
- **A resend cooldown that counts down**, because Supabase rate-limits resends
  and answers an eager double-tap with what reads as breakage.

**And a typo guard at signup** — "did you mean gmail.com?" — which matters
more with confirmation on, not less: it stops people waiting on an email that
was never going to arrive. Suggests only, never blocks or rewrites. The
known-provider list is checked before any edit distance, which is what stops
`mail.com` becoming `gmail.com` and `pm.me` becoming `me.com`.

---

## Being honest about why limits exist — SHIPPED

A row under the Shortcuts on Home — **"Why are features limited?"** — opening a
page that says plainly: Sweep is one person paying real costs, here is what
each part actually costs, and here is what more subscribers would change.

Built as a row rather than the floating button this started as. A floating
control sits on top of content permanently to be tapped once, and what it
leads to is worth reading once, not hovering over forever.

**The numbers that describe today are generated** — the free tier's allowance
comes from `/plans` and the store list from `/search/retailers` — because a
page about being honest can't be the one place with stale figures in it. The
search sheet had exactly that problem: it still read "Pro gives 10 a day,
Ultimate gives 100" long after those became 75 and 400. It now carries the
short answer and links here for the real ones.

**Both cautions held.** It explains what subscriptions pay for and never reads
as crowdfunding — no appeal, nothing outside store billing, Sweep framed as a
product rather than a cause. And the milestones are stated as intentions, in
those words, because a number you're bound to is a number you'll regret.

**The commitment it makes**, and it's worth actually keeping: every paid tier
is profitable, so subscribers arriving loosens limits for everybody rather
than only for them.

---

## Features, in order of cost

~~**Similar products**~~ — **shipped, and free.** The obvious build was a
fan-out across every store, which is exactly what made Sweep This Deal cost
enough to ration at one a day. Instead it queries our own `Product` cache,
which every search, radar run and job already writes to — so it costs one
database query, no retailer call, no quota, and needs no metering at all.

The trade is coverage: it can only suggest things somebody has already
searched for, so it shows nothing when it knows nothing and gets better every
time anyone uses the app. `lib/matching.ts` did the hard part, which is why
this was small.

**Share from Amazon into the app** — **parked, and here's what it actually
costs**, so this doesn't get re-scoped from scratch later.

The destination is free: `expo-router` already routes `sweep://` URLs, so
`sweep://lookup?url=…` lands on the product page today with no work.

The problem is receiving the share. Android's share sheet sends `ACTION_SEND`
with the link in `Intent.EXTRA_TEXT`, and React Native's `Linking` API only
surfaces `ACTION_VIEW` data URIs — there is no JS API that can read it. That
means `expo-share-intent` or a custom native module, and since `android/` is
prebuilt and committed, a config-plugin library can't just install itself
without a prebuild that would overwrite the manual manifest.

So: a native dependency, hand-wiring into the existing Android project, and a
rebuild that can break — against a feature nobody discovers, because it lives
in someone else's share sheet rather than anywhere in Sweep. That is the real
reason it's niche, and no amount of native wiring fixes it.

_The free half is still worth doing:_ prompting at the moment someone is
pasting a link by hand costs nothing and is the idea most likely to land.

---

## Promo codes

Half built already: `PromoCode` and `PromoCodeRedemption` exist in the schema,
with `grantsTier` and `grantsDurationDays` and a unique constraint stopping the
same person redeeming twice. There is no endpoint and no UI — nothing reads
those tables except account deletion.

**The important fork, because "% off" and "free for a month" are not the same
job.**

| Want                          | Who does it                                                                 |
| ----------------------------- | --------------------------------------------------------------------------- |
| **Free Pro/Ultimate for N days** | Ours. Grant a tier for a period, no money moves, no Play involvement. The existing tables already model exactly this. |
| **A percentage off the price**   | **Google's.** Play controls subscription pricing — we cannot discount it ourselves. Set up an offer with a discounted phase in Play Console and hand out **promo codes** from there. Nothing to build. |

So a code from a video is a choice between two mechanisms, not one feature:

- `SWEEP30` → 30 days of Pro free, redeemed in the app, entirely ours. Best for
  a creator's audience, since it costs nothing to honour and needs no card.
- A Play offer code → an actual discount on a paid plan, created and tracked in
  Play Console, redeemed in the Play billing sheet rather than in Sweep.

**What's left to build for the first one:** a redeem endpoint (validate the
code, check expiry and `maxRedemptions`, create the redemption, set
`Wallet.tier` and `tierExpiresAt`), and a field to type it into — Profile or
the plans screen. The atomic-increment pattern from `quota.ts` applies to
`timesRedeemed`, or a code capped at 100 hands out 130 the day it goes public.

**Worth knowing:** a granted tier and a paid one both live on `Wallet.tier`, so
a promo expiring while someone also has a real subscription must not downgrade
them. The billing webhook already guards the reverse case; this is the same
problem from the other side and needs a test.

---

## Stores

**Not locked behind tiers.** Stores stay available to everyone; tiers buy
_limits and features_. That's the right call and worth keeping.

The wall is the same for nearly all of these: **no public API, heavy bot
protection, and our server's datacenter IP is refused**. Each needs either an
official API or a paid residential proxy.

| Store                                    | Path                                                                                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Walmart**                              | **Verify API access is still open before applying** — see below. The scraper already exists to swap behind it. |
| Target, Chewy, Overstock, Apple, Samsung | No public API. Proxy only.                                                                                                               |
| Temu                                     | No API, and fights scrapers hardest.                                                                                                     |
| ~~Booking.com~~                          | Travel, not goods — different comparison logic entirely. Dropped.                                                                        |

---

### Walmart — check before applying

The right programme is the **Content Provider API**, reached through the
affiliate programme at `affiliates.walmart.com` (run through Impact, free,
usually approved in a day or two). It gives titles, images, descriptions and
pricing, read-only, plus tracked links that pay commission — the only store so
far whose economics run in our favour rather than costing us per request.

**Three wrong doors, all of which look plausible:**

- **Channel Partner / Solution Provider** — software that helps people *sell on*
  Walmart Marketplace. Inventory, repricing, order management.
- **Walmart Connect Partner Network** — the advertising business. Every option
  is about running ad campaigns for brands.
- **Drop Ship / Marketplace Seller / Warehouse Supplier APIs** — all for selling
  products to or through Walmart.

**The open question, worth one email before any application:** at least one
source says Walmart no longer issues new API keys. Their own affiliate FAQ
mentions "data feeds" and says nothing about APIs either way, so this is
unconfirmed rather than settled. Ask `affiliates@walmart.com` directly whether
Content Provider API access is still open to new affiliates.

If it isn't, a periodic **data feed** may still be usable — it would seed the
product cache rather than answer live per-search lookups, which is a different
integration from eBay and Etsy and worth designing for deliberately rather
than discovering halfway through.

---

## Parked

- **Coupons** — partly unparked. This said no store offers them via API, and
  that turned out to be wrong: Amazon's payload carries `coupon` and
  `coupon_description`, and the lookup page already shows them when present.
  What's still parked is coupons for stores that don't publish them, which
  would mean scraping coupon sites — its own project.
- **Dropping to $4.99 / $9.99** — decided against for now. Worth remembering
  _why_: lowering later is easy, raising is not. Existing subscribers keep their
  price and Play requires consent for increases, so starting low is closer to a
  one-way door than it feels.

---

## The Bright Data ceiling, and why it isn't scary

Amazon goes through Bright Data and bills **per record**, on a free tier of
5,000 a month — roughly 166 a day shared across everyone. Raising the free
limits multiplies the main variable cost, paid for users who generate no
revenue.

**This is fine, and the reason is worth writing down.** Running out of credits
is the signal that there are enough users to justify moving to
**amazonscraperapi**, which is far cheaper — as low as $0.50 per 1,000 requests
— and bills **per request rather than per record**, so one search costs 1
instead of one per result. A whole month of the Bright Data free tier is about
$2.50 there. The ceiling can only be hit by the kind of usage that pays for
leaving it behind.

**What actually happens when the credits run out**, verified rather than
assumed: Bright Data answers 429 (treated as `blocked`) or another error
(`failed`), the circuit breaker pauses Amazon, and `searchAllRetailers` returns
the other stores regardless — it deliberately never rejects. The store-trouble
banner already names Amazon as unavailable. So it degrades to "Amazon is
missing from results" rather than breaking search, and there's no cliff to
plan around.

~~**Caching searches by keyword.**~~ **Done.** Wrapped around
`adapters[retailer].search` — the same choke point the rate gate uses — so
every path gets it by construction rather than by remembering.

What's cached is the **match set, not the prices**: a row records which
products a keyword returned, and prices are read back from `Product`, which
scheduled checks and product lookups keep current. Discovering matches is the
expensive half and ages slowly; prices are the cheap half and age fast, so
they're deliberately not frozen in.

TTL is split by cost, not by taste — 3 hours for Amazon, the only retailer
that charges us, and 45 minutes for the free APIs. Failures and empty results
are never cached, so a store having a bad minute can't be served back as "this
store has nothing" for hours.

---

## Onboarding — SHIPPED

Six slides, ordered as a story rather than a feature list, because "here are
our six features" is what people skip.

| #   | Key       | Eyebrow        | What it says                                                                          |
| --- | --------- | -------------- | ------------------------------------------------------------------------------------- |
| 1   | `welcome` | WELCOME        | Your online shopping buddy. Shows the logo.                                           |
| 2   | `find`    | FIND IT        | Every store, one search. Store names pulled from **live retailer status**.            |
| 3   | `look`    | LOOK INTO IT   | Rating, what buyers said, shipping, price history, and whether the sale is real.      |
| 4   | `watch`   | WATCH IT       | Tracking plus Deal Radar. Mock of a price-drop notification.                          |
| 5   | `plan`    | PLAN IT        | Shareable lists and a budget.                                                          |
| 6   | `free`    | THE HONEST BIT | What the free tier actually gives, pulled live from `/plans`.                          |

**What changed in the redo:**

- **"Judge it" became "look into it."** Product lookup absorbed that question —
  "is this sale real" is now one section of a page that also carries ratings,
  reviews and history. Two slides for one screen would have described the app
  as it used to be. The store-claims-vs-actually verdict survives inside it,
  because it was always the strongest thing there.
- **Reordered so lookup comes before tracking.** You look into a product before
  deciding it's worth following; the old order asked people to watch first and
  judge later.
- **Store names now come from live retailer status.** The app's own
  `storeListPhrase` doesn't know which stores are switched off server-side, so
  onboarding was naming ones we don't search — the worst possible place for it.
- **Dropped a mock referencing "Swept!" and Newegg**, one a removed feature and
  the other a disabled store.

**What was kept**, all of it deliberate: story order, mocks of real UI rather
than descriptions, limits and store names generated rather than typed, the
honest slide last, and skippable from frame one.

---

## Sequencing

**Next up: AdMob rewarded ads.** The backend half is done and tested
(`admobSsv.ts`); the app half is stubbed in `lib/ads.ts` because
`react-native-google-mobile-ads` pulls in `play-services-ads` compiled with
Kotlin 2.3.0 while Expo SDK 57 uses 2.1.0.

Two documented routes out, in `sweep-app/docs/INTEGRATIONS.md` §5:

1. Raise the project's Kotlin version via `expo-build-properties` — cleaner
2. Pin an older `play-services-ads` built against Kotlin ≤ 2.1

Do it on a branch. It's a native dependency plus a toolchain bump, which is the
riskiest change type in this repo, and a broken build shouldn't touch a
shippable `master`. `lib/ads.ts` already mirrors the real module's API, so once
the build compiles the rest is: reinstall the package, restore the real file,
add the config plugin back to `app.json`.

Worth knowing before spending a morning on it: at ~$0.05 per free user per
month (from `scale-model.ts`), rewarded ads earn about $5/month at 100 users.
The reason to do it now is that toolchain fixes are easier before anyone
depends on your build cadence, not the revenue.

---

### Everything else, roughly in order

1. **Tester feedback** — real usage from the release going out now. Ideas from
   studying competitors and ideas from watching your own users disagree, and
   when they do, users win. Re-order everything below this at that point.
2. **Free searches ad top-up** — follows AdMob directly; the quota side already
   exists (`MAX_REWARDED_SEARCHES_PER_DAY`).
3. **Share from Amazon** — parked with the cost written down above.
4. **Best Buy** — waiting on their API key. One line in `DISABLED_RETAILERS`.
5. **Walmart** — the only major store left with a free official API.

---

### Done this release

Product lookup (replacing Sweep this deal) · raised limits on every tier ·
similar products · keyword caching · price history as a line · estimated wait
times · notification bell and feed · announcements + test-drop endpoints ·
"why are features limited?" · signup funnel fixes · email typo guard ·
onboarding redone · custom SMTP verified · FCM push working.
