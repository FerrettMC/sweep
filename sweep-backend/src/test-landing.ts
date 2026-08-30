// src/test-landing.ts — the page at /.
//   npm run test:landing
//
// This is where most people who hear about Sweep actually land: it's the URL in
// the Play listing, in every affiliate application, and wherever the app gets
// mentioned. It is also assembled inside a TypeScript template literal, where a
// stray brace or backslash produces broken markup rather than an error.
//
// The check that matters most is the store list. It is generated from live
// config precisely so the site can't advertise a store we don't search — the
// same bug that was caught in onboarding, and a worse place to have it, since
// this page is what retailers read when we ask them for API access.
import "./testEnv.js";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { landingRoutes } from "./routes/landing.js";

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok && detail !== undefined) console.log("     ", JSON.stringify(detail));
};

const app = Fastify();
await app.register(landingRoutes);

const before = process.env.DISABLED_RETAILERS;
process.env.DISABLED_RETAILERS = "bestbuy,newegg,asos";

const res = await app.inject({ method: "GET", url: "/" });
const html = res.body;

console.log("\n— it renders —");
check("200", res.statusCode === 200, res.statusCode);
check("is html", (res.headers["content-type"] ?? "").toString().includes("text/html"));
check("has a doctype", html.trimStart().startsWith("<!doctype"));
check("nothing left uninterpolated", !html.includes("${"), html.slice(html.indexOf("${"), 60));

console.log("\n— the markup closes —");
for (const tag of ["html", "head", "body", "div", "section", "footer", "svg", "style"]) {
  const open = (html.match(new RegExp(`<${tag}[ >]`, "g")) ?? []).length;
  const close = (html.match(new RegExp(`</${tag}>`, "g")) ?? []).length;
  check(`<${tag}> balances`, open === close, { open, close });
}

console.log("\n— it never advertises a store we don't search —");
check("disabled stores are absent from the store row",
  !/class="store"[^>]*>[\s\S]{0,80}(Best Buy|Newegg|ASOS)/.test(html));
for (const live of ["Amazon", "Walmart", "eBay", "Etsy"]) {
  check(`${live} is listed`, html.includes(`>${live}</span>`));
}

console.log("\n— the things people came for —");
check("links to Play", html.includes("play.google.com/store/apps/details?id=com.sweepshopping.app"));
check("links to privacy", html.includes('href="/privacy"'));
check("links to account deletion", html.includes('href="/delete-account"'));
check("has a support address", html.includes("mailto:"));
check("unfurls with a description", html.includes('property="og:description"'));
check("is mobile-scaled", html.includes("width=device-width"));
// Dark only now, deliberately: the app is dark and the hero is a dark
// screenshot, so a light page handing over to a dark app is a jolt. What
// matters then is that it commits — a page that sets no background inherits
// whatever the browser felt like, which is white for a light-mode user.
check("paints its own background", /body\s*\{[^}]*background:var\(--bg\)/.test(html));
check("paints its own text colour", /body\s*\{[^}]*color:var\(--fg\)/.test(html));
check("tells the browser chrome it is dark", html.includes('name="theme-color"'));
check("honours reduced motion", html.includes("prefers-reduced-motion"));

console.log("\n— the page's own script runs —");
// This page carries JavaScript inside a TypeScript template literal now, where
// a lone backslash becomes a real line break in the output. That has broken
// inline pages in this repo twice, and it fails silently: the HTML renders, the
// script dies, and the animations simply never start.
const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("</script>"));
check("a script block was found", script.length > 200, script.length);

const tmp = join(tmpdir(), `sweep-landing-${Date.now()}.js`);
let syntaxError: string | null = null;
try {
  writeFileSync(tmp, script);
  execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" });
} catch (err) {
  syntaxError = err instanceof Error ? err.message.split("\n").slice(0, 3).join(" ") : String(err);
} finally {
  rmSync(tmp, { force: true });
}
check("it parses as valid JavaScript", syntaxError === null, syntaxError);

console.log("\n— the hero image —");
// Referenced but not bundled: nothing imports it, so only the Dockerfile's COPY
// puts it in the image. Getting that wrong 404s a picture that works locally.
check("the page asks for it", html.includes("/assets/hero.webp"));
check("with a png fallback", html.includes("/assets/hero.png"));
check("and describes it", /alt="[^"]{25,}"/.test(html));
check("the webp exists on disk", existsSync(join(process.cwd(), "assets", "hero.webp")));
check("the png exists on disk", existsSync(join(process.cwd(), "assets", "hero.png")));
const docker = readFileSync(join(process.cwd(), "Dockerfile"), "utf8");
check("the Dockerfile ships them", (docker.match(/COPY .*assets/g) ?? []).length >= 2, docker.match(/COPY .*assets/g));

console.log("\n— it still says the honest part —");
// The differentiator. If this ever gets trimmed as "filler", that's a decision
// worth making on purpose rather than by accident.
check("says who builds it", html.includes("16-year-old developer"));
check("says it isn't affiliated", html.includes("not\n      affiliated") || html.includes("not affiliated"));
check("says free features are free", /cost nothing/.test(html));

if (before === undefined) delete process.env.DISABLED_RETAILERS;
else process.env.DISABLED_RETAILERS = before;
await app.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
