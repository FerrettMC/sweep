// routes/sharePage.ts
//
// The web page a shared list link opens.
//
// Served from the backend rather than a separate site, so a share link works
// the moment the API is deployed — no extra hosting, no domain required to
// start. Point a real domain at this later and nothing here changes.
//
// Deliberately server-rendered plain HTML with no JS framework: the person
// opening it has probably never heard of Sweep, is on a phone, and clicked a
// link in a group chat. It needs to render instantly and work everywhere.
import { prisma } from "../lib/prisma.js";
import { RETAILER_LABELS, isRetailer, storeListPhrase, } from "../lib/scrapers/types.js";
import { displayName } from "../lib/xp.js";
/** Where the app can be installed. Filled in once there's a store listing. */
const STORE_URL = process.env.APP_STORE_URL ?? null;
/**
 * Kept in sync with constants/support.ts in the app. This page is the one part
 * of Sweep a stranger sees, so it needs a way to report it — a shared list is
 * exactly the kind of thing someone might want taken down.
 */
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL ?? "support@sweepapp.example";
export async function sharePageRoutes(app) {
    app.get("/list/:token", async (request, reply) => {
        const list = await prisma.list.findUnique({
            where: { shareToken: request.params.token },
            include: {
                user: { select: { id: true, username: true } },
                items: { orderBy: { addedAt: "desc" }, include: { product: true } },
            },
        });
        reply.type("text/html; charset=utf-8");
        if (!list || !list.isPublic) {
            return reply.status(404).send(page("List not found", `<div class="empty">
             <h1>This list isn't available</h1>
             <p>The link may be wrong, or whoever shared it has turned sharing off.</p>
           </div>`));
        }
        const owner = displayName(list.user);
        const total = list.items.reduce((sum, item) => sum + (item.product.currentPrice ?? 0), 0);
        const items = list.items
            .map((item) => {
            const p = item.product;
            const retailer = isRetailer(p.retailer)
                ? RETAILER_LABELS[p.retailer]
                : p.retailer;
            const price = p.currentPrice !== null
                ? `$${(p.currentPrice / 100).toFixed(2)}`
                : "—";
            const wasCheaper = p.listPrice !== null &&
                p.currentPrice !== null &&
                p.listPrice > p.currentPrice;
            return `
          <li class="item${item.claimed ? " claimed" : ""}">
            <div class="thumb">${p.imageUrl
                ? `<img src="${escapeAttr(p.imageUrl)}" alt="" loading="lazy">`
                : ""}</div>
            <div class="info">
              <div class="store">${escapeHtml(retailer)}</div>
              <a class="title" href="${escapeAttr(p.url)}" target="_blank" rel="noopener nofollow">${escapeHtml(p.title)}</a>
              <div class="price">
                <strong>${price}</strong>
                ${wasCheaper ? `<s>$${(p.listPrice / 100).toFixed(2)}</s>` : ""}
                ${item.claimed ? `<span class="tag">Someone's getting this</span>` : ""}
              </div>
              ${item.note ? `<div class="note">${escapeHtml(item.note)}</div>` : ""}
            </div>
            <button class="claim" data-item="${escapeAttr(item.id)}" data-claimed="${item.claimed}">
              ${item.claimed ? "Undo" : "I'll get this"}
            </button>
          </li>`;
        })
            .join("");
        return reply.send(page(`${list.name} — a Sweep list`, `<header>
           <div class="brand">Sweep</div>
           <h1>${escapeHtml(list.name)}</h1>
           <p class="by">Shared by ${escapeHtml(owner)}</p>
           ${list.description ? `<p class="desc">${escapeHtml(list.description)}</p>` : ""}
           <p class="meta">${list.items.length} item${list.items.length === 1 ? "" : "s"}${total > 0 ? ` · $${(total / 100).toFixed(2)} total` : ""}</p>
         </header>

         ${list.items.length === 0
            ? `<div class="empty"><p>Nothing on this list yet.</p></div>`
            : `<ul class="items">${items}</ul>`}

         <footer>
           <p>Prices update automatically — they're live, not from when the list was made.</p>
           ${STORE_URL
            ? `<a class="cta" href="${escapeAttr(STORE_URL)}">Track prices with Sweep</a>`
            : `<p class="cta-soon">Sweep tracks prices across ${storeListPhrase()}.</p>`}
           <p class="contact">Questions about this list? <a href="mailto:${escapeAttr(SUPPORT_EMAIL)}?subject=Shared%20list">${escapeHtml(SUPPORT_EMAIL)}</a></p>
         </footer>

         <script>
           // Marking an item needs no account — requiring one would defeat the
           // point of sending this to family.
           document.querySelectorAll('.claim').forEach(function (button) {
             button.addEventListener('click', function () {
               var claimed = button.dataset.claimed === 'true';
               button.disabled = true;
               fetch(location.pathname.replace('/list/', '/shared/') + '/items/' + button.dataset.item + '/claim', {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ claimed: !claimed })
               }).then(function () { location.reload(); })
                 .catch(function () { button.disabled = false; });
             });
           });
         </script>`));
    });
}
/** Shell shared by both states. Inline CSS — one request, no dependencies. */
function page(title, body) {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="robots" content="noindex">
<meta property="og:title" content="${escapeAttr(title)}">
<meta property="og:description" content="A shared shopping list with live prices.">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px 16px 48px;
    background: #0D0D0D; color: #F5F5F5;
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    max-width: 640px; margin-inline: auto;
  }
  .brand { color: #D85A30; font-weight: 900; letter-spacing: .5px; font-size: 13px; text-transform: uppercase; }
  h1 { font-size: 28px; margin: 6px 0 4px; }
  .by, .desc, .meta { color: #999; font-size: 14px; margin: 2px 0; }
  .desc { color: #C7C7C7; }
  ul.items { list-style: none; padding: 0; margin: 24px 0 0; display: grid; gap: 12px; }
  .item {
    display: flex; gap: 12px; align-items: center;
    background: #1A1A1A; border: 1px solid #2A2A2A; border-radius: 12px; padding: 12px;
  }
  .item.claimed { opacity: .55; }
  .thumb { width: 64px; height: 64px; border-radius: 8px; background: #fff; flex: none; overflow: hidden; }
  .thumb img { width: 100%; height: 100%; object-fit: contain; }
  .info { flex: 1; min-width: 0; }
  .store { color: #999; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; }
  a.title { color: #F5F5F5; text-decoration: none; font-weight: 600; display: block; margin: 2px 0; }
  a.title:hover { text-decoration: underline; }
  .price { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
  .price strong { font-size: 17px; }
  .price s { color: #6B6B6B; font-size: 13px; }
  .tag { color: #3DA35D; font-size: 12px; font-weight: 700; }
  .note { color: #999; font-size: 13px; margin-top: 2px; }
  .claim {
    flex: none; background: #232323; color: #F5F5F5; border: 1px solid #2A2A2A;
    border-radius: 8px; padding: 8px 10px; font-size: 12px; font-weight: 700; cursor: pointer;
  }
  .claim:hover { border-color: #D85A30; }
  .claim:disabled { opacity: .5; }
  .empty { text-align: center; padding: 48px 0; color: #999; }
  footer { margin-top: 32px; border-top: 1px solid #2A2A2A; padding-top: 20px; color: #6B6B6B; font-size: 13px; }
  .cta {
    display: inline-block; margin-top: 12px; background: #D85A30; color: #0D0D0D;
    text-decoration: none; font-weight: 800; padding: 12px 20px; border-radius: 12px;
  }
  .cta-soon { color: #999; margin-top: 12px; }
  .contact { margin-top: 16px; font-size: 12px; }
  .contact a { color: #999; }
</style>
</head>
<body>${body}</body>
</html>`;
}
function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
const escapeAttr = escapeHtml;
