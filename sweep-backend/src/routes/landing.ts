// routes/landing.ts
//
// The page at /.
//
// Exists because "website URL" keeps being asked for — Best Buy wanted one,
// Etsy wanted one, affiliate programmes all will — and pointing them at the
// privacy policy was a workaround rather than an answer.
//
// The numbers are read from our own database rather than from Play. Play has
// no public API for ratings, and a brand-new app in closed testing has none to
// show anyway. What we do have is genuinely more interesting: how many prices
// we have actually checked, and how many real drops that caught.
//
// They're hidden entirely below a threshold. "2 price drops found" is worse
// than saying nothing — it invites the reader to conclude the thing doesn't
// work, when the truth is only that it is new.
//
// This is where a lot of people land — it's the URL in the Play listing, in
// every affiliate application, and wherever the app gets mentioned. So it
// carries a mock of the app itself rather than only describing it: a picture of
// four stores answering one search says what the product is faster than the
// paragraph underneath it can.
//
// Everything is inline. No fonts, no scripts, no images — it is one request
// that renders instantly on a phone on mobile data, which is what most of this
// traffic is.
//
// One rule when editing: this page is a TypeScript template literal, so a lone
// backslash becomes a real line break in the output. Nothing here uses one.

import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { RETAILERS, RETAILER_LABELS } from "../lib/scrapers/types.js";
import { disabledRetailers } from "../lib/scrapers/index.js";

const APP_NAME = "Sweep";
const PLAY_URL = "https://play.google.com/store/apps/details?id=com.sweepshopping.app";
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL ?? "support@sweepshopping.com";

/**
 * Store brand colours, mirroring constants/theme.ts in the app so the site and
 * the product agree. ASOS brands in black, which disappears on a dark
 * background, so it gets a near-white like the app gives it.
 */
const STORE_COLORS: Record<string, string> = {
  amazon: "#FF9900",
  walmart: "#0071DC",
  bestbuy: "#FFE000",
  ebay: "#E53238",
  newegg: "#E87F1E",
  asos: "#BDBDBD",
  etsy: "#F1641E",
};

/** Below this the numbers say "new", not "working". */
const MIN_CHECKS_TO_SHOW = 250;

/** Recomputed at most this often — the page is public and the counts are cheap but not free. */
const CACHE_MS = 5 * 60 * 1000;

interface Stats {
  priceChecks: number;
  tracked: number;
  drops: number;
  /** Label plus key, so the store row can carry each brand's colour. */
  stores: { key: string; label: string }[];
}

let cached: { at: number; stats: Stats } | null = null;

async function getStats(): Promise<Stats> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.stats;

  const [priceChecks, tracked, drops] = await Promise.all([
    prisma.priceHistory.count(),
    prisma.trackedProduct.count(),
    prisma.deal.count(),
  ]);

  const off = disabledRetailers();
  const stats: Stats = {
    priceChecks,
    tracked,
    drops,
    stores: RETAILERS.filter((r) => !off.includes(r)).map((r) => ({
      key: r,
      label: RETAILER_LABELS[r],
    })),
  };

  cached = { at: Date.now(), stats };
  return stats;
}

const number = (n: number) => n.toLocaleString("en-US");

export async function landingRoutes(app: FastifyInstance) {
  app.get("/", async (_request, reply) => {
    const stats = await getStats();
    reply.type("text/html; charset=utf-8");
    return reply.send(render(stats));
  });
}

