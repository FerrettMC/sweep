# Best Buy — developer API access

## Send this from your Gmail, not from support@

**`support@sweepshopping.com` may not be reaching them at all.** Checked 31 Aug:

| Record | What it says |
| --- | --- |
| SPF on `sweepshopping.com` | `include:_spf.mx.cloudflare.net` — Cloudflare Email Routing, which only **receives** |
| SPF on `send.sweepshopping.com` | `include:amazonses.com` — Resend, for the app's transactional mail |
| DKIM | `resend._domainkey` only, scoped to that subdomain |
| DMARC | none |

If you send as `support@sweepshopping.com` from Gmail, Google's servers are not
in your SPF record, so SPF fails and DKIM doesn't align. With no DMARC policy,
each receiver guesses — and a young domain failing authentication into a
corporate filter is exactly what gets junked without a bounce.

**So send this one from `ferretonyt@gmail.com`.** Plain Gmail to a corporate
address has excellent deliverability and nothing to misalign. Put the domain in
the signature so it still reads as a real product.

Worth fixing properly afterwards either way — add `include:_spf.google.com` to
the root SPF record if you use send-as, and add a DMARC record. That matters for
every company you email from here on, not just this one.

---

## The email

**To:** developer@bestbuy.com
**Subject:** Developer API request — phone call 31 Aug, form resubmitted

---

Hello,

I spoke to your business department by phone this morning, 31 August, about
developer API access. We went through everything for about half an hour and I
was told it would be raised internally and that I should submit the website form
again — which I have now done.

I'm writing so there is something in writing to attach that to.

The reason I keep following up is that **no reference number has ever been
created**, so each contact starts from nothing:

- **15 Aug** — emailed `support@`. No reply.
- **21 Aug** — phoned. Told the review would complete by Wed 26 Aug.
- **28 Aug** — phoned back as instructed. No record of the request existed. Sent to this address.
- **28 Aug** — emailed this address. No reply.
- **31 Aug** — phoned. Half an hour, escalated verbally, told to resubmit the form.

**What I'm asking for:** a Best Buy Developer API key (developer.bestbuy.com) —
read-only product, price and availability data.

**What it's for:** Sweep (sweepshopping.com), a free Android shopping app I build
independently. It searches several retailers at once so people can compare
prices, and keeps price history so they can tell a real discount from a sticker.
It already supports Amazon, Walmart, eBay and Etsy. No ordering, no cart, no
customer accounts — product and price data shown alongside other retailers, with
a link through to Best Buy.

**Three things would help, in order:**

1. A reference number I can quote, so the next contact continues this one.
2. Whoever owns developer API approvals, or a realistic timeframe.
3. If Best Buy no longer issues these keys, please just say so. A clear no is
   more useful than another fortnight of following up, and I'll build around it.

Thank you,
Jude
Sweep — sweepshopping.com
