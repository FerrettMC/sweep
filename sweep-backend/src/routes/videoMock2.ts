// routes/videoMock2.ts
//
// The second piece of b-roll, at /video2. Product lookup, start to finish.
//
// Where /video is a montage of features, this one follows a single job all the
// way through: search once, see who is actually cheapest, open the thing, and
// get everything the store publishes in one page. That is the app's real shape,
// and it is what the voiceover is written against.
//
// Captions are burned in rather than added later. Sweep's own timings drive
// them, so a line can never drift out of sync with the screen it describes —
// and it means the recording is finished the moment it is captured.
//
// EVERY string here is copied from the app: section headers out of
// lib/i18n/translations.ts, the verdict line out of lib/saleVerdict.ts. If the
// app's wording changes this becomes a lie, which is the one way this file
// rots.
//
// The stores shown are the ones actually live, checked against
// /search/retailers rather than remembered. Demoing a store nobody can use is
// the kind of detail people notice.
//
// The inflated discount belongs to a "Marketplace seller" and no named brand.
// Inflated list prices are overwhelmingly a third-party-seller behaviour, so
// this is both the accurate framing and the one that puts no words in a real
// retailer's mouth.
//
// One rule when editing: this page lives inside a TypeScript template literal,
// so a lone backslash becomes a real line break in the served JavaScript.
// Nothing here uses one. Keep it that way.
//
// Not linked anywhere, marked noindex, safe to delete when it stops being
// useful.

import type { FastifyInstance } from "fastify";

