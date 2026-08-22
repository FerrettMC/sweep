// routes/videoMock.ts
//
// A recordable mock of the product page, at /video.
//
// WHY THIS EXISTS, and the honest bit first: the demo everyone reaches for is
// a shop's "40% off" badge next to Sweep's own price history showing the price
// hasn't moved in a month. Sweep can genuinely do that. It cannot do it TODAY,
// because the app is new and no product has a month of recorded history yet.
//
// So this reproduces the real screen with plausible data, for filming. It is a
// product demo — "this is what Sweep does" — and it uses the app's actual
// palette, spacing and wording so it isn't misrepresenting the interface
// either. It should not be captioned as a specific deal that was caught.
// Reshoot with real data once the history exists; the whole point of the app
// is that the data is real.
//
// Built for recording rather than for reading:
//   - Fixed 1080x1920 stage, so a phone screen recording needs no cropping
//   - Nothing animates until you press a key, so takes are repeatable
//   - Space steps through the beats, R resets
//
// Not linked from anywhere and marked noindex. It exists to be filmed.

import type { FastifyInstance } from "fastify";

export async function videoMockRoutes(app: FastifyInstance) {
  app.get("/video", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return reply.send(PAGE);
  });
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Sweep — recording mock</title>
<style>
  :root {
    --bg: #0D0D0D; --surface: #1A1A1A; --border: #2A2A2A;
    --accent: #D85A30; --text: #F5F5F5; --dim: #999999; --faint: #6B6B6B;
    --good: #3DA35D; --bad: #E5484D; --warn: #E0A030;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #000; color: var(--text); min-height: 100vh;
    display: grid; place-items: center; overflow: hidden;
    font: 400 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  /* 1080x1920 scaled to fit whatever window it's recorded in. */
  #stage {
    width: 1080px; height: 1920px; background: var(--bg);
    transform-origin: center; position: relative; overflow: hidden;
    padding: 90px 70px;
  }
  .beat { opacity: 0; transition: opacity .45s ease, transform .45s ease; transform: translateY(18px); }
  .beat.on { opacity: 1; transform: none; }

  .store { display: flex; align-items: center; gap: 16px; margin-bottom: 26px; }
  .dot { width: 20px; height: 20px; border-radius: 10px; background: #FF9900; }
  .storeName { color: var(--dim); font-size: 30px; font-weight: 700; letter-spacing: .04em; }

  h1 { font-size: 58px; line-height: 1.18; font-weight: 800; margin-bottom: 34px; }

  .badge {
    display: inline-block; background: var(--bad); color: #fff;
    font-size: 40px; font-weight: 900; padding: 14px 26px; border-radius: 12px;
    margin-bottom: 30px;
  }
  .prices { display: flex; align-items: baseline; gap: 26px; margin-bottom: 56px; }
  .now { font-size: 88px; font-weight: 900; letter-spacing: -.02em; }
  .was { font-size: 44px; color: var(--faint); text-decoration: line-through; }

  .card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 26px; padding: 40px; margin-bottom: 34px;
  }
  .cardTitle {
    font-size: 26px; font-weight: 800; color: var(--dim);
    text-transform: uppercase; letter-spacing: .09em; margin-bottom: 26px;
  }

  /* the chart */
  #chart { position: relative; height: 340px; }
  .axis { position: absolute; right: 0; font-size: 24px; color: var(--faint); }
  .seg { position: absolute; height: 6px; background: var(--accent); border-radius: 3px; }
  .pt { position: absolute; width: 22px; height: 22px; border-radius: 11px;
        border: 5px solid var(--surface); background: var(--accent); }
  .flat {
    position: absolute; left: 0; bottom: 96px; font-size: 30px; color: var(--dim);
    background: rgba(26,26,26,.94); padding: 12px 20px; border-radius: 10px;
    border: 1px solid var(--border);
  }
  .dates { display: flex; justify-content: space-between; margin-top: 22px;
           font-size: 24px; color: var(--faint); }

  .verdict { display: flex; gap: 26px; align-items: flex-start; }
  .vIcon { font-size: 44px; line-height: 1; }
  .vTitle { font-size: 40px; font-weight: 800; margin-bottom: 12px; color: var(--warn); }
  .vBody { font-size: 30px; color: var(--dim); line-height: 1.45; }

  #end {
    position: absolute; inset: 0; background: var(--bg);
    display: grid; place-content: center; text-align: center; gap: 26px;
    opacity: 0; pointer-events: none; transition: opacity .5s ease;
  }
  #end.on { opacity: 1; }
  #end .mark { font-size: 130px; font-weight: 900; color: var(--accent); letter-spacing: -.03em; }
  #end .line { font-size: 42px; color: var(--dim); }

  #hint {
    position: fixed; bottom: 14px; left: 50%; transform: translateX(-50%);
    color: #555; font-size: 13px; font-family: ui-monospace, monospace;
  }
