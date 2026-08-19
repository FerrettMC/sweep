# Sending an announcement (and testing the bell)

`POST /notifications/announce`, guarded by a shared secret.

## Setup, once

Generate a key and set it as `ADMIN_API_KEY` on Railway. Any long random
string will do:

```
openssl rand -hex 32
```

Until it's set the endpoint refuses with 503 rather than defaulting open —
this writes to every user's screen, so an unauthenticated version of it is
worse than no version.

## Send yourself a test

With `email`, it goes to exactly one person. This is how to check the bell
without waiting for a real price drop.

```bash
curl -X POST https://api.sweepshopping.com/notifications/announce \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "email": "ferretonyt@gmail.com",
    "title": "Testing the bell",
    "body": "If you can see this, the notification feed works.",
    "href": "/lookup"
  }'
```

Then pull down on Home to refresh. The bell appears top right with a badge.

## Send to everyone

Leave `email` out.

```bash
curl -X POST https://api.sweepshopping.com/notifications/announce \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -H "content-type: application/json" \
  -d '{"title": "Etsy is live", "body": "Search now covers Etsy as well."}'
```

## Rules

| Field   | Required | Notes                                                           |
| ------- | -------- | --------------------------------------------------------------- |
| `title` | yes      | 80 characters max                                               |
| `body`  | yes      | 300 characters max                                              |
| `href`  | no       | Must start with `/` — an in-app path like `/lookup` or `/plans` |
| `email` | no       | One person when present, everyone when absent                   |

`href` is restricted to in-app paths on purpose: an announcement that could
carry an arbitrary URL would be a way to put a link to anywhere in front of
every user, which is worth not building.

## Testing a price-drop notification

`POST /notifications/test-drop` fires a real price-drop alert at one account,
so the push, the bell entry and the tap-through can all be checked without
waiting for a shop to actually cut a price.

```bash
curl -X POST https://api.sweepshopping.com/notifications/test-drop \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -H "content-type: application/json" \
  -d '{"email": "ferretonyt@gmail.com", "match": "train", "percent": 25}'
```

| Field     | Required | Notes                                                       |
| --------- | -------- | ----------------------------------------------------------- |
| `email`   | yes      | Whose account to notify                                      |
| `match`   | no       | Substring of a tracked product's title. Omit for the newest  |
| `percent` | no       | Size of the pretend drop, 1–89. Defaults to 20               |

If `match` finds nothing the error lists what that account is tracking, so the
next attempt doesn't need guessing.

It goes through the real notification path — same wording, same push channel,
same feed record, same cooldown — rather than a lookalike, because testing a
lookalike proves nothing about the code that actually runs. Three things make
it safe:

- **One recipient, always.** Even for a product several people track, it
  reaches only the named account. A test that can reach strangers is not a
  test.
- **No stored price changes.** Nothing is written to `Product` or price
  history, so this can't pollute the data the sale verdict is judged against.
- **The cooldown is cleared first**, so running it twice in a row works
  instead of silently doing nothing and looking broken.

### Reading the response

The bell entry is always filed. The push is the part that can fail quietly, so
the response says which stage it reached:

| Field               | Means                                                     |
| ------------------- | --------------------------------------------------------- |
| `devicesRegistered` | Push tokens on that account. **0 is the usual reason nothing buzzes** |
| `pushesAttempted`   | Messages handed to Expo — attempted, not delivered          |
| `pushOutcomes`      | What Expo said per message: `ok`, `DeviceNotRegistered`, or its error name |

**`devicesRegistered: 0`** — the app never registered this device. Open Sweep,
allow notifications when asked, and check Profile reports alerts as on. Note
that signing out deregisters the device on purpose, so a fresh sign-in has to
grant again.

**`pushOutcomes: ["ok"]` but nothing arrived** — Expo accepted it and Android
didn't show it. Usually notifications are blocked for Sweep in Android
settings, or the build predates the `price-drops` channel, which Android drops
silently when the channel doesn't exist.

**`pushOutcomes: ["DeviceNotRegistered"]`** — the token was stale; it has now
been deleted. Reopen the app to register a fresh one and try again.

**`pushOutcomes: ["InvalidCredentials"]`** — Expo could not authenticate with
Firebase, so nothing was sent. Nothing about the device, the token or the app
is wrong.

`google-services.json` in `android/app/` is only the **client** half: it tells
the app which Firebase project to register with. Expo also needs **server**
credentials to send on your behalf, and those live in the Expo project rather
than in this repo.

To fix, once:

1. Firebase console → your project → **Project settings** → **Service accounts**
2. **Generate new private key** — downloads a JSON file
3. In `sweep-app/`, run `eas credentials` → Android → your build profile →
   **Push Notifications: Manage your FCM V1 service account key** → upload it

It must be an **FCM V1 service account key**. Google removed the old server
keys in 2024, so any guide telling you to paste a "FCM server key" into Expo
is out of date.

Nothing needs rebuilding afterwards — this is server-side credentials, not app
config, so the next send just works.

## Note

This writes to the in-app feed only — it does **not** send a push. That's
deliberate for now: an announcement that buzzes every phone is a different
decision from one that appears in the app next time someone opens it, and the
quieter one is the right default while the userbase is small.
