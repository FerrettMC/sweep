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
// every affiliate application, and wherever the app gets mentioned. So it shows
// the app rather than describing it: a real screenshot of the real thing, held
// at an angle, over an accent glow.
//
// The motion is deliberate and cheap. Everything moves with CSS transforms and
// opacity only, which the compositor handles without touching layout, and the
// only JavaScript is an IntersectionObserver for scroll reveals, a count-up for
// the numbers, and a pointer-parallax on the phone. No libraries, no fonts, no
// build step. Two requests: this page and one 72KB image.
//
// prefers-reduced-motion turns all of it off. Someone who has asked their
// device to stop animating things has asked for a reason, and a landing page is
// not the place to argue.
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
  const storeChips = stats.stores
    .map(
      (s, i) =>
        `<span class="chip" style="--i:${i};--c:${STORE_COLORS[s.key] ?? "#888"}"><i></i>${s.label}</span>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${APP_NAME} — price tracker and shopping companion</title>
<meta name="description" content="Compare prices across stores in one search, track prices over time, and find out whether a sale is really a sale.">
<meta name="theme-color" content="#0B0B0D">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${APP_NAME}">
<meta property="og:title" content="${APP_NAME} — know whether that sale is really a sale">
<meta property="og:description" content="One search across several stores, price alerts that arrive while the deal is live, and real price history so you can tell a discount from a sticker.">
<meta property="og:url" content="https://sweepshopping.com/">
<meta property="og:image" content="https://sweepshopping.com/assets/hero.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="https://sweepshopping.com/">
<link rel="preload" as="image" href="/assets/hero.webp" type="image/webp">
<style>
  /* Dark only. The app is dark, the screenshot is dark, and a light landing
     page handing over to a dark app is a jolt. */
  :root {
    --bg:#0B0B0D; --panel:#141417; --panel2:#1A1A1E; --line:#26262B;
    --fg:#F4F4F6; --dim:#A0A0AA; --faint:#6E6E78;
    --accent:#E4733F; --accent2:#F0A868; --accent-deep:#C24A22;
    --good:#3DA35D;
    --r:18px;
  }
  * { box-sizing:border-box; margin:0; padding:0; }
  html { scroll-behavior:smooth; }
  body {
    background:var(--bg); color:var(--fg);
    font:17px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
    -webkit-font-smoothing:antialiased; overflow-x:hidden;
  }
  a { color:var(--accent); text-decoration:none; }
  /* Longhands here, never the padding shorthand — and the same rule applies to
     every selector below that can also land on a .wrap element.

     These classes get combined: <div class="hero wrap">, <section class="wrap">.
     With shorthands they clobber each other in both directions. .hero and
     .closing are declared later at equal specificity, so their vertical-only
     shorthand was winning and zeroing the horizontal inset — text sat flat
     against the edge of the screen on a phone. And .wrap beats a bare section
     on specificity, so its horizontal-only shorthand won there instead and ate
     the vertical rhythm.

     padding-left/right and padding-top/bottom never overwrite one another, so
     each rule sets only the axis it means.

     No backticks in here either: this whole page is a template literal, and one
     of those ends the string. */
  .wrap { max-width:1120px; margin:0 auto; padding-left:22px; padding-right:22px; }

  /* ---- the moving background -------------------------------------------
     Two blurred blobs on a slow drift. Transform and opacity only, so the
     compositor owns it and the main thread never sees a frame of this. */
  .aura { position:fixed; inset:0; z-index:0; pointer-events:none; overflow:hidden; }
  .aura b {
    position:absolute; display:block; border-radius:50%;
    filter:blur(90px); opacity:.5;
  }
  .aura b:nth-child(1) {
    width:640px; height:640px; top:-220px; left:-160px;
    background:radial-gradient(circle, rgba(228,115,63,.55), transparent 70%);
    animation:drift1 26s ease-in-out infinite;
  }
  .aura b:nth-child(2) {
    width:520px; height:520px; top:22%; right:-200px;
    background:radial-gradient(circle, rgba(194,74,34,.42), transparent 70%);
    animation:drift2 32s ease-in-out infinite;
  }
  @keyframes drift1 {
    50% { transform:translate3d(90px,70px,0) scale(1.12); }
  }
  @keyframes drift2 {
    50% { transform:translate3d(-70px,-50px,0) scale(1.08); }
  }
  main, header, footer { position:relative; z-index:1; }

  /* ---- hero ------------------------------------------------------------- */
  .hero { padding-top:74px; padding-bottom:40px; }
  .heroGrid { display:grid; gap:44px; align-items:center; }
  @media (min-width:940px) { .heroGrid { grid-template-columns:1.02fr .98fr; gap:30px; } }

  .badge {
    display:inline-flex; align-items:center; gap:8px;
    border:1px solid var(--line); background:rgba(255,255,255,.03);
    border-radius:999px; padding:7px 14px; font-size:13px; color:var(--dim);
    font-weight:600;
  }
  .badge i {
    width:7px; height:7px; border-radius:50%; background:var(--good);
    box-shadow:0 0 0 0 rgba(61,163,93,.6); animation:pulse 2.4s ease-out infinite;
  }
  @keyframes pulse { 70%,100% { box-shadow:0 0 0 9px rgba(61,163,93,0); } }

  h1 {
    font-size:clamp(38px,6.6vw,62px); line-height:1.03; letter-spacing:-.035em;
    font-weight:800; margin:20px 0 18px;
  }
  h1 span {
    background:linear-gradient(100deg,var(--accent2),var(--accent) 55%,var(--accent-deep));
    -webkit-background-clip:text; background-clip:text; color:transparent;
  }
  .lede { font-size:19px; color:var(--dim); max-width:31em; }

  .ctaRow { display:flex; flex-wrap:wrap; gap:14px; align-items:center; margin-top:30px; }
  .cta {
    position:relative; overflow:hidden;
    display:inline-flex; align-items:center; gap:9px;
    background:linear-gradient(135deg,var(--accent),var(--accent-deep));
    color:#fff; font-weight:800; font-size:16px;
    padding:16px 30px; border-radius:14px;
    box-shadow:0 10px 30px rgba(228,115,63,.3);
    transition:transform .18s ease, box-shadow .18s ease;
  }
  .cta:hover { transform:translateY(-2px); box-shadow:0 16px 40px rgba(228,115,63,.42); }
  .cta:active { transform:translateY(0); }
  /* A slow sheen across the button. Pure decoration, and the one place on the
     page where that is the point. */
  .cta::after {
    content:""; position:absolute; top:0; bottom:0; width:45%;
    background:linear-gradient(100deg,transparent,rgba(255,255,255,.28),transparent);
    transform:translateX(-160%); animation:sheen 4.5s ease-in-out infinite;
  }
  @keyframes sheen { 0%,55% { transform:translateX(-160%); } 100% { transform:translateX(320%); } }
  .note { color:var(--faint); font-size:14px; }

  .chips { display:flex; flex-wrap:wrap; gap:9px; margin-top:26px; }
  .chip {
    display:inline-flex; align-items:center; gap:8px;
    border:1px solid var(--line); background:var(--panel);
    border-radius:999px; padding:8px 14px; font-size:14px; font-weight:600;
    color:var(--dim);
    opacity:0; transform:translateY(8px);
    animation:chipIn .5s cubic-bezier(.2,.7,.3,1) forwards;
    animation-delay:calc(.35s + var(--i) * .09s);
  }
  .chip i { width:9px; height:9px; border-radius:3px; background:var(--c); }
  @keyframes chipIn { to { opacity:1; transform:none; } }

  /* ---- the phone -------------------------------------------------------
     A real screenshot, tilted in 3D. The parallax below nudges --rx/--ry from
     the pointer; the defaults are the resting pose, so it looks right with no
     pointer at all — which is every phone. */
  .stage { perspective:1400px; display:flex; justify-content:center; }
  .phone {
    --rx:6deg; --ry:-15deg;
    position:relative; width:min(78vw,360px);
    transform:rotateX(var(--rx)) rotateY(var(--ry));
    transform-style:preserve-3d;
    transition:transform .5s cubic-bezier(.2,.7,.3,1);
    animation:float 7s ease-in-out infinite;
  }
  @keyframes float { 50% { translate:0 -16px; } }
  .phone img { width:100%; height:auto; display:block; }
  /* The glow sits behind the device, in its own plane, so the 3D rotation
     carries it along instead of leaving it flat on the page. */
  .phone::before {
    content:""; position:absolute; inset:6% 10% 10%;
    background:radial-gradient(ellipse at 50% 45%, rgba(228,115,63,.55), transparent 68%);
    filter:blur(52px); transform:translateZ(-60px); z-index:-1;
  }

  /* ---- scroll reveal ---------------------------------------------------- */
  .rise { opacity:0; transform:translateY(26px); transition:opacity .7s ease, transform .7s cubic-bezier(.2,.7,.3,1); }
  .rise.in { opacity:1; transform:none; }
  .rise[data-d="1"] { transition-delay:.09s; }
  .rise[data-d="2"] { transition-delay:.18s; }
  .rise[data-d="3"] { transition-delay:.27s; }

  /* ---- sections --------------------------------------------------------- */
  section { padding-top:76px; padding-bottom:76px; }
  .eyebrow {
    color:var(--accent); font-size:12px; font-weight:800;
    text-transform:uppercase; letter-spacing:.16em;
  }
  h2 { font-size:clamp(27px,4vw,38px); letter-spacing:-.028em; font-weight:800; margin:12px 0 12px; }
  .sub { color:var(--dim); max-width:36em; font-size:17px; }

  .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(158px,1fr)); gap:14px; margin-top:34px; }
  .stat {
    background:var(--panel); border:1px solid var(--line); border-radius:var(--r);
    padding:22px 24px;
  }
  .stat b { display:block; font-size:34px; font-weight:800; letter-spacing:-.03em; }
  .stat span { color:var(--faint); font-size:14px; }

  .feats { display:grid; gap:16px; margin-top:38px; }
  @media (min-width:760px) { .feats { grid-template-columns:1fr 1fr; } }
  .feat {
    position:relative; background:var(--panel); border:1px solid var(--line);
    border-radius:var(--r); padding:26px;
    transition:transform .3s cubic-bezier(.2,.7,.3,1), border-color .3s ease;
  }
  .feat:hover { transform:translateY(-5px); border-color:rgba(228,115,63,.45); }
  /* A soft edge-light on hover, drawn on a pseudo-element so it can fade
     without repainting the card's own border. */
  .feat::after {
    content:""; position:absolute; inset:-1px; border-radius:var(--r);
    background:linear-gradient(140deg,rgba(228,115,63,.22),transparent 45%);
    opacity:0; transition:opacity .3s ease; pointer-events:none;
  }
  .feat:hover::after { opacity:1; }
  .ico {
    width:42px; height:42px; border-radius:12px; margin-bottom:16px;
    display:flex; align-items:center; justify-content:center;
    background:rgba(228,115,63,.12); border:1px solid rgba(228,115,63,.24);
    color:var(--accent);
  }
  .feat h3 { font-size:18px; font-weight:800; margin-bottom:7px; }
  .feat p { color:var(--dim); font-size:15.5px; line-height:1.6; }

  /* ---- the proof: a chart that draws itself ----------------------------- */
  .proof {
    background:var(--panel); border:1px solid var(--line); border-radius:22px;
    padding:26px; margin-top:36px;
  }
  .proofTop { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; margin-bottom:6px; }
  .proofTop b { font-size:21px; font-weight:800; }
  .was { color:var(--faint); text-decoration:line-through; }
  .off {
    background:rgba(229,72,77,.14); color:#FF8A8F; border:1px solid rgba(229,72,77,.3);
    border-radius:7px; padding:3px 9px; font-size:12px; font-weight:800;
  }
  .proof svg { width:100%; height:120px; display:block; margin:14px 0 8px; }
  .proof .line {
    fill:none; stroke:var(--accent); stroke-width:2.5;
    stroke-linecap:round; stroke-linejoin:round;
    stroke-dasharray:640; stroke-dashoffset:640;
  }
  .in .proof .line, .proof.in .line { animation:draw 1.9s .25s cubic-bezier(.4,0,.2,1) forwards; }
  @keyframes draw { to { stroke-dashoffset:0; } }
  .axis { display:flex; justify-content:space-between; color:var(--faint); font-size:12px; }
  .verdict {
    margin-top:18px; padding:16px 18px; border-radius:14px;
    background:rgba(224,160,48,.09); border:1px solid rgba(224,160,48,.38);
  }
  .verdict b { display:block; color:#E0A030; font-size:16px; }
  .verdict span { color:var(--dim); font-size:14px; }

  .prose p { color:var(--dim); max-width:35em; font-size:17px; }
  .prose p + p { margin-top:15px; }
  .prose strong { color:var(--fg); font-weight:700; }

  .closing { text-align:center; padding-top:88px; padding-bottom:96px; }
  .closing .sub { margin:0 auto 30px; }
  .closing h2 { font-size:clamp(30px,5vw,46px); }

  footer {
    border-top:1px solid var(--line);
    padding-top:26px; padding-bottom:46px;
    color:var(--faint); font-size:14px;
  }
  footer a { color:var(--dim); }
  .footRow { display:flex; flex-wrap:wrap; gap:8px 18px; }

  /* Asked for, and meant. */
  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior:auto; }
    *, *::before, *::after {
      animation:none !important;
      transition:none !important;
    }
    .rise { opacity:1; transform:none; }
    .chip { opacity:1; transform:none; }
    .proof .line { stroke-dashoffset:0; }
    .phone { transform:rotateX(4deg) rotateY(-10deg); }
  }
</style>
</head>
<body>

<div class="aura" aria-hidden="true"><b></b><b></b></div>

<main>
  <div class="hero wrap">
    <div class="heroGrid">
      <div>
        <span class="badge"><i></i>Live on Google Play</span>
        <h1>Know whether that sale <span>is really a sale.</span></h1>
        <p class="lede">
          ${APP_NAME} checks several stores in one search, watches prices for you,
          and keeps its own history — so a big red discount badge has to prove itself.
        </p>
        <div class="ctaRow">
          <a class="cta" href="${PLAY_URL}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.6 2.3 13 12 3.6 21.7a1.6 1.6 0 0 1-.6-1.3V3.6c0-.5.2-1 .6-1.3Zm11 10.8 2.6 2.6-9.3 5.3 6.7-7.9Zm0-2.2L7.9 3l9.3 5.3-2.6 2.6Zm4.2-1.3 2.5 1.5c.9.5.9 1.9 0 2.4l-2.5 1.5L15.9 12l2.9-2.4Z"/></svg>
            Get it on Google Play
          </a>
        </div>
        <p class="note" style="margin-top:14px">Free. No card, and no trial that expires into a charge.</p>
        <div class="chips">${storeChips}</div>
      </div>

      <div class="stage">
        <div class="phone" id="phone">
          <picture>
            <source srcset="/assets/hero.webp" type="image/webp">
            <img src="/assets/hero.png" width="862" height="1280"
                 alt="${APP_NAME} on Android, showing the home screen with a search box, a tracked product and shortcuts."
                 fetchpriority="high" decoding="async">
          </picture>
        </div>
      </div>
    </div>
  </div>

  ${
    showStats
      ? `<div class="wrap rise">
    <div class="stats">
      <div class="stat"><b data-count="${stats.priceChecks}">0</b><span>prices recorded</span></div>
      <div class="stat"><b data-count="${stats.tracked}">0</b><span>products watched</span></div>
      <div class="stat"><b data-count="${stats.drops}">0</b><span>real drops caught</span></div>
    </div>
  </div>`
      : ""
  }

  <section class="wrap">
    <div class="rise">
      <span class="eyebrow">The problem</span>
      <h2>Most &ldquo;sales&rdquo; are just prices.</h2>
      <p class="sub">
        A struck-through number is whatever the shop decides to type. ${APP_NAME}
        records the real price every day, so it can tell the difference.
      </p>
    </div>

    <div class="proof rise" id="proof">
      <div class="proofTop">
        <b>$24.99</b><span class="was">$62.99</span><span class="off">60% OFF</span>
      </div>
      <svg viewBox="0 0 600 120" preserveAspectRatio="none" aria-hidden="true">
        <path class="line" d="M4,42 L64,40 L124,44 L184,41 L244,43 L304,40 L364,44 L424,41 L484,43 L544,41 L596,42"></path>
      </svg>
      <div class="axis"><span>30 days ago</span><span>today</span></div>
      <div class="verdict">
        <b>That &ldquo;60% off&rdquo; is just the normal price</b>
        <span>It&rsquo;s sat around $24.99 across 28 checks.</span>
      </div>
    </div>
  </section>

  <section class="wrap">
    <div class="rise">
      <span class="eyebrow">What it does</span>
      <h2>Six things, done properly.</h2>
      <p class="sub">Rather than fifteen done badly.</p>
    </div>

    <div class="feats">
      <div class="feat rise">
        <div class="ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></div>
        <h3>One search, several stores</h3>
        <p>Results side by side, cheapest first — and each store appears the moment it answers rather than waiting for the slowest.</p>
      </div>
      <div class="feat rise" data-d="1">
        <div class="ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg></div>
        <h3>Price drop alerts</h3>
        <p>Track something and get told while the deal is still live, not a week after it ended.</p>
      </div>
      <div class="feat rise" data-d="2">
        <div class="ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 5-6"/></svg></div>
        <h3>Real price history</h3>
        <p>${APP_NAME} keeps its own record, so it can tell when a big red discount badge is sitting on the price an item always costs.</p>
      </div>
      <div class="feat rise" data-d="3">
        <div class="ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/></svg></div>
        <h3>Deal Radar</h3>
        <p>Name a product and a price; it keeps looking for weeks so you don&rsquo;t have to keep checking.</p>
      </div>
      <div class="feat rise">
        <div class="ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></svg></div>
        <h3>Lists and a budget</h3>
        <p>Shareable gift lists with live prices, and somewhere to log what you actually spent.</p>
      </div>
      <div class="feat rise" data-d="1">
        <div class="ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.6 12.4a1.5 1.5 0 0 0 1.5 1.1h8.4a1.5 1.5 0 0 0 1.5-1.2L21 8H6"/></svg></div>
        <h3>A cart across stores</h3>
        <p>Collect things from anywhere you searched or tracked, and watch what the whole lot costs move over time.</p>
      </div>
    </div>
  </section>

  <section class="wrap prose rise">
    <span class="eyebrow">Who makes it</span>
    <h2>One person, after school.</h2>
    <p>
      ${APP_NAME} is built by a <strong>16-year-old developer</strong>, at
      weekends and in the evenings. Every line of it, the app and the servers
      behind it.
    </p>
    <p>
      That is worth knowing for two reasons. It moves quickly, and it will
      occasionally break in ways a larger team would have caught. It also means
      the person reading your support email is the person who wrote the code, so
      something that annoys you can be fixed the same week rather than filed.
    </p>
  </section>

  <section class="wrap prose rise">
    <span class="eyebrow">The honest bit</span>
    <h2>What costs nothing, and what doesn&rsquo;t.</h2>
    <p>
      Multi-store search, real alerts, lists and the budget tracker
      <strong>cost nothing</strong>. Paid plans raise the limits and check more
      often — that is the whole difference.
    </p>
    <p>
      Prices come from publicly available retailer pages, and ${APP_NAME} is not
      affiliated with any store it compares.
    </p>
  </section>

  <div class="closing wrap rise">
    <h2>Stop opening six tabs.</h2>
    <p class="sub">One search, every store, and a straight answer about the price.</p>
    <a class="cta" href="${PLAY_URL}">Get it on Google Play</a>
    <p class="note" style="margin-top:16px">Free on Android.</p>
  </div>
</main>

<footer class="wrap">
  <div class="footRow">
    <a href="${PLAY_URL}">Google Play</a>
    <a href="/privacy">Privacy</a>
    <a href="/delete-account">Delete your account</a>
    <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>
  </div>
</footer>

<script>
(function () {
  var still = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (still.matches) {
    // Show everything immediately and wire nothing up.
    var all = document.querySelectorAll(".rise");
    for (var i = 0; i < all.length; i++) all[i].classList.add("in");
    var nums = document.querySelectorAll("[data-count]");
    for (var n = 0; n < nums.length; n++) {
      nums[n].textContent = Number(nums[n].getAttribute("data-count")).toLocaleString("en-US");
    }
    return;
  }

  // ---- reveal on scroll ----
  var seen = new WeakSet();
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting || seen.has(entry.target)) return;
      seen.add(entry.target);
      entry.target.classList.add("in");
      var counter = entry.target.querySelectorAll("[data-count]");
      for (var i = 0; i < counter.length; i++) countUp(counter[i]);
    });
  }, { threshold: 0.15, rootMargin: "0px 0px -60px 0px" });

  var rise = document.querySelectorAll(".rise");
  for (var i = 0; i < rise.length; i++) io.observe(rise[i]);

  // ---- numbers that count up ----
  // Eased rather than linear: a number that decelerates into place reads as
  // arriving somewhere, where a linear one just stops.
  function countUp(el) {
    var target = Number(el.getAttribute("data-count")) || 0;
    var started = null;
    var span = 1400;
    function frame(now) {
      if (started === null) started = now;
      var p = Math.min(1, (now - started) / span);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased).toLocaleString("en-US");
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // ---- the phone follows the pointer ----
  // Only where there IS a pointer. On a touch screen this listener would never
  // fire, and the resting tilt in the CSS is the whole effect there.
  var phone = document.getElementById("phone");
  if (phone && window.matchMedia("(hover: hover)").matches) {
    var pending = false;
    var lastX = 0;
    var lastY = 0;

    window.addEventListener("mousemove", function (e) {
      lastX = e.clientX;
      lastY = e.clientY;
      if (pending) return;
      pending = true;
      // One write per frame. Without this the handler fires far more often
      // than the screen refreshes and every extra write is thrown away.
      requestAnimationFrame(function () {
        pending = false;
        var cx = window.innerWidth / 2;
        var cy = window.innerHeight / 2;
        var ry = -15 + ((lastX - cx) / cx) * 9;
        var rx = 6 - ((lastY - cy) / cy) * 6;
        phone.style.setProperty("--ry", ry.toFixed(2) + "deg");
        phone.style.setProperty("--rx", rx.toFixed(2) + "deg");
      });
    }, { passive: true });
  }
})();
</script>
</body>
</html>`;
}
