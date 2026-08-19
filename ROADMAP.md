# Sweep — next release

Rewritten from the 2am notes, with what we worked out since. Ordered roughly by
what I'd do first, not by size. Items marked SHIPPED are done and are kept for
the reasoning behind them, not as a to-do.

---

## Product lookup — SHIPPED

Replaced "Sweep this deal" entirely. Paste a link, or tap Details on anything
searched or tracked, and get one page about that product.

**What each store actually returns**, verified against live payloads rather
than assumed — this was the open question and it's now closed:

| Store  | What it gives                                                                 |
| ------ | ----------------------------------------------------------------------------- |
| Amazon | Its own review summary, keywords split positive/negative/mixed, per-topic sentiment with buyer quotes, review photos, spec table, features, trust badges, `frequently returned` flag, **and coupon fields** |
| eBay   | Seller feedback % and score, shipping cost, delivery window, condition, specs |
| Etsy   | Listing detail, tags, materials; per-listing reviews, often absent            |

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

**Still to do here:** price history as a line graph (below), and a lookup slide
in the onboarding redo.

---

## Quick wins

- **Signup errors** — a failed signup should say "something went wrong, try
  again", not surface a provider error.
- **Fix the add-to-list popup** — Make it towards the top of the screen so keyboard doesnt cover the text input.
- ~~**Free searches 1/day → 5/day.**~~ **Done**, along with the rest: guest
  1→2, free 1→5, Pro 30→75, Ultimate 200→400. Free users are ~98% of traffic
  and one search a day is not a product anyone can judge. The cost note below
  still applies — pair with caching.
- **Estimated wait times per store.** Nearly free: `ScrapeCheck` already stores
  `durationMs` for every call, so a median per retailer is a query against data
  we have.
