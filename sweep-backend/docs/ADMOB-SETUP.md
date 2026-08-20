# AdMob setup — what's left to do

The code side is done: the Kotlin conflict is fixed, the real `lib/ads.ts` is
restored, and the backend's server-side verification has been live and tested
for weeks. What remains is account setup, which nothing in this repo can do.

Until it's done the app uses **Google's test ad units**, which is what you want
for testing anyway — they always fill, and they can't get you suspended.

---

## 1. Create the AdMob account and app

<https://admob.google.com>

1. Sign up, then **Apps → Add app**
2. Platform **Android**. When asked whether the app is listed on a store,
   answer **no / not published yet** — Sweep is in closed testing, and you get
   a real App ID either way
3. Name it Sweep

Copy the **App ID**. It looks like `ca-app-pub-1234567890123456~1234567890`
(note the **`~`**).

ca-app-pub-5462924462242718~3822342819

## 2. Create the rewarded ad unit

**Ad units → Add ad unit → Rewarded**

- Name: anything, e.g. `Extra search`
- Reward amount **1**, item name `search` — cosmetic only. The backend decides
  what a reward is actually worth, not AdMob
- Copy the **unit ID**: `ca-app-pub-…/…` (note the **`/`**, not `~`)

ca-app-pub-5462924462242718/3650952420

## 3. Point it at the backend — don't skip this

In that ad unit's settings, find **Server-side verification (SSV)** and set the
callback URL to:

```
https://api.sweepshopping.com/ads/admob/ssv
```

That endpoint is already live, verifies Google's signature, and rejects
tampered `user_id`s, forged signatures and unknown key ids. Leave "custom
data" empty — the app sends the user id, not custom data.

**This is the step that makes the reward real.** Without it the video plays and
nothing is credited, because the app deliberately cannot grant searches itself.
It looks like a broken feature rather than a missing setting, which is why it's
worth doing at the same time as creating the unit.

## 4. Send the two IDs

- App ID — `ca-app-pub-…~…`
- Rewarded unit ID — `ca-app-pub-…/…`

They go in `app.json` and `EXPO_PUBLIC_ADMOB_REWARDED_UNIT_ID`. Both are safe
to commit; neither is a secret.

## 5. Then a build

Ads are a native module, so this needs a fresh EAS build and Play upload — not
an over-the-air update.

---

## Rules worth not breaking

**Never tap your own live ads.** Not once, not "just to check". AdMob calls it
invalid traffic and suspends accounts over it, and appeals rarely succeed. Test
units exist so this never has to be a judgement call.

**Keep test units until the build is on Play.** The app falls back to test
units whenever `EXPO_PUBLIC_ADMOB_REWARDED_UNIT_ID` is unset, so simply not
setting it during development is enough.

**Expect low fill at first.** A new AdMob app serves few ads for the first few
days while Google works out what the inventory is worth. Normal, not a bug in
the integration.

---

## What it earns

From `src/scale-model.ts`, roughly **$0.05 per free user per month**:

| Free users | Rewarded ads |
| ---------- | ------------ |
| 100        | ~$5/mo       |
| 1,000      | ~$53/mo      |
| 49,000     | ~$2,580/mo   |

The reason to do this now was never the money at current scale — it's that
toolchain fixes are easier before anyone depends on your build cadence.
