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

## Set the OTP length to 6

Supabase → Authentication → Providers → Email → **Email OTP Length**. It
defaults to 8 and is valid from 6 to 10.

Six, because of how the code is actually used: it arrives in an email, so the
person reads it in their mail app and types it into Sweep. Six digits survive
that trip in one glance; eight means going back to check, and each round trip
is a chance to give up. The app accepts anything from 6 to 10, so changing
this needs no release.

While in there, **Minimum password length** should be 8, matching
`MIN_PASSWORD_LENGTH` in the app. If Supabase's is lower the app is simply
stricter, which is harmless; if it's higher, a password the app accepted gets
refused by the server.

## Why the plaintext looks the way it does

Supabase derives the plaintext copy of each email from the HTML, line by line.
The stock template puts every element on one line, which is why its plaintext
reads `CONFIRM YOUR EMAIL ADDRESSFollow the link below…` with the words run
together. Both templates here keep one block per line and one line per
paragraph so the derived text is readable. Worth preserving when editing.

## Sending *as* support@sweepshopping.com

Cloudflare Email Routing is **inbound only**. It forwards mail addressed to
`support@sweepshopping.com` into a personal inbox and gives no way to send from
that address — replies would go out as the personal one, which looks wrong on
anything official like an API application.

Gmail can send through Resend's SMTP, which the domain is already verified for.

1. Gmail → **Settings** → **See all settings** → **Accounts and Import**
2. **Send mail as** → **Add another email address**
3. Name `Sweep`, address `support@sweepshopping.com`, leave "Treat as an alias"
   ticked
4. SMTP details:

   | Field    | Value                            |
   | -------- | -------------------------------- |
   | Server   | `smtp.resend.com`                |
   | Port     | `465`                            |
   | Username | `resend`                         |
   | Password | a Resend API key                 |
   | Security | SSL                              |

5. Gmail sends a confirmation code to `support@sweepshopping.com`. Cloudflare
   forwards it to the personal inbox — paste it back in.

After that the From dropdown in Gmail offers the address, and replies to
forwarded support mail go out as `support@`.

Authentication works because DKIM is published on the root domain
(`resend._domainkey`), so a From of `@sweepshopping.com` aligns regardless of
which subdomain the envelope uses. There is no DMARC record, so nothing to
violate — worth adding one eventually, but not before there's traffic to
observe.

## Adding another address

Two steps, because inbound and outbound are separate systems.

**Receiving** — Cloudflare → your domain → **Email Routing** → **Routing rules**
→ **Create address**. Add the new address, forward it to the personal inbox.
Nothing else to configure; the MX records already exist.

**Sending as it** — repeat the Gmail "Send mail as" steps above with the new
address. Same Resend SMTP settings; only the address changes. Gmail sends a
confirmation code, Cloudflare forwards it, paste it back.

### Which addresses exist, and what they're for

| Address                    | Used for                                        |
| -------------------------- | ----------------------------------------------- |
| `support@sweepshopping.com`| Users. Listed in the app and on the site.        |
| `noreply@sweepshopping.com`| Outbound only — Supabase auth mail sends as this |
| `dev@sweepshopping.com`    | Developer/API applications                       |

Worth keeping this table current. Applications get answered weeks later, and
"which address did I apply with" is the kind of thing that is obvious now and
gone by then.

### On reapplying with a different address

Fine to do, and common with programmes that go quiet — this is a signup form on
your own domain, not a second identity. Two things worth keeping straight:

- **Use the same details otherwise.** Same app, same description, same use
  case. The address is the only thing changing.
- **Note the date you applied**, per address, in the table above. If both
  eventually answer, you want to know which thread is which.

## Reusing it for scraper alerts

The backend already sends health alerts through nodemailer using generic
`SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` (see `src/lib/health.ts`).
The same Resend credentials work there — same host, port, username, and API
key — so both paths can run through one provider instead of two.

## Checking it later

Deliverability degrades quietly. Resend's dashboard shows bounces and
complaints; a rising bounce rate usually means signups with mistyped domains,
which is what the typo guard on the signup screen exists to reduce.
