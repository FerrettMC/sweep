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

| Field   | Required | Notes                                                        |
| ------- | -------- | ------------------------------------------------------------ |
| `title` | yes      | 80 characters max                                            |
| `body`  | yes      | 300 characters max                                           |
| `href`  | no       | Must start with `/` — an in-app path like `/lookup` or `/plans` |
| `email` | no       | One person when present, everyone when absent                |

`href` is restricted to in-app paths on purpose: an announcement that could
carry an arbitrary URL would be a way to put a link to anywhere in front of
every user, which is worth not building.

## Note

This writes to the in-app feed only — it does **not** send a push. That's
deliberate for now: an announcement that buzzes every phone is a different
decision from one that appears in the app next time someone opens it, and the
quieter one is the right default while the userbase is small.
