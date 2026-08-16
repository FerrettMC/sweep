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

import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { RETAILERS, RETAILER_LABELS } from "../lib/scrapers/types.js";
import { disabledRetailers } from "../lib/scrapers/index.js";

const APP_NAME = "Sweep";
const PLAY_URL = "https://play.google.com/store/apps/details?id=com.sweepshopping.app";
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL ?? "support@sweepshopping.com";

/** Below this the numbers say "new", not "working". */
const MIN_CHECKS_TO_SHOW = 250;

/** Recomputed at most this often — the page is public and the counts are cheap but not free. */
const CACHE_MS = 5 * 60 * 1000;

interface Stats {
  priceChecks: number;
  tracked: number;
  drops: number;
  stores: string[];
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
    stores: RETAILERS.filter((r) => !off.includes(r)).map((r) => RETAILER_LABELS[r]),
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

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${APP_NAME} — price tracker and shopping companion</title>
<meta name="description" content="Compare prices across stores in one search, track prices over time, and find out whether a sale is really a sale.">
<style>
  :root { color-scheme: light dark; --bg:#ffffff; --fg:#16161a; --muted:#6b6b73;
          --accent:#C24A22; --card:#f6f6f7; --line:#e3e3e6; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0d0d0d; --fg:#ededf0; --muted:#9a9aa2; --accent:#E4733F;
            --card:#161618; --line:#2a2a2a; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:17px/1.6 -apple-system,
         BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:760px; margin:0 auto; padding:56px 20px 72px; }
  .brand { color:var(--accent); font-weight:900; letter-spacing:.6px;
           text-transform:uppercase; font-size:13px; }
  h1 { font-size:40px; line-height:1.15; margin:10px 0 12px; letter-spacing:-.5px; }
  .lede { font-size:19px; color:var(--muted); margin:0 0 28px; }
  .cta { display:inline-block; background:var(--accent); color:#fff; text-decoration:none;
         font-weight:700; padding:14px 26px; border-radius:10px; }
  @media (prefers-color-scheme: dark) { .cta { color:#16161a; } }
  .note { color:var(--muted); font-size:14px; margin-top:12px; }
  h2 { font-size:22px; margin:44px 0 14px; }
  ul { padding-left:20px; margin:0; }
  li { margin:9px 0; }
  .stats { display:flex; flex-wrap:wrap; gap:12px; margin:32px 0 0; }
  .stat { flex:1 1 160px; background:var(--card); border:1px solid var(--line);
          border-radius:12px; padding:16px 18px; }
  .stat b { display:block; font-size:26px; letter-spacing:-.5px; }
  .stat span { color:var(--muted); font-size:14px; }
  .stores { color:var(--muted); font-size:15px; margin-top:10px; }
  footer { margin-top:56px; border-top:1px solid var(--line); padding-top:18px;
           color:var(--muted); font-size:14px; }
  a { color:var(--accent); }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">${APP_NAME}</div>
  <h1>Know whether that sale is really a sale.</h1>
  <p class="lede">
    ${APP_NAME} checks several stores in one search, watches prices for you, and
    tells you when a discount is actually a discount.
  </p>

  <a class="cta" href="${PLAY_URL}">Get it on Google Play</a>
  <p class="note">Free. No card, and no trial that expires into a charge.</p>

  ${
    showStats
      ? `<div class="stats">
    <div class="stat"><b>${number(stats.priceChecks)}</b><span>prices recorded</span></div>
    <div class="stat"><b>${number(stats.tracked)}</b><span>products watched</span></div>
    <div class="stat"><b>${number(stats.drops)}</b><span>real drops caught</span></div>
  </div>`
      : ""
  }
  <p class="stores">Currently comparing ${stats.stores.join(", ")}.</p>

  <h2>What it does</h2>
  <ul>
    <li><strong>One search, several stores.</strong> Results side by side, cheapest first — and each store appears the moment it answers rather than waiting for the slowest.</li>
    <li><strong>Price drop alerts.</strong> Track something and get told while the deal is still live, not a week after it ended.</li>
    <li><strong>Real price history.</strong> ${APP_NAME} keeps its own record, so it can tell when a big red discount badge is sitting on the price an item always costs.</li>
    <li><strong>Deal Radar.</strong> Name a product and a price; it keeps looking for weeks.</li>
    <li><strong>Lists and a budget.</strong> Shareable gift lists with live prices, and somewhere to log what you actually spent.</li>
  </ul>

  <h2>The honest bit</h2>
  <p>
    Multi-store search, real alerts, lists and the budget tracker cost nothing.
    Paid plans raise the limits and check more often — that is the whole
    difference. Prices come from publicly available retailer pages, and
    ${APP_NAME} is not affiliated with any store it compares.
  </p>

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
