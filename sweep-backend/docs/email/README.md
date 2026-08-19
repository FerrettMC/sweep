# Transactional email

## Why this matters more than it looks

Supabase's built-in mailer is rate-limited to a handful of messages per hour
**for the entire project**, and that limit applies to real signups, not just
testing. With email confirmation required — which it is — a rate-limited
confirmation email is a signup that fails silently: the person waits on the
confirmation screen for a message that never arrives, and nothing in the app
or the logs says why.

That makes custom SMTP part of the signup funnel rather than a nicety.

## The DNS trap

`sweepshopping.com` receives mail through **Cloudflare Email Routing**, which
owns the root domain's MX and SPF records:

```
MX   route1.mx.cloudflare.net (and route2, route3)
TXT  v=spf1 include:_spf.mx.cloudflare.net ~all
```

**A domain may only have one SPF record.** Adding a second one doesn't merge —
it invalidates both, and `support@sweepshopping.com` stops receiving mail.

Resend's standard setup avoids this by design: its SPF and bounce-handling MX
go on the `send.sweepshopping.com` subdomain, and DKIM goes on the
`resend._domainkey` selector. None of those collide with the root records, and
mail can still be sent **from** `@sweepshopping.com` because DKIM aligns at the
root.

So: add exactly the records Resend gives you, and **do not touch the root MX or
root SPF**. If any guide tells you to replace them, it hasn't accounted for
inbound routing already being there.

## Setup

1. Resend → add domain `sweepshopping.com`. Add the records it lists
   (`send.` MX, `send.` TXT SPF, `resend._domainkey` TXT DKIM) in Cloudflare
   DNS. Leave everything else alone.
2. Wait for Resend to show the domain verified.
3. Create an API key.
4. Supabase → Project Settings → Authentication → SMTP Settings → enable, then:

   | Field       | Value                       |
   | ----------- | --------------------------- |
   | Host        | `smtp.resend.com`           |
   | Port        | `465`                       |
   | Username    | `resend`                    |
   | Password    | the API key                 |
   | Sender email| `noreply@sweepshopping.com` |
   | Sender name | `Sweep`                     |

5. Supabase → Authentication → Emails → Confirm signup → paste
   `confirm-signup.html` from this folder. Subject: `Confirm your email`.
6. Same page → **Reset Password** → paste `reset-password.html`. Subject:
   `Your Sweep password reset code`. **Do this one even if you skip the
   others** — see below.
7. Sign up with a real address, then run a password reset, and confirm both
   arrive and look right.

## The reset template is not cosmetic

Supabase's stock reset email contains only `{{ .ConfirmationURL }}` — a link.
The app never uses that link: `ForgotPasswordSheet` asks for a **code** and
calls `verifyOtp` with type `recovery`. With the stock template the email does
not contain the code the app is asking for, so password reset cannot be
completed at all.

`reset-password.html` uses `{{ .Token }}`, which is the code.

It deliberately offers no link as an alternative. Following one signs you in on
whichever device opened the email — for a reset read on a laptop, that's the
wrong device, and the phone is still sitting there asking for a code. One route
through, and it's the one the app implements.

## Why the plaintext looks the way it does

Supabase derives the plaintext copy of each email from the HTML, line by line.
The stock template puts every element on one line, which is why its plaintext
reads `CONFIRM YOUR EMAIL ADDRESSFollow the link below…` with the words run
together. Both templates here keep one block per line and one line per
paragraph so the derived text is readable. Worth preserving when editing.

## Reusing it for scraper alerts

The backend already sends health alerts through nodemailer using generic
`SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` (see `src/lib/health.ts`).
The same Resend credentials work there — same host, port, username, and API
key — so both paths can run through one provider instead of two.

## Checking it later

Deliverability degrades quietly. Resend's dashboard shows bounces and
complaints; a rising bounce rate usually means signups with mistyped domains,
which is what the typo guard on the signup screen exists to reduce.