</style>
</head>
<body>

<div id="stage">
  <div class="beat" id="b1">
    <div class="store"><div class="dot"></div><div class="storeName">AMAZON</div></div>
    <h1>Sony WH-1000XM5<br>Wireless Headphones</h1>
    <div class="badge">40% OFF</div>
    <div class="prices"><div class="now">$239.99</div><div class="was">$399.99</div></div>
  </div>

  <div class="beat" id="b2">
    <div class="card">
      <div class="cardTitle">Price history</div>
      <div id="chart"></div>
      <div class="dates"><span id="d0">22 Jul</span><span id="d1">22 Aug</span></div>
    </div>
  </div>

  <div class="beat" id="b3">
    <div class="card">
      <div class="verdict">
        <div class="vIcon">⚠️</div>
        <div>
          <div class="vTitle">This isn't really a sale</div>
          <div class="vBody">It's been $239.99 for the last 31 days.
          The "40% off" is against a price nobody has paid.</div>
        </div>
      </div>
    </div>
  </div>

  <div id="end">
    <div class="mark">Sweep</div>
    <div class="line">Know when a sale is real.</div>
    <div class="line" style="font-size:32px;color:#6B6B6B">Free on Google Play</div>
  </div>
</div>

<div id="hint">SPACE = next beat &nbsp;·&nbsp; R = reset &nbsp;·&nbsp; H = hide this</div>

<script>
  // Scale the fixed 1080x1920 stage to whatever window it's recorded in, so a
  // screen recording of any size still fills the frame exactly.
  function fit() {
    var s = Math.min(window.innerWidth / 1080, window.innerHeight / 1920);
    document.getElementById("stage").style.transform = "scale(" + s + ")";
  }
  window.addEventListener("resize", fit);
  fit();

  // A month of readings that never move, then the "drop" that isn't one.
  // Flat on purpose: the whole point is that the discount is against a price
  // the item has never actually been sold at recently.
  var PRICES = [];
  for (var i = 0; i < 31; i++) PRICES.push(239.99);

  function drawChart() {
    var el = document.getElementById("chart");
    el.innerHTML = "";
    var W = el.clientWidth, H = el.clientHeight, INSET = 30;
    var lo = 200, hi = 420;               // axis range, so flat sits mid-height
    var x = function (i) { return INSET + (i / (PRICES.length - 1)) * (W - INSET * 2); };
    var y = function (p) { return INSET + (1 - (p - lo) / (hi - lo)) * (H - INSET * 2); };

    var top = document.createElement("div");
    top.className = "axis"; top.style.top = "0"; top.textContent = "$420";
    var bot = document.createElement("div");
    bot.className = "axis"; bot.style.bottom = "0"; bot.textContent = "$200";
    el.appendChild(top); el.appendChild(bot);

    for (var i = 1; i < PRICES.length; i++) {
      var x1 = x(i - 1), y1 = y(PRICES[i - 1]), x2 = x(i), y2 = y(PRICES[i]);
      var len = Math.hypot(x2 - x1, y2 - y1);
      var seg = document.createElement("div");
      seg.className = "seg";
      seg.style.left = ((x1 + x2) / 2 - len / 2) + "px";
      seg.style.top = ((y1 + y2) / 2 - 3) + "px";
      seg.style.width = len + "px";
      seg.style.transform = "rotate(" + (Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI) + "deg)";
      el.appendChild(seg);
    }

    var pt = document.createElement("div");
    pt.className = "pt";
    pt.style.left = (x(PRICES.length - 1) - 11) + "px";
    pt.style.top = (y(PRICES[PRICES.length - 1]) - 11) + "px";
    el.appendChild(pt);

    var flat = document.createElement("div");
    flat.className = "flat";
    flat.textContent = "Unchanged for 31 days";
    el.appendChild(flat);
  }

  var beats = ["b1", "b2", "b3"];
  var at = 0;

  function reset() {
    at = 0;
    beats.forEach(function (id) { document.getElementById(id).className = "beat"; });
    document.getElementById("end").className = "";
  }

  function next() {
    if (at < beats.length) {
      document.getElementById(beats[at]).className = "beat on";
      if (beats[at] === "b2") setTimeout(drawChart, 60);
      at++;
    } else {
      document.getElementById("end").className = "on";
    }
  }

  document.addEventListener("keydown", function (e) {
    if (e.code === "Space") { e.preventDefault(); next(); }
    if (e.key === "r" || e.key === "R") reset();
    if (e.key === "h" || e.key === "H") {
      var h = document.getElementById("hint");
      h.style.display = h.style.display === "none" ? "block" : "none";
    }
  });
</script>
</body>
</html>`;
