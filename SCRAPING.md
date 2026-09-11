# Where the product data comes from

Which provider serves which retailer, what it costs, and what to switch to when
one runs out. Written down because the answer to "can we just fetch it
ourselves" has now been researched three times.

---

## Today

| Retailer | How | Free allowance | Used (measured 11 Sep 2026) |
| -------- | --- | -------------- | --------------------------- |
| Amazon | Bright Data Amazon Scraper API | 5,000 records/month | ~112/month, about **2%** |
| Walmart | Decodo proxy | 2,000 requests total | ~95/month |
| Best Buy | own scraper, no proxy | — | free |
| eBay | own scraper, no proxy | — | free |
| Etsy | own scraper, no proxy | — | free |

Measured from ScrapeCheck over seven days: amazon 26 calls, walmart 22, bestbuy
23, ebay 37, etsy 30. At that rate the Amazon free tier has roughly **44x
headroom** and Decodo has about 21 months.

Worth re-measuring before acting on any of this. The numbers above are from a
week with about a dozen users, and the thing that changes them is advertising
working.

---

## Fallbacks

### Amazon — amazonscraperapi.com

Dashboard: https://app.amazonscraperapi.com/app

- **Free: 1,000 requests/month**, no card, 50 concurrent
- **Pay as you go: $0.90 per 1,000 successful requests**, available on any plan
- Vibe $19/month for 27,000 · Pro $49/month for 82,000
- Only 2xx responses are charged
- Median 2.6s, p95 6s
- ~55 fields per product, and ranked search results

The free tier is smaller than Bright Data's, so this is a fallback rather than a
replacement. The pay-as-you-go rate is the part worth knowing: at current volume
that is about **ten cents a month**, and even at fifty times current traffic it
is roughly **five dollars a month**. Running out of free credits is not the
cliff it feels like.

### Walmart — walmartscraperapi.com

- **Free: 1,000 requests/month**, no card
- **Pay as you go: $0.90 per 1,000 successful requests**
- Vibe $19/month for 27,000 · Pro $49/month for 82,000
- Median 2.6s including proxy, anti-bot and parsing
- Eight endpoints: search, product, reviews with star distribution, pricing,
  grocery, best sellers, filters, related queries

Identical pricing, copy and response times to amazonscraperapi.com, and neither
site names a parent company. Assume one operator until shown otherwise, and
**check on signup whether the two free tiers are actually separate accounts**.
If one allowance sits behind both domains, using both is the exact trap the
one-retailer-per-provider rule exists to prevent.

Note the standing rule while on free credits: **one retailer per provider
account.** Adding a second store to Decodo burns the allowance at double rate
and takes Walmart down with it when it runs out.

---

## What does not work, and why

Asked and answered more than once. Both reasons are structural rather than a
matter of trying harder, which is why no amount of header tuning changes them.

**Direct from our own servers.** Amazon runs AWS WAF Bot Control, whose first
layer scores the source ASN *before any HTTP is parsed*. Railway is a datacenter
range, so the request is refused for being from a datacenter and never reaches
the code that would read a header. Reported datacenter failure rates run 60-70%.

Walmart runs Akamai Bot Manager with HUMAN on top, and the deciding signal in
2026 is the TLS fingerprint — JA3/JA4 — which is a property of the HTTP client,
not of anything that can be put in a header. Node does not have a browser's
fingerprint. HTTP-only scrapers are reported to last 10-20 requests.

Measured, not just read: `decodo.ts` records Railway refused, a Cloudflare
Worker challenged twelve times out of twelve, and Geonode 422 on datacenter,
residential and JS-rendered alike. `POST /admin/probe/direct` re-runs the
Amazon half on demand, with Chrome's full header set, so the answer can be
re-checked rather than remembered.

**Official APIs.** Both refused. Hundreds of emails to Amazon and Walmart over
a long period; neither grants API access at this scale. Closed, not pending.

---

## Adding stores

The stores that cost nothing are the ones scraped directly, with no provider in
front: Best Buy, eBay and Etsy. Every store added that way is free forever and
cannot run out of anything. That is worth far more than another metered one.

So the question for any candidate is empirical, and `POST /admin/probe` already
answers it from production in about a minute per store. It reports status,
redirects, challenge phrases and a count of price-shaped values, which is
enough to tell "this parses" from "this is a challenge page wearing a 200".

Worth probing, roughly in order of how likely they are to answer:

| Store | Try | Note |
| ----- | --- | ---- |
| Target | `https://www.target.com/s?searchTerm=airpods` | Has an internal Redsky API that is widely reachable. Unofficial, so it can move without warning. |
| B&H Photo | `https://www.bhphotovideo.com/c/search?q=airpods` | Electronics, historically light protection |
| GameStop | `https://www.gamestop.com/search/?q=switch` | Narrow catalogue, low defences |
| Micro Center | `https://www.microcenter.com/search/search_results.aspx?Ntt=ssd` | Electronics, small operation |
| Barnes & Noble | `https://www.barnesandnoble.com/s/dune` | Books, and nobody scrapes them |
| Chewy | `https://www.chewy.com/s?query=dog+food` | Pet, a category nothing else here covers |
| Home Depot | `https://www.homedepot.com/s/drill` | Bigger, likely Akamai |
| Costco | `https://www.costco.com/CatalogSearch?keyword=tv` | Probably hard, cheap to find out |

Known dead, do not re-test: **Newegg** and **ASOS** both parsed perfectly in
development and failed the moment they ran from production, which is the whole
lesson. **Zappos** is Amazon-owned, so expect Amazon's defences; its public API
is from 2010 and long gone.

### The bar for shipping one

Returning data once is not the test. Newegg did that. The bar is a stress run
that holds up — `POST /admin/probe/stress` — because the failure mode is a
store that works for a week and then quietly returns nothing, and the app has
to name it on the search screen either way.

More stores is only worth advertising if they are stores that answer. The
selling-points file already says only name stores that are actually live, and
the app builds its own store list for that reason.

### Not worth it: affiliate product feeds

Awin, CJ, Rakuten, ShareASale and Impact all offer product feeds to approved
publishers, and they are the wrong shape. They are bulk CSV or XML refreshed
every 4 to 24 hours, not live queries. A price up to a day old contradicts
"every price is read from the store itself, never guessed", which is the line
the landing page leads with. Skip the category.

---

## What to watch

The cost that scales badly is not search, it is tracking. A search is charged
once. A **tracked Amazon product is a recurring charge forever**, every check,
for as long as somebody watches it.

Right now that is nothing — of 1,322 product rows only 2 are tracked, and zero
Amazon calls in the measured week came from the scheduler. Every metered call
was a search or a lookup. That ratio inverts the moment tracking gets used, and
it inverts quietly.