- **Title → "Sweep: Shopping Assistant".** Weaker for search than
  "Price Tracker & Deals" — nobody searches "shopping assistant" — but it fits
  where the product is heading. Changeable any time without a build. (I'll keep it PT&D for now)
- **Price history as a line graph.** Continuous line, dollar axis, like a FRED
  chart. Bars read as discrete events; the data is a time series and the line
  is the honest shape. Now visible on every lookup, so it matters more than it
  did. Note the constraint: no charting library, because they all pull in
  react-native-svg and this project ships a prebuilt `android/`. A line can be
  drawn with rotated Views without adding a native module.

  -Also maybe move email verification to profile & homepage, it gets annoying on the signup page and can draw away users (my sister got annoyed at it)

  -Notification bell in top right next to profile, for price drops and possibly app-wide notifs i sent out

---

## Being honest about why limits exist

The strongest idea on the list, and almost nobody does it.

A floating button on Home — **"Why are features limited?"** — opening a page
that explains the app is one person paying real costs, what each store
actually costs to query, and what more paid users would unlock:

> 10 Pro users covers monthly running costs
> 15 pays for more stores
> 20 loosens the limits for everyone

Plus the list of stores we plan to add, so the roadmap is public rather than
implied.

**Two cautions.** Keep it "here's what revenue unlocks" rather than anything
that reads as crowdfunding, which Play treats differently. And frame targets as
intentions, not promises — a number you're bound to is a number you'll regret.

**The commitment behind it:** as paid users arrive, limits loosen for
everybody, because every paid tier is profitable. That's worth saying out loud
and then actually doing.

---

## Features, in order of cost

**Similar products** — cheaper than it sounds; reuses the title-matching from
Sweep This Deal. Metered 1 / 8 / 50 per day.

**Share from Amazon into the app** — Android intent filter plus the existing
`resolveProduct`, landing on tracking or the new product page. Good win,
moderate cost. Amazon first; other stores are the same mechanism with more URL
patterns.

_Discoverability is the hard half._ The feature lives in **another app's**
share sheet, so nobody finds it by exploring Sweep. Three places it needs to
be, in order of how much they'll actually work:

1. **At the moment of the slower alternative.** Whenever someone is pasting a
   link — the tracking empty state, the add-by-link field, the list item field
   — say "or share straight from the store app". That's the one that lands,
   because they're doing the manual version right then and the shortcut is
   immediately usable.
2. **A dismissible tip after the first successful track**, when they've proved
   they want the feature and know what it's for.
3. **An onboarding slide.** Weakest of the three on its own: onboarding runs
   once, before anyone has a product to share, so it's abstract exactly when it
   can't be acted on. Worth including in the redo, but not instead of 1 and 2.

Same reasoning applies to anything else triggered from outside the app.

**Feedback banner** — somewhere for testers and users to say what they want
built. Worth having while the tester group is small and talkative.

---

## Stores

**Not locked behind tiers.** Stores stay available to everyone; tiers buy
_limits and features_. That's the right call and worth keeping.

The wall is the same for nearly all of these: **no public API, heavy bot
protection, and our server's datacenter IP is refused**. Each needs either an
official API or a paid residential proxy.

| Store                                    | Path                                                                                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Walmart**                              | **Only one with a free official API.** Affiliate approval was painful, but the scraper already exists to swap behind it. Best candidate. |
| Target, Chewy, Overstock, Apple, Samsung | No public API. Proxy only.                                                                                                               |
| Temu                                     | No API, and fights scrapers hardest.                                                                                                     |
| ~~Booking.com~~                          | Travel, not goods — different comparison logic entirely. Dropped.                                                                        |

---

## Parked

- **Widgets** — dropped. Native Kotlin plus a config plugin, permanently harder
  to maintain, and not worth it.
- **Shipment tracking** — needs paid carrier APIs and is arguably a different
  product. Highest cost-to-value on the list.
- **Coupons** — partly unparked. This said no store offers them via API, and
  that turned out to be wrong: Amazon's payload carries `coupon` and
  `coupon_description`, and the lookup page already shows them when present.
  What's still parked is coupons for stores that don't publish them, which
  would mean scraping coupon sites — its own project.
- **Dropping to $4.99 / $9.99** — decided against for now. Worth remembering
  _why_: lowering later is easy, raising is not. Existing subscribers keep their
  price and Play requires consent for increases, so starting low is closer to a
  one-way door than it feels.
- **Defaulting to 2–3 stores per search** — probably obsolete. That note came
  from searches feeling slow, and progressive results fixed the actual cause;
  stores now appear as they answer. Defaulting to two would undercut the one
  thing the app is for. Re-test before building, and note the store picker
  already covers "I know where to look".

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

**Still worth doing: caching searches by keyword.** Right now every user
searching "airpods" triggers a fresh scrape. Caching even briefly collapses
repeat traffic, and popular queries repeat constantly. It's the single biggest
lever on cost, it's free, and it makes both providers go further.

---

## Onboarding, as it stands today

Six slides, ordered as a story rather than a feature list — find it, watch it,
judge it, plan it — because "here are our six features" is what people skip.
Each shows a small mock of the real UI instead of describing it. Skippable from
the first frame, with a language picker in the header.

| #   | Key       | Eyebrow        | Title                      | What it says                                                                                                                                  |
| --- | --------- | -------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `welcome` | WELCOME        | Sweep                      | Your online shopping buddy — finds the best price, watches it, tells you when a sale is real. Shows the logo.                                 |
| 2   | `find`    | FIND IT        | Every store, one search    | Names the live stores (generated, never hardcoded), cheapest and biggest drop pulled to the top. Mock of a comparison.                        |
| 3   | `watch`   | WATCH IT       | Never refresh a page again | Tracking plus Deal Radar. Mock of a price-drop notification.                                                                                  |
| 4   | `judge`   | JUDGE IT       | Is that sale even real?    | Own price history vs. a red discount badge on the usual price. Mock of a verdict.                                                             |
| 5   | `plan`    | PLAN IT        | Lists and a budget         | Shareable lists, and logging what you spend. Mock of a budget and two lists.                                                                  |
| 6   | `free`    | THE HONEST BIT | Free, genuinely            | What the free tier actually gives, pulled live from the API so it can't promise what the server refuses. Ends "No card, no trial, no expiry." |

The last slide's limits come from `/plans`, so they can't drift from what's
enforced. Slide 2's store list comes from `storeListPhrase()`, so adding or
disabling a store updates it with no edit.

**When it gets redone**, the things worth keeping:

- Story order, not a feature list
- Mocks of real UI rather than descriptions
- Limits and store names generated, never typed
- The honest slide last — putting the caps in the tour rather than at the first
  refusal is the difference between a limit that feels fair and one that feels
  like a trap
- Skippable from frame one

**What will need to change:** the product lookup page becomes the thing people
open the app for, so it likely deserves its own slide — probably replacing or
absorbing "judge it", since price history is the evidence behind both.

---

## Sequencing

1. **Dev Supabase project** — tests currently write to the database testers
   live in. Highest risk, smallest job.
2. **Subscriptions** — the thing that makes any of this sustainable, and it
   needs the closed test running anyway.
3. **Quick wins + the "why limited" page** — small, and the honesty page pairs
   naturally with subscriptions going live.
4. **Tester feedback lands** — two weeks of real usage. Ideas from studying
   competitors and ideas from watching your own users disagree, and when they
   do, users win. Re-order everything below this line at that point.
5. ~~**Product lookup page**~~ — done, ahead of schedule.
6. **Similar products, share-to-app.**
7. **Onboarding, redone last** — it should introduce the app as it ends up,
   not as it is now.
