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

Done!

That endpoint is already live, verifies Google's signature, and rejects
tampered `user_id`s, forged signatures and unknown key ids. Leave "custom
data" empty — the app sends the user id, not custom data.

**This is the step that makes the reward real.** Without it the video plays and
nothing is credited, because the app deliberately cannot grant searches itself.
It looks like a broken feature rather than a missing setting, which is why it's
worth doing at the same time as creating the unit.

## The one-line switch at public launch

Both IDs are recorded. The app id is already live in `app.json` — it identifies
the app and requests nothing on its own.

The **rewarded unit id is deliberately NOT set anywhere yet**:

```
ca-app-pub-5462924462242718/3650952420
```

`eas.json`'s `production` profile is what builds Play uploads, and that
includes **closed-test** uploads. Setting the unit id there before launch would
ship real ad requests to testers while AdMob review is still pending — and any
tap by you or a tester is invalid traffic, which suspends accounts.

While it's unset, every profile falls back to Google's test units. That is the
safe default and it needs no discipline to maintain.

**At public launch**, add it to `eas.json` → `build.production.env`:

```json
"EXPO_PUBLIC_ADMOB_REWARDED_UNIT_ID": "ca-app-pub-5462924462242718/3650952420"
```

then build with the production profile. That build is the first one that serves
real ads.

## 4. The two IDs, for reference

- App ID — `ca-app-pub-5462924462242718~3822342819` — **live in `app.json`**
- Rewarded unit ID — `ca-app-pub-5462924462242718/3650952420` — **held back until launch, see above**

Neither is a secret; both are safe to commit.

## 5. Then a build

Ads are a native module, so this needs a fresh EAS build and Play upload — not
an over-the-air update.

---

## "Reward is taking a moment to land" — expected with test ads

The reward will **never** be credited while the app is serving Google's demo ad
unit, and that is not a bug.

The server-side verification URL is configured on *your* ad unit inside *your*
AdMob account. Google's public test unit (`ca-app-pub-3940256099942544/…`, the
one with the stock video) belongs to Google — it has no knowledge of your
callback URL, so nothing ever calls the backend, so nothing is credited. The
app polls for six seconds, gives up, and says so.

Seeing that message actually confirms most of the chain: the SDK initialised,
an ad loaded and played, `EARNED_REWARD` fired (otherwise it would say the ad
was closed early), and **the app correctly refused to grant the reward
itself** — which is the whole security property.

### Testing the full loop before public launch

You don't have to wait. Register the device as a test device against your own
ad unit:

1. AdMob → **Settings → Test devices → Add test device**
2. Add your phone (AdMob lists recently seen devices, or take the device id
   from logcat: `Use RequestConfiguration.Builder.setTestDeviceIds(...)`)
3. Temporarily set `EXPO_PUBLIC_ADMOB_REWARDED_UNIT_ID` to the real unit and
   build

A registered test device is served **test ads on your real unit**. That means
Google fires the SSV callback to your URL, so the search actually gets
credited — while the impression stays a test impression, earns nothing, and
counts as neither real traffic nor invalid traffic.

That is the sanctioned way to test rewards end to end, and the only way to
prove the backend half works before there are real ads.

**Remember to unset the unit id again afterwards** if launch hasn't happened,
for the reason in the section above.

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