export async function videoMock2Routes(app: FastifyInstance) {
  app.get("/video2", async (_request, reply) => {
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
  /* Straight from constants/theme.ts, dark palette. */
  :root {
    --bg: #0D0D0D; --surface: #1A1A1A; --raised: #212121; --border: #2A2A2A;
    --accent: #D85A30; --text: #F5F5F5; --dim: #999999; --faint: #6B6B6B;
    --good: #3DA35D; --warn: #E0A030; --bad: #E5484D;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body {
    background: var(--bg); color: var(--text); overflow: hidden;
    font: 400 16px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    display: flex; flex-direction: column;
    padding: calc(env(safe-area-inset-top) + 18px) 18px 0;
  }

  .scene { display: none; flex-direction: column; gap: 11px; flex: 1; min-height: 0; }
  .scene.on { display: flex; }

  h2 { font-size: 21px; font-weight: 800; line-height: 1.15; letter-spacing: -.01em; }
  .eyebrow {
    font-size: 11px; font-weight: 800; color: var(--accent);
    text-transform: uppercase; letter-spacing: .1em;
  }
  .sectionTitle {
    font-size: 12px; font-weight: 800; color: var(--dim);
    text-transform: uppercase; letter-spacing: .07em; margin-top: 3px;
  }

  /* --- search box, matching the home hero --- */
  .search {
    display: flex; align-items: center; gap: 9px;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; padding: 13px 14px; font-size: 15px;
  }
  .caret { width: 2px; height: 17px; background: var(--accent); animation: blink 1s steps(2) infinite; }
  @keyframes blink { 50% { opacity: 0; } }

  /* --- browser tabs piling up, the "before" picture --- */
  .tabs { display: flex; flex-direction: column; gap: 8px; }
  .tab {
    display: flex; align-items: center; gap: 9px;
    background: var(--raised); border: 1px solid var(--border);
    border-radius: 10px; padding: 11px 13px; font-size: 14px;
    opacity: 0; transform: translateY(10px) scale(.98);
    animation: pop .38s ease forwards;
  }
  .fav { width: 11px; height: 11px; border-radius: 3px; flex: none; }
  .tabPrice { margin-left: auto; font-weight: 800; font-size: 15px; }
  .tabSub { margin-left: auto; font-size: 12px; color: var(--faint);
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* --- a store result row --- */
  .row {
    display: flex; align-items: center; gap: 10px;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; padding: 11px 13px;
    opacity: 0; transform: translateY(8px);
    animation: pop .4s ease forwards;
  }
  @keyframes pop { to { opacity: 1; transform: none; } }
  .dot { width: 9px; height: 9px; border-radius: 5px; flex: none; }
  .store { font-size: 12px; color: var(--dim); font-weight: 700; width: 60px; flex: none; }
  .title { font-size: 13px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .price { font-size: 16px; font-weight: 800; flex: none; }
  .best { color: var(--good); }

  /* --- highlight cards, as HighlightCard.tsx renders them --- */
  .hl {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 14px; padding: 12px 13px;
    opacity: 0; animation: pop .45s ease forwards;
  }
  .hlBadge {
    font-size: 10px; font-weight: 900; letter-spacing: .05em;
    color: var(--accent); text-transform: uppercase; margin-bottom: 5px;
  }
  .hlBadge.claim { color: var(--warn); }
  .hlTitle { font-size: 13px; margin-bottom: 3px; }
  .hlReason { font-size: 12px; color: var(--faint); }

  /* --- the lookup page --- */
  .head { display: flex; gap: 12px; align-items: flex-start; }
  .thumb { width: 60px; height: 60px; border-radius: 10px; background: #262626; flex: none; }
  .pname { font-size: 14px; font-weight: 700; line-height: 1.3; }
  .pprice { font-size: 24px; font-weight: 900; margin-top: 4px; }
  .stars { font-size: 12px; color: var(--dim); margin-top: 2px; }

  .panel {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 13px; padding: 12px 13px;
  }
  .mentions { display: flex; gap: 14px; font-size: 12px; font-weight: 700; margin-bottom: 8px; }
  .pos { color: var(--good); } .neg { color: var(--bad); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    font-size: 11px; color: var(--dim); background: var(--raised);
    border: 1px solid var(--border); border-radius: 999px; padding: 4px 9px;
  }
  .ship { font-size: 13px; }
  .shipSub { font-size: 12px; color: var(--faint); margin-top: 2px; }

  /* --- price history --- */
  .graph { background: var(--surface); border: 1px solid var(--border);
           border-radius: 13px; padding: 12px 13px 8px; }
  .graph svg { width: 100%; height: 74px; display: block; }
  .line { fill: none; stroke: var(--accent); stroke-width: 2.5;
          stroke-linecap: round; stroke-linejoin: round;
          stroke-dasharray: 420; stroke-dashoffset: 420;
          animation: draw 1.5s ease forwards; }
  @keyframes draw { to { stroke-dashoffset: 0; } }
  .axis { display: flex; justify-content: space-between; font-size: 11px;
          color: var(--faint); margin-top: 5px; }

  /* --- the verdict card, from lookup's "Is this sale real?" --- */
  .verdict { border-radius: 13px; padding: 13px;
             background: var(--surface); border: 1px solid var(--warn); }
  .verdict.good { border-color: var(--good); }
  .vHead { font-size: 15px; font-weight: 800; color: var(--warn); line-height: 1.25; }
  .verdict.good .vHead { color: var(--good); }
  .vBody { font-size: 12px; color: var(--dim); margin-top: 5px; line-height: 1.4; }

  /* --- burned-in captions --- */
  .caption {
    position: fixed; left: 0; right: 0; bottom: calc(env(safe-area-inset-bottom) + 34px);
    text-align: center; padding: 0 26px;
    font-size: 25px; font-weight: 900; line-height: 1.2; letter-spacing: -.01em;
    color: #fff;
    /* An outline rather than a box, so it reads over any part of the UI. */
    text-shadow: 0 2px 5px rgba(0,0,0,.85), 0 0 2px rgba(0,0,0,.95),
                 2px 0 0 #000, -2px 0 0 #000, 0 2px 0 #000, 0 -2px 0 #000;
    animation: capIn .32s ease both;
    pointer-events: none;
  }
  @keyframes capIn { from { opacity: 0; transform: translateY(9px); } }
  .caption em { color: var(--accent); font-style: normal; }

  /* Keeps the UI clear of the caption line. */
  .scene { padding-bottom: 150px; }

  /* --- end card --- */
  .end { flex: 1; display: flex; flex-direction: column; align-items: center;
         justify-content: center; gap: 9px; text-align: center;
         animation: rise .6s ease both; }
  @keyframes rise { from { opacity: 0; transform: translateY(12px); } }
  .mark { font-size: 56px; font-weight: 900; color: var(--accent); letter-spacing: -.03em; }
  .tagline { font-size: 17px; }
  .free { font-size: 14px; color: var(--dim); }
  .play { font-size: 13px; color: var(--faint); margin-top: 4px; }
</style>
</head>
<body>

<!-- 1. the problem, before Sweep appears --------------------------------------->
<!--
  Deliberately NOT a recreation of anyone's storefront. Naming the shops you
  actually search is fine and factual; rebuilding Amazon's or eBay's page inside
  a page we host and put our own brand on is a different thing entirely, and not
  one worth risking on a promo video. Tab chrome carries the same joke — the
  clutter IS the point — without imitating anybody.
-->
<div class="scene" id="s0">
  <div class="eyebrow">Buying one thing</div>
  <div class="tabs">
    <div class="tab" style="animation-delay:.15s">
      <span class="fav" style="background:#FF9900"></span>Amazon<span class="tabPrice">$279</span>
    </div>
    <div class="tab" style="animation-delay:.7s">
      <span class="fav" style="background:#E53238"></span>eBay<span class="tabPrice">$239</span>
    </div>
    <div class="tab" style="animation-delay:1.25s">
      <span class="fav" style="background:#0071DC"></span>Walmart<span class="tabPrice">$268</span>
    </div>
    <div class="tab" style="animation-delay:1.8s">
      <span class="fav" style="background:#FF9900"></span>Amazon<span class="tabSub">reviews</span>
    </div>
    <div class="tab" style="animation-delay:2.35s">
      <span class="fav" style="background:#E53238"></span>eBay<span class="tabSub">seller feedback</span>
    </div>
    <div class="tab" style="animation-delay:2.9s">
      <span class="fav" style="background:#4285F4"></span>Google<span class="tabSub">is $239 a good price</span>
    </div>
  </div>
</div>

<!-- 2. one search, every store ------------------------------------------------->
<div class="scene" id="s1">
  <div class="search"><span>wireless headphones</span><span class="caret"></span></div>
  <div class="row" style="animation-delay:.1s">
    <div class="dot" style="background:#FF9900"></div><div class="store">Amazon</div>
    <div class="title">Sony WH-1000XM5</div><div class="price">$279</div>
  </div>
  <div class="row" style="animation-delay:.55s">
    <div class="dot" style="background:#0071DC"></div><div class="store">Walmart</div>
    <div class="title">Sony WH-1000XM5</div><div class="price">$268</div>
  </div>
  <div class="row" style="animation-delay:1s">
    <div class="dot" style="background:#E53238"></div><div class="store">eBay</div>
    <div class="title">Sony WH-1000XM5</div><div class="price best">$239</div>
  </div>
  <div class="row" style="animation-delay:1.45s">
    <div class="dot" style="background:#F1641E"></div><div class="store">Etsy</div>
    <div class="title">Headphone stand, walnut</div><div class="price">$34</div>
  </div>
</div>

<!-- 3. and the one that is too good to be true --------------------------------->
<div class="scene" id="s2">
  <div class="eyebrow">Top picks</div>
  <div class="hl" style="animation-delay:.1s">
    <div class="hlBadge">Cheapest</div>
    <div class="hlTitle">Sony WH-1000XM5</div>
    <div class="hlReason">Lowest price of 14 results</div>
  </div>
  <div class="hl" style="animation-delay:.5s">
    <div class="hlBadge">Best reviewed</div>
    <div class="hlTitle">Sony WH-1000XM5</div>
    <div class="hlReason">4.6&#9733; from 2.4k ratings</div>
  </div>
  <div class="hl" style="animation-delay:.9s">
    <div class="hlBadge claim">Big claim</div>
    <div class="hlTitle">Marketplace seller &middot; wireless headphones</div>
    <div class="hlReason">Store claims 87% off &mdash; track it to see if that&rsquo;s real</div>
  </div>
</div>

<!-- 4. the lookup page --------------------------------------------------------->
<div class="scene" id="s3">
  <div class="head">
    <div class="thumb"></div>
    <div style="flex:1">
      <div class="pname">Sony WH-1000XM5 Wireless Headphones</div>
      <div class="pprice">$239.00</div>
      <div class="stars">4.6&#9733; &middot; 2,431 ratings</div>
    </div>
  </div>
  <div class="sectionTitle">What buyers say</div>
  <div class="panel">
    <div class="mentions">
      <span class="pos">312 positive</span><span class="neg">47 negative</span>
    </div>
    <div class="chips">
      <span class="chip">Noise cancelling</span>
      <span class="chip">Comfort</span>
      <span class="chip">Battery life</span>
      <span class="chip">Call quality</span>
    </div>
  </div>
  <div class="sectionTitle">Shipping</div>
  <div class="panel">
    <div class="ship">Free delivery</div>
    <div class="shipSub">Arrives Tuesday, 2 September</div>
  </div>
</div>

<!-- 5. price history ----------------------------------------------------------->
<div class="scene" id="s4">
  <div class="sectionTitle">Price history</div>
  <div class="graph">
    <svg viewBox="0 0 300 74" preserveAspectRatio="none">
      <path class="line" d="M2,20 L28,21 L54,19 L80,22 L106,20 L132,21 L158,19 L184,22 L210,20 L236,21 L262,20 L288,20"></path>
    </svg>
    <div class="axis"><span>30 days ago</span><span>today</span></div>
  </div>
  <div class="sectionTitle">Is this sale real?</div>
  <div class="verdict">
    <div class="vHead">That &ldquo;60% off&rdquo; is just the normal price</div>
    <div class="vBody">It&rsquo;s sat around $242 across 28 checks. Lowest we&rsquo;ve recorded is $229.</div>
  </div>
</div>

<!-- 6. and when it IS real ----------------------------------------------------->
<div class="scene" id="s5">
  <div class="sectionTitle">Price history</div>
  <div class="graph">
    <svg viewBox="0 0 300 74" preserveAspectRatio="none">
      <path class="line" d="M2,18 L34,19 L66,17 L98,20 L130,18 L162,19 L194,18 L226,20 L258,44 L288,58"></path>
    </svg>
    <div class="axis"><span>30 days ago</span><span>today</span></div>
  </div>
  <div class="sectionTitle">Is this sale real?</div>
  <div class="verdict good">
    <div class="vHead">Lowest price we&rsquo;ve seen</div>
    <div class="vBody">Across 31 checks this has never been cheaper.</div>
  </div>
</div>

<!-- 7. end card ---------------------------------------------------------------->
<div class="scene" id="s6">
  <div class="end">
    <div class="mark">Sweep</div>
    <div class="tagline">Your online shopping buddy</div>
    <div class="free">10 free searches a day. No card.</div>
    <div class="play">Free on Google Play</div>
  </div>
</div>

<div class="caption" id="cap"></div>

<script>
  // Scene, caption and how long to hold it. Held long enough to be spoken over
  // rather than read: a caption that leaves before the sentence does is worse
  // than no caption.
  var BEATS = [
    ["s0", "Six tabs. One thing.", 6200],
    ["s1", "One search &mdash; every store.", 5200],
    ["s2", "It tells you what&rsquo;s <em>actually</em> worth it.", 4200],
    ["s3", "Open anything &mdash; ratings, real reviews, shipping.", 5200],
    ["s4", "And the price history the store can&rsquo;t rewrite.", 4600],
    ["s5", "So you know when a deal is <em>real</em>.", 4000],
    ["s6", "", 3200]
  ];

  var cap = document.getElementById("cap");
  var at = 0;

  function show(i) {
    var beat = BEATS[i];

    BEATS.forEach(function (b) {
      var el = document.getElementById(b[0]);
      el.className = b[0] === beat[0] ? "scene on" : "scene";
    });

    // Restart every entrance animation, so each loop staggers again instead of
    // sitting still after the first pass.
    var live = document.getElementById(beat[0]);
    Array.prototype.forEach.call(
      live.querySelectorAll(".row, .hl, .tab, .end, .line"),
      function (node) {
        var a = node.style.animation;
        node.style.animation = "none";
        node.offsetHeight;
        node.style.animation = a || "";
      }
    );

    if (beat[1]) {
      cap.innerHTML = beat[1];
      cap.style.display = "block";
      cap.style.animation = "none";
      cap.offsetHeight;
      cap.style.animation = "";
    } else {
      cap.style.display = "none";
    }

    setTimeout(function () {
      at = (i + 1) % BEATS.length;
      show(at);
    }, beat[2]);
  }

  show(0);
</script>
</body>
</html>`;
