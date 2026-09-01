# Best Buy — developer API request form

For the form at **developer.bestbuy.com**, which is what the business department
asked you to resubmit on 31 Aug.

Field names vary, so these are written to be pasted into whatever boxes it has.

---

## Use a Gmail address, not support@

Whatever address you put in the form is where the reply goes — and
`support@sweepshopping.com` may not be able to receive-and-be-replied-to
reliably. Checked 31 Aug:

| Record | What it says |
| --- | --- |
| SPF on `sweepshopping.com` | `include:_spf.mx.cloudflare.net` — Cloudflare Email Routing, receive only |
| SPF on `send.sweepshopping.com` | `include:amazonses.com` — Resend, the app's transactional mail |
| DKIM | `resend._domainkey` only, scoped to that subdomain |
| DMARC | none |

Inbound forwarding works, but anything you SEND as `support@` from Gmail fails
SPF and doesn't align DKIM — so if this ever turns into a thread, your side of
it may be getting junked silently. **Put `ferretonyt@gmail.com` in the form.**

Worth fixing regardless: add `include:_spf.google.com` to the root SPF record if
you use Gmail send-as, and add a DMARC record. That affects every company you
contact from here, Walmart's affiliate team included.

---

## Name / contact

    Jude
    ferretonyt@gmail.com

## Company or organisation

    Sweep (independent developer, not incorporated)

## Website

    https://sweepshopping.com

## What are you building?

Short version, if the box is small:

    Sweep, a free Android shopping app that compares prices across several
    retailers in one search and tracks price history so users can tell a real
    discount from a permanent one. Live on Google Play. I would use the API for
    read-only product, price and availability data, displayed alongside other
    retailers with a link through to Best Buy.

## Describe your use case

Longer version, if the box is big:

    Sweep is a free Android app that searches several retailers at once and
    shows the results side by side, so someone can see who is actually cheapest
    before they buy. It also records price history over time, which lets it tell
    a genuine discount from a struck-through price an item has always had.

    It currently supports Amazon, Walmart, eBay and Etsy. Best Buy is the store
    users ask for most, and the obvious gap in electronics comparisons.

    I would use the Products API for read-only product, price and availability
    data. No ordering, no cart, no customer accounts, no checkout — listings are
    shown alongside other retailers with a link through to Best Buy to complete
    the purchase.

    The app is built and maintained by one independent developer. It is live on
    Google Play with a free tier and paid subscriptions.

## Expected volume, if asked

    Low. Results are cached and shared across users, so requests scale with
    distinct products rather than with signups — comfortably within any
    standard rate limit.

---

## Before you close the tab

- **Screenshot the confirmation page**, including any reference number. This is
  the one thing four contacts have never produced, and it is what turns the next
  call into a continuation instead of another cold start.
- Note the date and time you submitted.
- If the form gives no confirmation at all, screenshot the submitted form itself
  — some record beats none.

## If nothing comes back

The roadmap says **5 Sept**. After that Best Buy is a post-launch nice-to-have
rather than something being waited on. You are shipping with four stores
including Walmart, which is a real comparison on its own.
