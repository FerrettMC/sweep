// routes/admin.ts
//
// A one-page admin portal at /admin.
//
// Exists because the alternative was curl commands with a header, which is
// fine at a desk and useless on a phone during a school lunch break. The
// things it answers — how many people are using this, what is it costing, is
// anything broken, and can I tell everyone something — were all invisible
// without a database client.
//
// AUTH: the same ADMIN_API_KEY as the announce endpoint, held in the browser's
// localStorage and sent as a header on each request. No cookies, no sessions,
// no new dependencies, and nothing to expire or invalidate.
//
// A session lasts until sign-out; there is nothing to renew. Rotation is the
// escape hatch rather than a routine: changing one Railway variable
// invalidates every browser holding the old key.
//
// That is a deliberate trade rather than an oversight. It is proportionate for
// a single-admin tool behind HTTPS, and would not be if more than one person
// ever used this.
//
// The page itself is served unauthenticated — it contains no data, only the
// form that asks for the key. Everything real is behind /admin/stats.

import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { getAdminStats } from "../lib/adminStats.js";

export async function adminRoutes(app: FastifyInstance) {
  app.get("/admin", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return reply.send(PAGE);
  });

  app.get("/admin/stats", async (request, reply) => {
    const expected = process.env.ADMIN_API_KEY;
    if (!expected) {
      return reply.status(503).send({ error: "ADMIN_API_KEY is not set" });
    }
    const provided = request.headers["x-admin-key"];
    if (typeof provided !== "string" || !secretsMatch(provided, expected)) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    return getAdminStats();
  });
}

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Sweep admin</title>
<style>
  :root { color-scheme: light dark; --line: #8883; --dim: #8888; }
  * { box-sizing: border-box; }
  body {
    margin: 0 auto; padding: 20px 16px 64px; max-width: 760px;
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em;
       color: var(--dim); margin: 28px 0 10px; }
  .sub { color: var(--dim); font-size: 13px; margin: 0 0 20px; }
  input, button, textarea {
    font: inherit; padding: 10px 12px; border-radius: 8px;
    border: 1px solid var(--line); background: transparent; color: inherit;
    width: 100%; margin-bottom: 8px;
  }
  button { background: #4f46e5; color: #fff; border: 0; font-weight: 700; cursor: pointer; }
  button.secondary { background: transparent; border: 1px solid var(--line); color: inherit; font-weight: 600; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; }
  .card { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; }
  .n { font-size: 22px; font-weight: 800; }
  .k { color: var(--dim); font-size: 12px; text-transform: uppercase; letter-spacing: .05em; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  td, th { text-align: left; padding: 7px 4px; border-bottom: 1px solid var(--line); }
  th { color: var(--dim); font-size: 12px; font-weight: 600; text-transform: uppercase; }
  .ok { color: #16a34a; } .bad { color: #dc2626; } .warn { color: #d97706; }
  .msg { padding: 10px 12px; border-radius: 8px; border: 1px solid var(--line); margin-bottom: 12px; font-size: 14px; }
  .hide { display: none; }
</style>
</head>
<body>

<h1>Sweep admin</h1>
<p class="sub" id="stamp">Not signed in.</p>

<div id="login">
  <input id="key" type="password" placeholder="Admin key" autocomplete="off">
  <button onclick="signIn()">Sign in</button>
  <p class="sub">Signs you in until you sign out — the key is kept in this browser only. If it ever leaks, changing ADMIN_API_KEY on Railway logs every browser out at once.</p>
</div>

<div id="app" class="hide">
  <div id="msg"></div>

  <h2>People</h2>
  <div class="grid" id="people"></div>

  <h2>Today</h2>
  <div class="grid" id="today"></div>

  <h2>Stores</h2>
  <table><thead><tr><th>Store</th><th>State</th><th>Success</th><th>Checks</th></tr></thead>
  <tbody id="stores"></tbody></table>

  <h2>Heaviest use today</h2>
  <p class="sub">Everyone is capped, so nobody here took more than they were given.
  This answers who is driving the Amazon bill.</p>
  <table><thead><tr><th>Account</th><th>Tier</th><th>Searches</th><th>Lookups</th></tr></thead>
  <tbody id="heaviest"></tbody></table>

  <h2>Send an announcement</h2>
  <p class="sub">Appears in everyone's bell. No push notification is sent.</p>
  <input id="aTitle" placeholder="Title (max 80)" maxlength="80">
  <textarea id="aBody" rows="3" placeholder="Body (max 300)" maxlength="300"></textarea>
  <input id="aEmail" placeholder="Just one person? Their email. Blank = everyone">
  <button onclick="announce()">Send</button>
  <button class="secondary" onclick="signOut()">Sign out</button>
</div>

<script>
const KEY = "sweep.admin.key";
function key() { return localStorage.getItem(KEY) || ""; }

function signIn() {
  const v = document.getElementById("key").value.trim();
  if (!v) return;
  localStorage.setItem(KEY, v);
  load();
}
function signOut() {
  localStorage.removeItem(KEY);
  location.reload();
}
function say(text, bad) {
  const el = document.getElementById("msg");
  el.textContent = text;
  el.className = "msg " + (bad ? "bad" : "ok");
  setTimeout(() => { el.className = "hide"; }, 6000);
}
function card(k, n) { return '<div class="card"><div class="k">' + k + '</div><div class="n">' + n + '</div></div>'; }

async function load() {
  const res = await fetch("/admin/stats", { headers: { "x-admin-key": key() } });
  if (res.status === 401) { localStorage.removeItem(KEY); say("Wrong key.", true); return; }
  if (!res.ok) { say("Couldn't load stats (" + res.status + ").", true); return; }
  const s = await res.json();

  document.getElementById("login").className = "hide";
  document.getElementById("app").className = "";
  document.getElementById("stamp").textContent =
    "Updated " + new Date(s.generatedAt).toLocaleTimeString();

  document.getElementById("people").innerHTML =
    card("Users", s.users.total) + card("New today", s.users.newToday) +
    card("New this week", s.users.newThisWeek) + card("Tracking", s.usage.tracked) +
    card("Pro", s.tiers.pro) + card("Ultimate", s.tiers.ultimate);

  document.getElementById("today").innerHTML =
    card("Searches", s.usage.searchesToday) + card("Lookups", s.usage.lookupsToday) +
    card("Amazon calls (max)", s.usage.meteredCeiling) +
    card("Announcements", s.notifications.sentToday);

  document.getElementById("stores").innerHTML = s.retailers.map(function (r) {
    var state = !r.enabled ? '<span class="dim">off</span>'
      : r.coolingSeconds ? '<span class="warn">cooling ' + r.coolingSeconds + 's</span>'
      : '<span class="ok">on</span>';
    var rate = r.successRate === null ? "—"
      : '<span class="' + (r.successRate > 0.8 ? "ok" : r.successRate > 0.4 ? "warn" : "bad") + '">'
        + Math.round(r.successRate * 100) + '%</span>';
    return "<tr><td>" + r.label + "</td><td>" + state + "</td><td>" + rate + "</td><td>" + r.checks + "</td></tr>";
  }).join("");

  document.getElementById("heaviest").innerHTML = s.heaviest.length
    ? s.heaviest.map(function (h) {
        return "<tr><td>" + h.email + "</td><td>" + h.tier + "</td><td>" + h.searches + "</td><td>" + h.lookups + "</td></tr>";
      }).join("")
    : '<tr><td colspan="4" class="dim">Nothing used yet today.</td></tr>';
}

async function announce() {
  const title = document.getElementById("aTitle").value.trim();
  const body = document.getElementById("aBody").value.trim();
  const email = document.getElementById("aEmail").value.trim();
  if (!title || !body) return say("Title and body are both required.", true);
  if (!confirm(email ? "Send to " + email + "?" : "Send to EVERY user?")) return;

  const res = await fetch("/notifications/announce", {
    method: "POST",
    headers: { "x-admin-key": key(), "content-type": "application/json" },
    body: JSON.stringify(email ? { title, body, email } : { title, body }),
  });
  const out = await res.json();
  if (!res.ok) return say(out.error || "Failed.", true);
  say("Sent to " + out.sent + " " + (out.sent === 1 ? "person" : "people") + ".");
  document.getElementById("aTitle").value = "";
  document.getElementById("aBody").value = "";
  document.getElementById("aEmail").value = "";
  load();
}

if (key()) load();
</script>
</body>
</html>`;
