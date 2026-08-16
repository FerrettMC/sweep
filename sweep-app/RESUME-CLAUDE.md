# Getting back into the Claude Code session

## The short version

```bash
cd /home/ferret/Sweep
claude --continue
```

`--continue` (short: `-c`) reopens the most recent session for this directory.
`--resume` (short: `-r`) shows a picker instead, if you want an older one.

**The directory matters.** Sessions are keyed to the folder they were started
in. Running `claude -c` from your home folder or from `sweep-app/` will not find
this conversation — it has to be `/home/ferret/Sweep`.

## Where it actually lives

```
~/.claude/projects/-home-ferret-Sweep/989adf7e-7a8f-4e3d-ad87-8b501279a68d.jsonl
```

That is this session. It is written continuously while you work, not saved on
exit, so closing VS Code or losing power does not lose the conversation.

To reopen this exact one rather than whatever was most recent:

```bash
claude --resume 989adf7e-7a8f-4e3d-ad87-8b501279a68d
```

The VS Code extension also lists recent sessions. If this one isn't showing
there, the commands above still work.

## Your code is separate from the chat

The chat and the working tree are independent. Closing the editor never touches
your files. But an uncommitted working tree is the thing actually worth
protecting — commit before stepping away from anything you'd hate to redo.

---

# Where we left off (16 Aug 2026)

Everything is committed. Both projects typecheck clean; all test suites pass.

## Billing — half done, and the half that's done is the risky half

**Backend is finished and tested.** `POST /webhooks/revenuecat` turns
subscription events into `Wallet.tier` + `tierExpiresAt`. `npm run test:billing`
covers 12 cases including the two that are easy to get wrong: a cancellation
does *not* revoke access (it only stops auto-renew), and a retried out-of-order
renewal can't shorten a subscription.

**App side is written but inert.** The plans screen has buy buttons that appear
only when RevenueCat has a matching product, so it ships safely with nothing
configured. `Purchases.logIn()` sets RevenueCat's `app_user_id` to the Supabase
user id — that is what lets the webhook find the wallet.

### Next steps, in order

1. **Upload the current build.** Its job is to put the Play Billing Library in
   front of Play, which is what unlocks Monetize → Subscriptions. Play refuses
   to let you create products until it sees billing in an uploaded bundle —
   that's the chicken-and-egg that blocked us.
2. **Create the products**: `pro` and `ultimate`, monthly + yearly, 7-day trial
   on each.
3. **RevenueCat**: connect Play (service account JSON), create entitlements
   named exactly **`pro`** and **`ultimate`**, lowercase, attach the products.
4. **Webhook**: `https://api.sweepshopping.com/webhooks/revenuecat`, with an
   Authorization header you invent (`openssl rand -hex 32`). Same value into
   Railway as `REVENUECAT_WEBHOOK_SECRET`.
5. **Add `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`** (the `goog_` one) to all three
   eas.json profiles and `.env`, then rebuild. EAS rejects empty values, so the
   key is absent rather than blank until it's real.
6. **License testers**: Play Console → Settings → License testing. Those
   accounts buy for free and get compressed renewal periods, so renewal and
   expiry are testable inside the test window.

**The one thing to double-check:** entitlements must be `pro` and `ultimate`,
lowercase. A mismatch means purchases succeed while the tier silently stays
free, and that failure is invisible until someone complains they paid for
nothing.

## Also landed today

- **Etsy is live** — three working stores now (Amazon, eBay, Etsy). Its auth
  needs `keystring:shared_secret`; the keystring alone returns 403. Search
  ignores `includes=Images`, so listings are fetched again via the batch
  endpoint, which honours it.
- **Quota races fixed.** Five of seven consumers could be raced, and worse, the
  daily rollover itself raced — reading a quota *wrote* one when the window
  expired, so concurrent requests each reset the counter. `npm run
  test:concurrency` fires simultaneous requests at every limit. Any new metered
  feature belongs in that file.
- **Tests no longer touch production.** `.env.test` points at a dev Supabase
  project, and `testEnv.ts` refuses to run if the target looks like production.
  Escape hatch is `ALLOW_PRODUCTION_TESTS=yes-really`.
- **Crash reporting** is live via Sentry, with source maps uploading.
- **Landing page** at `/`, including a "who makes it" section.

## Still open

- Best Buy API key — still pending approval, applied 15 Aug. Adapter is written
  and waiting; drop `bestbuy` from `DISABLED_RETAILERS` when it arrives.
- Ads for extra searches — backend SSV is done and tested; blocked on the AdMob
  Kotlin toolchain conflict. Deliberately *not* bundled with billing, so a
  failed native build has one suspect rather than two.
- `ROADMAP.md` has the full feature list, with reasoning for what was parked.

## Three Play declarations that flip together

Ads, in-app purchases, and (already done) crash logs. When billing ships,
update **Data safety** and the **content rating** answer about purchasing
digital goods in the same release.
