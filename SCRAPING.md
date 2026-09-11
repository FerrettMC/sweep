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
23, ebay 37, etsy 30.

**Do not read headroom off those numbers.** They are what an app with a dozen
users and almost no real usage looks like — most of them are test searches.
Capacity has to be calculated from the daily cap, not extrapolated from an
empty week.

## What the free tiers actually support

One search fans out to every store, so **one search costs one Decodo request
and one Bright Data record**. The free tier allows 10 searches per user per day.

| Active users | at 3/day | Decodo (2,000 **total**, never refills) | Bright Data (5,000/mo) |
| ------------ | -------- | --------------------------------------- | ---------------------- |
| 10 | 30/day | 67 days | fine |
| 20 | 60/day | **33 days** | fine |
| 50 | 150/day | **13 days** | fine |
| 100 | 300/day | **7 days** | **1.8x over** |

If users hit the 10/day cap instead, 20 users drain Decodo in **10 days** and
put Bright Data 1.2x over.

The ceilings, stated plainly:

- **Bright Data: 164 searches a day.** That is 16 users at the cap, or 55 users
  doing three searches a day.
- **Decodo: 2,000 searches, ever.** It is a one-time trial, not a monthly
  allowance, so it does not recover.

So the free setup cannot survive the app working. Any real traction takes
Walmart out within weeks and Amazon within a month or two.

## What growth costs

Both fallbacks are $0.90 per 1,000, with 1,000 a month free each.

| Active users | searches/mo | Amazon + Walmart per month |
| ------------ | ----------- | -------------------------- |
| 20 @ 3/day | 1,800 | **$1.48** |
| 50 @ 3/day | 4,600 | **$6.41** |
| 100 @ 3/day | 9,100 | **$14.62** |
| 250 @ 3/day | 22,800 | **$39.24** |
| 20 @ 10/day | 6,100 | **$9.14** |
| 100 @ 10/day | 30,400 | **$52.92** |

Pro is $5.99 a month. At a 1% conversion rate, 100 users is one subscriber,
which covers the bill at that size with change. The metered stores are not
where this becomes unaffordable — the point is that they stop being free the
moment anybody actually uses the app, and that is a switch to plan for rather
than to discover.

---

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

Worth probing. Search page first, and **if it comes back amber, probe a product
page from that store as well** — product pages usually still put a price in the
HTML because retailers want Google to show it in search results, even when the
listing page renders in the browser. A store where only product pages parse is
still worth having: paste-a-link lookup works, even if keyword search does not.

Grab a product url by opening the search page yourself and copying one; there
is no point guessing at ids.

The 403s are not about the server's address. B&H, Micro Center, GameStop and
Crutchfield all refuse plain curl from a residential connection too, returning
an identical ~5.7KB challenge page. They are refusing the **client**, by TLS
fingerprint, and no proxy fixes that. Only a real browser engine or an
impersonating client would get past, which is a different and much larger
undertaking than a parser.

**Electronics** — all four tested 11 Sep 2026, all 403 from both a datacenter
and a residential address. Do not re-test without a browser engine.

    https://www.bhphotovideo.com/c/search?q=airpods
    https://www.microcenter.com/search/search_results.aspx?Ntt=ssd
    https://www.adorama.com/l/?searchinfo=airpods
    https://www.crutchfield.com/search/airpods.html
    https://www.gamestop.com/search/?q=switch

**Music and hobby** — enthusiast retailers, historically the lightest defences

    https://www.sweetwater.com/store/search?s=sm7b   <-- WORKS, see below
    https://www.guitarcenter.com/search?Ntt=sm7b
    https://www.harborfreight.com/search?q=impact+driver

**Home and hardware**

    https://www.homedepot.com/s/drill
    https://www.lowes.com/search?searchTerm=drill
    https://www.wayfair.com/keyword.php?keyword=desk
    https://www.ikea.com/us/en/search/?q=desk

**Warehouse and department**

    https://www.costco.com/CatalogSearch?keyword=tv
    https://www.samsclub.com/s/tv
    https://www.kohls.com/search.jsp?search=airpods
    https://www.macys.com/shop/featured/airpods
    https://www.jcpenney.com/s/airpods

**Specialty** — categories none of the current five cover

    https://www.chewy.com/s?query=dog+food
    https://www.petco.com/shop/en/petcostore/search?q=dog+food
    https://www.barnesandnoble.com/s/dune
    https://www.rei.com/search?q=tent
    https://www.dickssportinggoods.com/search/SearchDisplay?searchTerm=tent
    https://www.tractorsupply.com/tsc/search/boots
    https://www.ulta.com/shop/search?q=moisturizer
    https://www.sephora.com/search?keyword=moisturizer

**Auto**

    https://www.autozone.com/searchresult?searchText=wiper+blades
    https://www.oreillyauto.com/search?q=wiper+blades

If a url 404s the pattern has moved; search on the site in a browser and copy
whatever is in the address bar.

Known dead, do not re-test: **Newegg** and **ASOS** both parsed perfectly in
development and failed the moment they ran from production, which is the whole
lesson. **Zappos** is Amazon-owned, so expect Amazon's defences; its public API
is from 2010 and long gone.

**Sweetwater — works, 11 Sep 2026.** The search page server-renders a complete
Algolia index into the HTML: `productName`, `brand`, `longDescription`,
`price.finalPrice`, `price.hasPriceDrop`, `rating.average`, `rating.count`,
`image.path`, `objectID` as the SKU, and a product `url`. That is a richer
payload than several adapters already shipping. Prices are integers rather than
decimals, which is what the probe's price counter used to miss.

Music and audio gear, so it covers ground none of the current five do.

**But not from our own address.** From Railway it returns 403 with px-captcha,
which is PerimeterX refusing a datacenter. From a residential connection the
same url returns 200 and a megabyte of product data. So Sweetwater is wall two,
not wall one: it blocks *where the request comes from*, not *what is making
it*, and a residential exit walks straight in.

That makes it the first candidate in this whole search that is actually
addable. It needs a residential proxy, which means Decodo — and Decodo already
serves Walmart, which the one-retailer-per-provider rule says not to stack.

The way out is now available: move Walmart to walmartscraperapi.com, whose free
1,000 a month is ten times current Walmart usage, and Decodo's residential is
free for Sweetwater.

One thing to size first: the search page is **1MB**. Decodo's pay-as-you-go is
billed per gigabyte, so at $4/GB that is about four tenths of a cent per
search, or roughly 40 cents a month at current volume. Cheap, but ten times the
bandwidth of a lean page, and worth checking whether a narrower url returns the
same index before wiring it up.

**Target — tested and rejected, 11 Sep 2026.** The search page answers from
production in 0.7s with `__NEXT_DATA__` in it, which looks like a win and is
not. The page contains **zero prices**: `pageProps` is 224 bytes of status code
and preload variables, and every product is fetched in the browser afterwards
from Target's Redsky API. Redsky is callable in principle — the web key is in
the page source, 27 times — but it answers 403 with a bot challenge
(`AtaVerifyCaptcha`, toadmash.net). So the open half has no data and the half
with the data is defended. Nothing to build on unless the Redsky challenge
becomes passable, which is the same class of problem as Amazon and Walmart.

This is also the shape to watch for in every other candidate: a modern store
whose HTML is a shell. Reachable and parseable are different questions, and the
gap between them is a wasted day.

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