function render(stats: Stats) {
  const showStats = stats.priceChecks >= MIN_CHECKS_TO_SHOW;
  const storeRow = stats.stores
    .map(
      (s) =>
        `<span class="store"><i style="background:${STORE_COLORS[s.key] ?? "#888"}"></i>${s.label}</span>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${APP_NAME} — price tracker and shopping companion</title>
<meta name="description" content="Compare prices across stores in one search, track prices over time, and find out whether a sale is really a sale.">
<meta name="theme-color" content="#C24A22">
<!-- Link previews. This URL gets pasted into applications, listings and chats,
     so it should not unfurl as a bare domain with no description. -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="${APP_NAME}">
<meta property="og:title" content="${APP_NAME} — know whether that sale is really a sale">
<meta property="og:description" content="One search across several stores, price alerts that arrive while the deal is live, and real price history so you can tell a discount from a sticker.">
<meta property="og:url" content="https://sweepshopping.com/">
<meta name="twitter:card" content="summary">
<link rel="canonical" href="https://sweepshopping.com/">
<style>
  :root {
    color-scheme: light dark;
    --bg:#ffffff; --fg:#16161a; --muted:#6b6b73; --accent:#C24A22;
    --accent-ink:#ffffff; --card:#f7f7f8; --line:#e5e5e8; --raise:#ffffff;
    --good:#2E7D46; --glow:rgba(194,74,34,.13);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg:#0d0d0d; --fg:#ededf0; --muted:#9a9aa2; --accent:#E4733F;
      --accent-ink:#1a0d07; --card:#151517; --line:#272729; --raise:#1c1c1f;
      --good:#3DA35D; --glow:rgba(228,115,63,.16);
    }
  }
  * { box-sizing:border-box; }
  body {
    margin:0; background:var(--bg); color:var(--fg);
    font:17px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  a { color:var(--accent); }
  .wrap { max-width:1040px; margin:0 auto; padding:0 20px; }

  /* --- hero ---------------------------------------------------------- */
  .hero {
    position:relative; overflow:hidden;
    padding:64px 0 56px;
    /* A soft wash behind the fold rather than a hard band, so the page starts
       with some colour without committing to a coloured header. */
    background:radial-gradient(120% 130% at 12% 0%, var(--glow) 0%, transparent 62%);
  }
  .heroGrid { display:grid; grid-template-columns:1fr; gap:44px; align-items:center; }
  @media (min-width:880px) { .heroGrid { grid-template-columns:1.05fr .95fr; gap:56px; } }

  .brand { color:var(--accent); font-weight:900; letter-spacing:.14em;
           text-transform:uppercase; font-size:12px; }
  h1 { font-size:clamp(34px,6vw,50px); line-height:1.08; letter-spacing:-.025em;
       margin:14px 0 16px; font-weight:800; }
  .lede { font-size:19px; color:var(--muted); margin:0 0 30px; max-width:30em; }

  .ctaRow { display:flex; flex-wrap:wrap; gap:12px; align-items:center; }
  .cta {
    display:inline-block; background:var(--accent); color:var(--accent-ink);
    text-decoration:none; font-weight:800; padding:15px 28px; border-radius:12px;
    box-shadow:0 6px 20px var(--glow);
  }
  .note { color:var(--muted); font-size:14px; margin:14px 0 0; }

  .stores { display:flex; flex-wrap:wrap; gap:9px 18px; margin-top:28px; }
  .store { display:inline-flex; align-items:center; gap:7px; font-size:14px;
           color:var(--muted); font-weight:600; }
  .store i { width:9px; height:9px; border-radius:3px; display:inline-block; }

  /* --- the phone --------------------------------------------------------
     A mock of the app, not a screenshot: it renders instantly, stays sharp on
     any display, and cannot go stale the way a captured image does. */
  .phoneWrap { display:flex; justify-content:center; }
  .phone {
    width:100%; max-width:310px; border-radius:30px; padding:14px;
    background:var(--raise); border:1px solid var(--line);
    box-shadow:0 20px 50px rgba(0,0,0,.13), 0 2px 6px rgba(0,0,0,.06);
  }
  @media (prefers-color-scheme: dark) {
    .phone { box-shadow:0 20px 50px rgba(0,0,0,.55); }
  }
  .screenLabel { font-size:11px; font-weight:800; letter-spacing:.1em;
                 text-transform:uppercase; color:var(--accent); margin-bottom:9px; }
  .searchBar { background:var(--card); border:1px solid var(--line); border-radius:10px;
               padding:10px 12px; font-size:13px; color:var(--muted); margin-bottom:11px; }
  .res { display:flex; align-items:center; gap:9px; padding:9px 11px; font-size:13px;
         background:var(--card); border:1px solid var(--line); border-radius:10px;
         margin-bottom:7px; }
  .res i { width:8px; height:8px; border-radius:3px; flex:none; }
  .res .nm { color:var(--muted); font-size:11px; font-weight:700; width:52px; flex:none; }
  .res .ti { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .res .pr { font-weight:800; }
  .res .pr.best { color:var(--good); }
  .verdict { margin-top:11px; padding:11px; border-radius:10px;
             background:var(--card); border:1px solid var(--good); }
  .verdict b { color:var(--good); font-size:13px; display:block; }
  .verdict span { color:var(--muted); font-size:11.5px; }

  /* --- stats ---------------------------------------------------------- */
  .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
           gap:12px; margin:40px 0 0; }
  .stat { background:var(--card); border:1px solid var(--line); border-radius:14px;
          padding:18px 20px; }
  .stat b { display:block; font-size:28px; letter-spacing:-.02em; font-weight:800; }
  .stat span { color:var(--muted); font-size:14px; }

  /* --- sections ------------------------------------------------------- */
  section { padding:60px 0; border-top:1px solid var(--line); }
  h2 { font-size:clamp(24px,3.4vw,30px); letter-spacing:-.02em; margin:0 0 8px; font-weight:800; }
  .sub { color:var(--muted); margin:0 0 30px; max-width:34em; }

  .feats { display:grid; grid-template-columns:1fr; gap:14px; }
  @media (min-width:700px) { .feats { grid-template-columns:1fr 1fr; } }
  .feat { background:var(--card); border:1px solid var(--line); border-radius:14px;
          padding:20px 22px; }
  .feat h3 { margin:0 0 6px; font-size:17px; font-weight:800; }
  .feat p { margin:0; color:var(--muted); font-size:15.5px; line-height:1.55; }
  .ico { width:26px; height:26px; margin-bottom:11px; color:var(--accent); display:block; }

  .prose p { max-width:34em; }
  .prose p + p { margin-top:14px; }

  .closing { text-align:center; padding:64px 0 72px; border-top:1px solid var(--line); }
  .closing h2 { margin-bottom:10px; }
  .closing .sub { margin-left:auto; margin-right:auto; }

  footer { border-top:1px solid var(--line); padding:24px 0 44px;
           color:var(--muted); font-size:14px; }
  footer a { margin-right:6px; }
</style>
</head>
<body>

<div class="hero">
  <div class="wrap heroGrid">
    <div>
      <div class="brand">${APP_NAME}</div>
      <h1>Know whether that sale is really a sale.</h1>
      <p class="lede">
        ${APP_NAME} checks several stores in one search, watches prices for you,
        and tells you when a discount is actually a discount.
      </p>
      <div class="ctaRow">
        <a class="cta" href="${PLAY_URL}">Get it on Google Play</a>
      </div>
      <p class="note">Free. No card, and no trial that expires into a charge.</p>
      <div class="stores">${storeRow}</div>
    </div>

    <div class="phoneWrap">
      <div class="phone">
        <div class="screenLabel">One search</div>
        <div class="searchBar">wireless headphones</div>
        <div class="res"><i style="background:#FF9900"></i><span class="nm">Amazon</span><span class="ti">Sony WH-1000XM5</span><span class="pr">$279</span></div>
        <div class="res"><i style="background:#0071DC"></i><span class="nm">Walmart</span><span class="ti">Sony WH-1000XM5</span><span class="pr">$268</span></div>
        <div class="res"><i style="background:#E53238"></i><span class="nm">eBay</span><span class="ti">Sony WH-1000XM5</span><span class="pr best">$239</span></div>
        <div class="verdict">
          <b>Lowest price we&rsquo;ve seen</b>
          <span>Across 31 checks this has never been cheaper.</span>
        </div>
      </div>
    </div>
  </div>
</div>

<div class="wrap">
${
  showStats
    ? `  <div class="stats">
    <div class="stat"><b>${number(stats.priceChecks)}</b><span>prices recorded</span></div>
    <div class="stat"><b>${number(stats.tracked)}</b><span>products watched</span></div>
    <div class="stat"><b>${number(stats.drops)}</b><span>real drops caught</span></div>
  </div>
`
    : ""
}
  <section>
    <h2>What it does</h2>
    <p class="sub">Five things, and it tries to do them properly rather than doing fifteen.</p>
    <div class="feats">
      <div class="feat">
        <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <h3>One search, several stores</h3>
        <p>Results side by side, cheapest first — and each store appears the moment it answers rather than waiting for the slowest.</p>
      </div>
      <div class="feat">
        <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
        <h3>Price drop alerts</h3>
        <p>Track something and get told while the deal is still live, not a week after it ended.</p>
      </div>
      <div class="feat">
        <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 5-6"/></svg>
        <h3>Real price history</h3>
        <p>${APP_NAME} keeps its own record, so it can tell when a big red discount badge is sitting on the price an item always costs.</p>
      </div>
      <div class="feat">
        <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/></svg>
        <h3>Deal Radar</h3>
        <p>Name a product and a price; it keeps looking for weeks so you don&rsquo;t have to keep checking.</p>
      </div>
      <div class="feat">
        <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></svg>
        <h3>Lists and a budget</h3>
        <p>Shareable gift lists with live prices, and somewhere to log what you actually spent.</p>
      </div>
      <div class="feat">
        <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.6 12.4a1.5 1.5 0 0 0 1.5 1.1h8.4a1.5 1.5 0 0 0 1.5-1.2L21 8H6"/></svg>
        <h3>A cart across stores</h3>
        <p>Collect things from anywhere you searched or tracked, and watch what the whole lot costs move over time.</p>
      </div>
    </div>
  </section>

  <section class="prose">
    <h2>Who makes it</h2>
    <p>
      ${APP_NAME} is built by one person — a 16-year-old developer, after school
      and at weekends. Every line of it, the app and the servers behind it.
    </p>
    <p>
      That is worth knowing for two reasons. It moves quickly, and it will
      occasionally break in ways a larger team would have caught. It also means
      the person reading your support email is the person who wrote the code, so
      something that annoys you can be fixed the same week rather than filed.
    </p>
  </section>

  <section class="prose">
    <h2>The honest bit</h2>
    <p>
      Multi-store search, real alerts, lists and the budget tracker cost nothing.
      Paid plans raise the limits and check more often — that is the whole
      difference.
    </p>
    <p>
      Prices come from publicly available retailer pages, and ${APP_NAME} is not
      affiliated with any store it compares.
    </p>
  </section>

  <div class="closing">
    <h2>Stop opening six tabs.</h2>
    <p class="sub">One search, every store, and a straight answer about the price.</p>
    <a class="cta" href="${PLAY_URL}">Get it on Google Play</a>
    <p class="note">Free on Android.</p>
  </div>

  <footer>
    <a href="${PLAY_URL}">Google Play</a> ·
    <a href="/privacy">Privacy</a> ·
    <a href="/delete-account">Delete your account</a> ·
    <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>
  </footer>
</div>
</body>
</html>`;
}
