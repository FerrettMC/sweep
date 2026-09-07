# sweep-ads

Turning the app on a phone into vertical posts for TikTok, Reels and Shorts.

Everything comes out **1080x1920** with captions burned in.

---

## Driving the app for you

`drive.py` scripts the phone over adb, so a demo run is one command and comes
out the same every time.

    ./drive.py run demos/search.json    the whole run, stills and all
    ./drive.py ls                       what's on screen right now
    ./drive.py tap "Search"             one step, for working out a new demo
    ./drive.py type "airpods pro 2"
    ./drive.py shot 01

Elements are found by their text rather than by coordinates, so a demo keeps
working when the layout moves or a different phone is plugged in. Hardcoded taps
break on both, and break silently: you get a video of the wrong screen and don't
notice until you're editing.

Two steps matter more than they sound:

**`hide_keyboard`** before every screenshot. The soft keyboard covers the bottom
half of the screen, which on a results page is most of the results.

**`demo` on** turns on Android's built-in demo mode, which pins a full battery,
full signal, a fixed clock and no notification icons. Real footage shows a 21%
battery and whatever notifications you happen to have. Always turn it off at the
end, or the phone keeps lying about its battery.

Writing a new demo: run `./drive.py ls` on each screen, copy the labels you need,
and string the steps together. Prefer `wait` over `sleep` for anything that hits
the network, because a search across five stores has no predictable duration.

---

## The workflow

Plug the phone in, then either record a run or grab stills.

**A reel, from a screen recording:**

    ./record.sh five-stores 25      # records, pulls to out/five-stores-raw.mp4
    ./make.py ads/five-stores.json  # renders out/five-stores.mp4

**A slideshow, from stills:**

    ./grab.sh live 01               # one screenshot at a time, as you navigate
    ./grab.sh live 02
    ./make.py ads/fake-sale.json

Or pull the stills out of a recording you already have, which is easier than
trying to catch the right moment by hand:

    ./grab.sh out/five-stores-raw.mp4 2.0 6.5 9.0 14.0

Then download `out/*.mp4` off this machine and post it yourself.

---

## Why it looks the way it does

**Padded, not blurred.** A phone screenshot is taller than 9:16, so it gets
scaled to fit and the gap filled with `#0D0D0D`, the app's own background. The
usual blurred-bars look makes on-screen text harder to read, and text is the
entire point here.

**Captions are burned in.** Text added in TikTok's editor disappears the moment
someone downloads and reposts the video. Burned-in text survives.

**There is always an audio track**, silent if you give it no music. Some
uploaders treat a video with no audio stream as corrupt and TikTok will
sometimes refuse it.

**Speed up the waiting.** A real search takes a few seconds per store. Nobody
watches that. `"speed": 2.0` on a reel fixes it. If anyone asks in the comments,
the real medians are Best Buy about 2s, Walmart about 8s, Amazon about 15s.

---

## The specs

One JSON file per ad in `ads/`. `_capture` is a note to yourself about what to
shoot, ignored by the renderer.

Slideshow slides take `image`, `caption`, `seconds`, and `position`
(`top` or `bottom`). Reels take `source`, `speed`, and a list of `captions` with
`start` and `end` in seconds.

Add `"music": "music/whatever.mp3"` to either. Use something you have the rights
to, or add the sound in the app after uploading, which is usually better anyway
since native sounds get more reach.

---

## Ad concepts in here

**fake-sale** is the one to make first. It is the only thing Sweep does that no
competitor can copy, it is visual, and it is a complete story in four frames.

**five-stores** is the plain demo. Best for people who have never heard of the
app, and the one to attach to press emails.

**dupe** leans on similar products. This is the one that fits beauty and fashion
creators, whose audiences care about finding the cheaper version rather than
about price history.

---

## Copy rules

Same as SELLINGPOINTS.md, and they matter more here because a caption has no
room for a caveat:

- Only name stores that are actually live
- Never "cheapest price", it is the cheapest of the stores Sweep checks
- Never a savings figure that isn't typical
- Never frame a subscription as supporting the developer
