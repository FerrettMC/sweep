// routes/videoMock.ts
//
// Auto-playing b-roll at /video, for the "here's what it does" line.
//
// Matches the second beat of the script: shopping several stores at once,
// tracking products, making lists. It loops on its own and needs no input,
// because it plays under someone talking — a demo that has to be driven is a
// demo you can't narrate.
//
// Phone-sized, in the app's real palette and wording, so it shows the app
// rather than an idea of it. The data is plausible rather than recorded: the
// app is new and nothing has months of history yet. It is a product demo, not
// a claim about a specific find.
//
// One rule when editing: this page lives inside a TypeScript template literal,
// so every backslash needs doubling. It is easier to avoid escapes entirely,
// which is why nothing here uses them.
//
// Not linked anywhere, marked noindex, safe to delete when it stops being
// useful.

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
    --good: #3DA35D;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body {
    background: var(--bg); color: var(--text); overflow: hidden;
    font: 400 16px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    padding: env(safe-area-inset-top) 20px 20px;
    display: flex; flex-direction: column; justify-content: center;
  }

  .scene { display: none; flex-direction: column; gap: 12px; }
  .scene.on { display: flex; }

  .label {
    font-size: 11px; font-weight: 800; color: var(--accent);
    text-transform: uppercase; letter-spacing: .1em;
  }
  h2 { font-size: 22px; font-weight: 800; line-height: 1.2; margin-bottom: 4px; }

  .search {
    display: flex; align-items: center; gap: 9px;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; padding: 12px 14px; font-size: 15px; color: var(--dim);
  }
  .caret { width: 2px; height: 17px; background: var(--accent); animation: blink 1s steps(2) infinite; }
  @keyframes blink { 50% { opacity: 0; } }

  .row {
    display: flex; align-items: center; gap: 11px;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; padding: 12px 14px;
    opacity: 0; transform: translateY(8px);
    animation: pop .45s ease forwards;
  }
  @keyframes pop { to { opacity: 1; transform: none; } }
  .dot { width: 9px; height: 9px; border-radius: 5px; flex: none; }
  .store { font-size: 12px; color: var(--dim); font-weight: 700; width: 54px; flex: none; }
  .title { font-size: 13px; color: var(--text); flex: 1; overflow: hidden;
           text-overflow: ellipsis; white-space: nowrap; }
  .price { font-size: 16px; font-weight: 800; flex: none; }
  .best { color: var(--good); }
  .tag { font-size: 10px; font-weight: 800; color: var(--good);
         border: 1px solid var(--good); border-radius: 5px; padding: 2px 5px; flex: none; }

  .card { background: var(--surface); border: 1px solid var(--border);
          border-radius: 14px; padding: 14px; display: flex; gap: 11px; align-items: center; }
  .thumb { width: 42px; height: 42px; border-radius: 9px; background: #262626; flex: none; }
  .drop { font-size: 12px; color: var(--good); font-weight: 700; }
  .muted { font-size: 12px; color: var(--faint); }
  .strike { text-decoration: line-through; color: var(--faint); font-size: 13px; }

  .listRow { display: flex; align-items: center; gap: 10px;
             background: var(--surface); border: 1px solid var(--border);
             border-radius: 12px; padding: 13px 14px; }
  .listName { font-size: 14px; font-weight: 700; flex: 1; }
  .count { font-size: 12px; color: var(--faint); }
</style>
</head>
<body>

  <div class="scene" id="s0">
    <div class="label">One search</div>
    <h2>Every store at once</h2>
    <div class="search"><span>wireless headphones</span><span class="caret"></span></div>
    <div class="row" style="animation-delay:.5s">
      <div class="dot" style="background:#FF9900"></div><div class="store">Amazon</div>
      <div class="title">Sony WH-1000XM5</div><div class="price">$279</div>
    </div>
    <div class="row" style="animation-delay:1.1s">
      <div class="dot" style="background:#E53238"></div><div class="store">eBay</div>
      <div class="title">Sony WH-1000XM5</div><div class="price best">$239</div>
      <div class="tag">BEST</div>
    </div>
    <div class="row" style="animation-delay:1.7s">
      <div class="dot" style="background:#F1641E"></div><div class="store">Etsy</div>
      <div class="title">Headphone stand, walnut</div><div class="price">$34</div>
    </div>
  </div>

  <div class="scene" id="s1">
    <div class="label">Track it</div>
    <h2>It watches the price for you</h2>
    <div class="card">
      <div class="thumb"></div>
      <div style="flex:1">
        <div style="font-size:13px;margin-bottom:3px">Sony WH-1000XM5</div>
        <div><span class="price">$239</span> <span class="strike">$399</span></div>
      </div>
      <div style="text-align:right">
        <div class="drop">&#9660; $160</div>
        <div class="muted">today</div>
      </div>
    </div>
    <div class="card">
      <div class="thumb"></div>
      <div style="flex:1">
        <div style="font-size:13px;margin-bottom:3px">Kindle Paperwhite</div>
        <div><span class="price">$134</span></div>
      </div>
      <div style="text-align:right"><div class="muted">watching</div></div>
    </div>
  </div>

  <div class="scene" id="s2">
    <div class="label">Save it</div>
    <h2>Lists and wishlists</h2>
    <div class="listRow"><div class="listName">Christmas</div><div class="count">7 items</div></div>
    <div class="listRow"><div class="listName">Desk setup</div><div class="count">4 items</div></div>
    <div class="listRow"><div class="listName">Mum's birthday</div><div class="count">3 items</div></div>
  </div>

<script>
  // Paced to a spoken line of roughly eight seconds: stores, tracking, lists.
  // Restarting each scene's animations means the rows re-stagger every loop
  // rather than sitting still after the first pass.
  var SCENES = ["s0", "s1", "s2"];
  var HOLD = [3400, 2600, 2400];
  var at = 0;

  function show(i) {
    SCENES.forEach(function (id, n) {
      var el = document.getElementById(id);
      el.className = n === i ? "scene on" : "scene";
    });
    var live = document.getElementById(SCENES[i]);
    Array.prototype.forEach.call(live.querySelectorAll(".row"), function (row) {
      var a = row.style.animation;
      row.style.animation = "none";
      row.offsetHeight;
      row.style.animation = a || "";
    });
    setTimeout(function () {
      at = (i + 1) % SCENES.length;
      show(at);
    }, HOLD[i]);
  }

  show(0);
</script>
</body>
</html>`;
