// routes/videoMock.ts
//
// One phone screen of the product page, at /video, for filming.
//
// WHY IT EXISTS, honestly: the demo worth showing is Sweep confirming a drop
// is real — a price that sat at one level for weeks and has genuinely fallen,
// with our own recorded history as the evidence. Sweep does exactly that, but
// not today: the app is new and nothing has a month of recorded history yet.
//
// So this reproduces the real product screen with plausible data, in the app's
// actual palette and wording. It is B-ROLL for a video where the talking does
// the work: one screen, everything visible at once, nothing to press and
// nothing to wait for.
//
// It is a demo of what the app does, not a deal that was found. Reshoot with
// real history once it exists — the pitch is that the data is real.
//
// Sized for a phone viewport, so it can be opened on the phone and screen
// recorded directly. Not linked from anywhere, marked noindex, and safe to
// delete the day it stops being useful.

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
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#0D0D0D">
<title>Sweep</title>
<style>
  :root {
    --bg: #0D0D0D; --surface: #1A1A1A; --border: #2A2A2A;
    --accent: #D85A30; --text: #F5F5F5; --dim: #999999; --faint: #6B6B6B;
    --bad: #E5484D; --warn: #E0A030; --good: #3DA35D;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  html, body { height: 100%; }
  body {
    background: var(--bg); color: var(--text);
    font: 400 16px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    padding: env(safe-area-inset-top) 20px 20px;
    display: flex; flex-direction: column; justify-content: center; gap: 14px;
    overflow: hidden;
  }

  .store { display: flex; align-items: center; gap: 8px; }
  .dot { width: 9px; height: 9px; border-radius: 5px; background: #FF9900; }
  .storeName { color: var(--dim); font-size: 13px; font-weight: 700; letter-spacing: .05em; }

  h1 { font-size: 21px; line-height: 1.25; font-weight: 800; }

  .row { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .now { font-size: 34px; font-weight: 900; letter-spacing: -.02em; }
  .was { font-size: 17px; color: var(--faint); text-decoration: line-through; }
  .badge {
    background: var(--bad); color: #fff; font-size: 13px; font-weight: 900;
    padding: 5px 10px; border-radius: 7px;
  }

  .card { background: var(--surface); border: 1px solid var(--border);
          border-radius: 14px; padding: 14px; }
  .cardTitle { font-size: 11px; font-weight: 800; color: var(--dim);
               text-transform: uppercase; letter-spacing: .09em; margin-bottom: 10px; }

  #chart { position: relative; height: 120px; }
  .axis { position: absolute; right: 0; font-size: 11px; color: var(--faint); }
  .seg { position: absolute; height: 3px; background: var(--accent); border-radius: 2px; }
  .pt { position: absolute; width: 11px; height: 11px; border-radius: 6px;
        border: 3px solid var(--surface); background: var(--accent); }
  .flat { position: absolute; left: 0; top: 8px; font-size: 12px; color: var(--dim);
          background: rgba(26,26,26,.94); padding: 5px 9px; border-radius: 6px;
          border: 1px solid var(--border); }
  .dates { display: flex; justify-content: space-between; margin-top: 8px;
           font-size: 11px; color: var(--faint); }

  .verdict { display: flex; gap: 10px; align-items: flex-start; }
  .vIcon { font-size: 17px; line-height: 1.3; }
  .vTitle { font-size: 15px; font-weight: 800; color: var(--good); margin-bottom: 3px; }
  .vBody { font-size: 13px; color: var(--dim); line-height: 1.4; }
</style>
</head>
<body>

  <div class="store"><div class="dot"></div><div class="storeName">AMAZON</div></div>
  <h1>Sony WH-1000XM5 Wireless Noise Cancelling Headphones</h1>

  <div class="row">
    <div class="now">$239.99</div>
    <div class="was">$399.99</div>
    <div class="badge">40% OFF</div>
  </div>

  <div class="card">
    <div class="cardTitle">Price history</div>
    <div id="chart"></div>
    <div class="dates"><span>22 Jul</span><span>22 Aug</span></div>
  </div>

  <div class="card">
    <div class="verdict">
      <div class="vIcon">&#9989;</div>
      <div>
        <div class="vTitle">Lowest price we've seen</div>
        <div class="vBody">Across 31 checks this has never been cheaper. It sat at $399.99 for weeks.</div>
      </div>
    </div>
  </div>

<script>
  // A month at one price, then a genuine fall. This is the shape Sweep exists
  // to prove: the discount is real BECAUSE the history shows what came before
  // it. A flat line would be the opposite story.
  var PRICES = [];
  for (var i = 0; i < 24; i++) PRICES.push(399.99);
  PRICES.push(389.99, 379.99, 359.99, 329.99, 289.99, 259.99, 239.99);
  var DAYS = PRICES.length;

  function draw() {
    var el = document.getElementById("chart");
    el.innerHTML = "";
    var W = el.clientWidth, H = el.clientHeight, PAD = 14;
    var lo = 200, hi = 420;
    var x = function (i) { return PAD + (i / (DAYS - 1)) * (W - PAD * 2); };
    var y = function (p) { return PAD + (1 - (p - lo) / (hi - lo)) * (H - PAD * 2); };

    var top = document.createElement("div");
    top.className = "axis"; top.style.top = "0"; top.textContent = "$420";
    var bot = document.createElement("div");
    bot.className = "axis"; bot.style.bottom = "0"; bot.textContent = "$200";
    el.appendChild(top); el.appendChild(bot);

    for (var i = 1; i < DAYS; i++) {
      var x1 = x(i - 1), y1 = y(PRICES[i - 1]);
      var x2 = x(i), y2 = y(PRICES[i]);
      var len = Math.hypot(x2 - x1, y2 - y1);
      var seg = document.createElement("div");
      seg.className = "seg";
      seg.style.left = ((x1 + x2) / 2 - len / 2) + "px";
      seg.style.top = ((y1 + y2) / 2 - 1.5) + "px";
      seg.style.width = len + "px";
      seg.style.transform = "rotate(" + (Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI) + "deg)";
      el.appendChild(seg);
    }

    var pt = document.createElement("div");
    pt.className = "pt";
    pt.style.background = "#3DA35D";
    pt.style.left = (x(DAYS - 1) - 5.5) + "px";
    pt.style.top = (y(PRICES[DAYS - 1]) - 5.5) + "px";
    el.appendChild(pt);

    var drop = document.createElement("div");
    drop.className = "flat";
    drop.style.color = "#3DA35D";
    drop.textContent = "Dropped $160 this week";
    el.appendChild(drop);
  }

  draw();
  window.addEventListener("resize", draw);
</script>
</body>
</html>`;
