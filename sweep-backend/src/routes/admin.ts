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
import { requireAdmin } from "../lib/adminAuth.js";
import { getAdminStats } from "../lib/adminStats.js";
import { createPromoCode, deletePromoCode, listPromoCodes } from "../lib/promoAdmin.js";

export async function adminRoutes(app: FastifyInstance) {
  app.get("/admin", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return reply.send(PAGE);
  });

  app.get("/admin/stats", { preHandler: requireAdmin }, async () => {
    return getAdminStats();
  });

  app.get("/admin/promo", { preHandler: requireAdmin }, async () => {
    return { codes: await listPromoCodes() };
  });

  app.delete("/admin/promo/:code", { preHandler: requireAdmin }, async (request, reply) => {
    const { code } = request.params as { code: string };
    try {
      const result = await deletePromoCode(code);
      request.log.warn(
        { code: result.code, redemptionsRemoved: result.redemptionsRemoved },
        "promo code deleted",
      );
      return { ok: true, ...result };
    } catch (err) {
      return reply
        .status(404)
        .send({ error: err instanceof Error ? err.message : "Could not delete code" });
    }
  });

  app.post("/admin/promo", { preHandler: requireAdmin }, async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    try {
      const created = await createPromoCode({
        code: typeof body.code === "string" ? body.code : undefined,
        tier: String(body.tier ?? "pro"),
        days: Number(body.days ?? 14),
        maxRedemptions:
          body.maxRedemptions === null || body.maxRedemptions === undefined || body.maxRedemptions === ""
            ? null
            : Number(body.maxRedemptions),
        expiresInDays:
          body.expiresInDays === null || body.expiresInDays === undefined || body.expiresInDays === ""
            ? null
            : Number(body.expiresInDays),
      });
      request.log.info(
        { code: created.code, tier: created.grantsTier, days: created.grantsDurationDays },
        "promo code created",
      );
      return { ok: true, code: created.code };
    } catch (err) {
      // Validation messages here are written for the admin reading them, and
      // the only reader is authenticated, so passing them through is safe.
      return reply
        .status(400)
        .send({ error: err instanceof Error ? err.message : "Could not create code" });
    }
  });
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
  input, button, textarea, select {
    font: inherit; padding: 10px 12px; border-radius: 8px;
    border: 1px solid var(--line); background: transparent; color: inherit;
    width: 100%; margin-bottom: 8px;
  }
  /* Two fields side by side, stacking on a phone — which is where this page
     actually gets used. */
  .row { display: flex; gap: 8px; }
  .row > * { flex: 1; min-width: 0; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
  .dim { color: var(--dim); }
  button { background: #4f46e5; color: #fff; border: 0; font-weight: 700; cursor: pointer; }
  button.secondary { background: transparent; border: 1px solid var(--line); color: inherit; font-weight: 600; }
  /* An inline action inside a table row, not a page-level button. */
  button.link { background: none; border: 0; color: #dc2626; font-weight: 600;
                width: auto; margin: 0; padding: 2px 0; font-size: 13px; }
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

<div id="msg" class="hide"></div>

<div id="login">
  <input id="key" type="password" placeholder="Admin key" autocomplete="off"
         onkeydown="if (event.key === 'Enter') signIn()">
  <button onclick="signIn()">Sign in</button>
  <p class="sub">Signs you in until you sign out — the key is kept in this browser only. If it ever leaks, changing ADMIN_API_KEY on Railway logs every browser out at once.</p>
</div>

<div id="app" class="hide">

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

  <h2>Promo codes</h2>
  <p class="sub">Grants time on a paid tier. It never touches a real subscription —
  someone who already pays keeps what they pay for, and the grant is what they
  fall back on if that ever ends.</p>
  <div class="row">
    <select id="pTier">
      <option value="pro">Pro</option>
      <option value="ultimate">Ultimate</option>
    </select>
    <input id="pDays" type="number" min="1" max="365" value="14" placeholder="Days">
  </div>
  <div class="row">
    <input id="pCode" placeholder="Code (blank = generate one)" autocomplete="off">
    <input id="pMax" type="number" min="1" placeholder="Max uses (blank = unlimited)">
  </div>
  <input id="pExpires" type="number" min="1" placeholder="Code itself expires in N days (blank = never)">
  <button onclick="makeCode()">Create code</button>
  <table><thead><tr><th>Code</th><th>Grants</th><th>Used</th><th>Status</th><th></th></tr></thead>
  <tbody id="promo"></tbody></table>

  <h2>Send an announcement</h2>
  <p class="sub">Appears in everyone's bell. Tick the box below to buzz their phone too —
  worth saving for things that genuinely can't wait, since an app that
  interrupts about nothing gets muted for everything.</p>
  <button class="secondary" onclick="useTemplate()">Use the usual format</button>
  <input id="aTitle" placeholder="Title" maxlength="80" oninput="counts()">
  <textarea id="aBody" rows="5" placeholder="Body" maxlength="300" oninput="counts()"></textarea>
  <p class="sub" id="counts">0/80 title · 0/300 body</p>
  <input id="aEmail" placeholder="Just one person? Their email. Blank = everyone">
  <label style="display:flex;gap:8px;align-items:center;margin:4px 0 12px;font-size:14px;">
    <input type="checkbox" id="aPush" style="width:auto;margin:0;">
    Also send a push notification
  </label>
  <button onclick="announce()">Send</button>
  <button class="secondary" onclick="signOut()">Sign out</button>
</div>

<script>
const KEY = "sweep.admin.key";

// Kept in memory as well as in storage. localStorage throws in a private
// window and wherever site data is blocked, and the first version let that
// throw out of the click handler — so the button did nothing at all, with
// nothing in the UI to say why. In memory it still works for the session.
let memoryKey = "";

function key() {
  if (memoryKey) return memoryKey;
  try { return localStorage.getItem(KEY) || ""; } catch (e) { return ""; }
}

function signIn() {
  const v = document.getElementById("key").value.trim();
  if (!v) return say("Enter the key first.", true);
  memoryKey = v;
  try {
    localStorage.setItem(KEY, v);
  } catch (e) {
    say("Signed in for this tab only — this browser is blocking storage.", false);
  }
  load();
}

function signOut() {
  memoryKey = "";
  try { localStorage.removeItem(KEY); } catch (e) {}
  location.reload();
}
function say(text, bad) {
  const el = document.getElementById("msg");
  el.textContent = text;
  el.className = "msg " + (bad ? "bad" : "ok");
  setTimeout(() => { el.className = "hide"; }, 6000);
}
// NOTE: this whole page is a TypeScript template literal, so every backslash
// below has to be doubled — including in comments like this one. A lone
// backslash-n is consumed at compile time and drops a real line break into the
// served JavaScript, which is a syntax error that kills the ENTIRE script,
// including the sign-in button hundreds of lines above and seemingly
// unrelated. It happened twice while writing this: once in the strings, and
// once in the comment explaining the strings.
//
// The greeting and sign-off are ~52 characters of the 300 the server allows,
// which is worth knowing before writing rather than after being truncated —
// hence the live count next to it.
const TEMPLATE_TOP = "Hey Sweep users!\\n\\n";
const TEMPLATE_BOTTOM = "\\n\\nThanks,\\nJude \\u2014 sweepshopping.com";

function useTemplate() {
  const el = document.getElementById("aBody");
  // Keeps anything already typed, so pressing this after starting to write
  // wraps what's there instead of throwing it away.
  const middle = el.value.trim() || "";
  el.value = TEMPLATE_TOP + middle + TEMPLATE_BOTTOM;
  el.focus();
  // Drop the cursor where the message goes, not at the end after the sign-off.
  const at = TEMPLATE_TOP.length + middle.length;
  el.setSelectionRange(at, at);
  counts();
}

function counts() {
  const t = document.getElementById("aTitle").value.length;
  const b = document.getElementById("aBody").value.length;
  const el = document.getElementById("counts");
  el.textContent = t + "/80 title \u00b7 " + b + "/300 body";
  el.className = b > 280 || t > 70 ? "sub bad" : "sub";
}

function card(k, n) { return '<div class="card"><div class="k">' + k + '</div><div class="n">' + n + '</div></div>'; }

async function load() {
  let res;
  try {
    res = await fetch("/admin/stats", { headers: { "x-admin-key": key() } });
  } catch (e) {
    // Offline, or the request never left. Previously this threw out of the
    // handler and the button appeared dead.
    say("Couldn't reach the server. Check your connection.", true);
    return;
  }

  if (res.status === 401) {
    memoryKey = "";
    try { localStorage.removeItem(KEY); } catch (e) {}
    say("That key wasn't accepted.", true);
    return;
  }
  if (res.status === 503) {
    say("The server has no ADMIN_API_KEY set.", true);
    return;
  }
  if (!res.ok) { say("Couldn't load stats (" + res.status + ").", true); return; }
  const s = await res.json();

  document.getElementById("login").className = "hide";
  document.getElementById("app").className = "";
  document.getElementById("stamp").textContent =
    "Updated " + new Date(s.generatedAt).toLocaleTimeString();

  // Separate request, deliberately not awaited: a failure to list codes
  // shouldn't stop the stats that just arrived from rendering.
  loadPromo();

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

async function loadPromo() {
  const res = await fetch("/admin/promo", { headers: { "x-admin-key": key() } });
  if (!res.ok) return;
  const data = await res.json();
  const rows = data.codes.map(function (c) {
    const status = c.expired ? "expired" : c.exhausted ? "used up" : "active";
    const used = c.used + (c.max === null ? " / unlimited" : " / " + c.max);
    const grants = c.days + "d " + c.tier;
    const cls = status === "active" ? "" : ' class="dim"';
    // Attributes carry what the confirm prompt needs, so deleting doesn't have
    // to re-fetch the row it is already looking at.
    const del = '<button class="link" onclick="dropCode(this)" data-code="' + c.code +
      '" data-used="' + c.used + '">Delete</button>';
    return "<tr" + cls + "><td><code>" + c.code + "</code></td><td>" + grants +
      "</td><td>" + used + "</td><td>" + status + "</td><td>" + del + "</td></tr>";
  }).join("");
  document.getElementById("promo").innerHTML = rows ||
    '<tr><td colspan="5" class="dim">No codes yet.</td></tr>';
}

async function dropCode(el) {
  const code = el.getAttribute("data-code");
  const used = parseInt(el.getAttribute("data-used"), 10) || 0;

  // Spelled out, because "delete" reads like it takes access back and it does
  // not — grants already given live on the wallet and stay there.
  const warning = used > 0
    ? "Delete " + code + "?\\n\\n" + used + " already redeemed it. They KEEP their time — " +
      "this only stops anyone else using the code, and erases the record of who redeemed it."
    : "Delete " + code + "? Nobody has redeemed it.";
  if (!confirm(warning)) return;

  const res = await fetch("/admin/promo/" + encodeURIComponent(code), {
    method: "DELETE",
    headers: { "x-admin-key": key() },
  });
  const data = await res.json().catch(function () { return {}; });
  if (!res.ok) return say(data.error || "Could not delete that code.", true);

  say("Deleted " + code + ".");
  loadPromo();
}

async function makeCode() {
  const days = parseInt(document.getElementById("pDays").value, 10);
  if (!days || days < 1) return say("Days must be at least 1.", true);

  const res = await fetch("/admin/promo", {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-key": key() },
    body: JSON.stringify({
      tier: document.getElementById("pTier").value,
      days: days,
      code: document.getElementById("pCode").value.trim(),
      maxRedemptions: document.getElementById("pMax").value.trim(),
      expiresInDays: document.getElementById("pExpires").value.trim(),
    }),
  });

  const data = await res.json().catch(function () { return {}; });
  if (!res.ok) return say(data.error || "Could not create that code.", true);

  say("Created " + data.code + ".");
  document.getElementById("pCode").value = "";
  loadPromo();
}

async function announce() {
  const title = document.getElementById("aTitle").value.trim();
  const body = document.getElementById("aBody").value.trim();
  const email = document.getElementById("aEmail").value.trim();
  const push = document.getElementById("aPush").checked;
  if (!title || !body) return say("Title and body are both required.", true);
  const who = email ? email : "EVERY user";
  const how = push ? " AND buzz their phone" : "";
  if (!confirm("Send to " + who + how + "?")) return;

  const res = await fetch("/notifications/announce", {
    method: "POST",
    headers: { "x-admin-key": key(), "content-type": "application/json" },
    body: JSON.stringify(Object.assign({ title, body }, email ? { email } : {}, push ? { push: true } : {})),
  });
  const out = await res.json();
  if (!res.ok) return say(out.error || "Failed.", true);
  say("Filed for " + out.sent + " " + (out.sent === 1 ? "person" : "people")
      + (out.pushed ? ", pushed to " + out.pushed + " device" + (out.pushed === 1 ? "" : "s") : "")
      + ".");
  document.getElementById("aTitle").value = "";
  document.getElementById("aBody").value = "";
  document.getElementById("aEmail").value = "";
  document.getElementById("aPush").checked = false;
  counts();
  load();
}

if (key()) load();
</script>
</body>
</html>`;
