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

### Walmart — open

Decodo currently, on a one-time 2,000. Research pending.

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

## What to watch

The cost that scales badly is not search, it is tracking. A search is charged
once. A **tracked Amazon product is a recurring charge forever**, every check,
for as long as somebody watches it.

Right now that is nothing — of 1,322 product rows only 2 are tracked, and zero
Amazon calls in the measured week came from the scheduler. Every metered call
was a search or a lookup. That ratio inverts the moment tracking gets used, and
it inverts quietly.
