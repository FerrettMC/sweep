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

**Still to do here:** price history as a line graph (below), and a lookup slide
in the onboarding redo.

---

## Quick wins

### Shipped

- ~~**Free searches 1/day → 5/day.**~~ Along with the rest: guest 1→2, free
  1→5, Pro 30→75, Ultimate 200→400. Free users are ~98% of traffic and one
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

### Still to do

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
- **Title → "Sweep: Shopping Assistant".** Weaker for search than "Price
  Tracker & Deals" — nobody searches "shopping assistant" — but it fits where
  the product is heading. Changeable any time without a build. (Keeping PT&D
  for now.)

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
rebuild that can break — against a feature that lives in someone else's share
sheet, which is the discoverability problem noted below and the reason it's
niche.

_The free half is still worth doing:_ prompting at the moment someone is
pasting a link by hand costs nothing and is the idea most likely to land.

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

1. ~~**Dev Supabase project**~~ — done.
2. ~~**Subscriptions**~~ — done and live; purchases confirmed working.
3. ~~**Product lookup page**~~ — done, well ahead of where it sat on this list.
4. ~~**Signup quick wins**~~ — done.
5. ~~**Custom SMTP**~~ — already in place before it reached the top of the list.
6. ~~**The "why limited" page**~~ — done.
7. **Remaining quick wins** — notification bell.
8. **Tester feedback lands** — real usage. Ideas from studying competitors and
   ideas from watching your own users disagree, and when they do, users win.
   Re-order everything below this line at that point.
9. **Similar products, share-to-app.**
10. **Onboarding, redone last** — it should introduce the app as it ends up,
    not as it is now. Product lookup now deserves a slide of its own.
