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
// Counted over the markup only. CSS and script bodies routinely contain things
// that look like tags — a comment naming <div class="hero wrap"> was enough to
// report the document as unbalanced when it was perfectly fine.
const markup = html
  .replace(/<style>[\s\S]*?<\/style>/g, "")
  .replace(/<script>[\s\S]*?<\/script>/g, "");

for (const tag of ["html", "head", "body", "div", "section", "footer", "svg", "picture"]) {
  const open = (markup.match(new RegExp(`<${tag}[ >]`, "g")) ?? []).length;
  const close = (markup.match(new RegExp(`</${tag}>`, "g")) ?? []).length;
  check(`<${tag}> balances`, open === close, { open, close });
}
// Those two are stripped above, so count them on the original.
for (const tag of ["style", "script"]) {
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

console.log("\n— layout classes don't clobber each other —");
// .wrap is combined with .hero, .closing, section and footer, all of which set
// their own padding. With the `padding` shorthand they overwrite each other in
// whichever direction specificity and source order happen to fall — which is
// how the text ended up flat against the edge of the screen on a phone while
// the sections lost their vertical rhythm. Longhands cannot collide.
const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
// EVERY rule mentioning the selector, not just the first one found. `footer`
// appears three times here, and checking only the first was checking a rule
// with no padding in it at all — a test that passed by looking somewhere else.
/**
 * Every top-level style rule, walked rather than matched.
 *
 * A flat regex cannot read this stylesheet: @media and @keyframes nest, so a
 * pattern that pairs the next brace with the next closing brace desynchronises
 * at the first one and silently reports some rules and not others. That is
 * exactly what happened — a perspective check came back failing for three
 * selectors that had it, because the parser never saw those rules at all.
 *
 * Rules inside @media are skipped deliberately: the reduced-motion block exists
 * to switch effects OFF, and counting it would have every check pass on the
 * rule that disables the thing being checked.
 */
function topLevelRules(raw: string): { selector: string; body: string }[] {
  // Comments first. Everything between the previous closing brace and the next
  // opening one is the selector, and this stylesheet is heavily commented — so
  // without this, .proof arrives as "/* ---- the proof ... */ .proof" and no
  // exact match ever succeeds.
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: { selector: string; body: string }[] = [];
  let i = 0;
  let selector = "";

  while (i < source.length) {
    const ch = source[i];
    if (ch === "{") {
      const name = selector.trim();
      let depth = 1;
      let j = i + 1;
      while (j < source.length && depth > 0) {
        if (source[j] === "{") depth++;
        else if (source[j] === "}") depth--;
        j++;
      }
      // At-rules hold rules of their own; their bodies are not declarations.
      if (!name.startsWith("@")) out.push({ selector: name, body: source.slice(i + 1, j - 1) });
      selector = "";
      i = j;
      continue;
    }
    if (ch === "}") {
      selector = "";
      i++;
      continue;
    }
    selector += ch;
    i++;
  }
  return out;
}

const rules = topLevelRules(css);

for (const name of [".wrap", ".hero", "section", ".closing", "footer"]) {
  const touching = rules.filter((r) =>
    new RegExp(`(^|[\\s,])${name.replace(".", "\\.")}([\\s,{]|$)`).test(`${r.selector} `),
  );
  check(`${name}: found its rules`, touching.length > 0, touching.length);
  const shorthand = touching.filter((r) => /(^|[;\s])padding:/.test(r.body));
  check(
    `${name}: no padding shorthand anywhere`,
    shorthand.length === 0,
    shorthand.map((r) => r.selector),
  );
}
check(".wrap insets horizontally", /\.wrap\s*\{[^}]*padding-left:/.test(css));
check("sections space vertically", /section\s*\{[^}]*padding-top:/.test(css));

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

console.log("\n— the motion stays cheap —");
// Everything that moves must move with transform or opacity. Animating
// anything else — width, top, filter — forces layout or paint on every frame,
// and this page runs several things at once on phones.
// Brace-matched rather than regex-matched: keyframe bodies contain nested
// blocks, and a lazy regex stops at the first closing brace while a greedy one
// runs into whatever rule comes next. The first version of this check did the
// latter and reported six failures that were all its own.
function keyframeBodies(source: string): string[] {
  const out: string[] = [];
  const re = /@keyframes\s+[\w-]+\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const from = i;
    while (i < source.length && depth > 0) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") depth--;
      i++;
    }
    out.push(source.slice(from, i - 1));
  }
  return out;
}

const animated = keyframeBodies(css);
check("found the keyframes", animated.length >= 5, animated.length);
// box-shadow and stroke-dashoffset are paint-only and deliberately allowed —
// what must never appear is anything that forces a layout on every frame.
const banned = /(^|[;{\s])(width|height|top|left|right|bottom|margin|padding|font-size):/;
for (const body of animated) {
  check(
    `keyframe animates only cheap properties: ${body.trim().slice(0, 34)}`,
    !banned.test(body),
    body.trim().slice(0, 80),
  );
}

check("a single mousemove listener", (script.match(/addEventListener\("mousemove"/g) ?? []).length === 1);
check("a single scroll listener", (script.match(/addEventListener\("scroll"/g) ?? []).length === 1);
check("both are passive", (script.match(/passive: true/g) ?? []).length >= 2);
check("pointer work is frame-throttled", /requestAnimationFrame\(paint\)/.test(script));
// A touch device never fires mousemove; the resting pose in CSS is the effect
// there, and the listener should not even be attached.
check("pointer effects are gated on having a pointer", /matchMedia\("\(hover: hover\)"\)/.test(script));

check("reduced motion disables the overlays", /prefers-reduced-motion[\s\S]*?\.spot, \.grain, \.prog \{ display:none/.test(css));

console.log("\n— the depth carries past the hero —");
// The point of the rebuild: the hero was three-dimensional and everything below
// it was flat. These are the pieces that fix that, and they are easy to lose in
// a later edit because nothing breaks when they go.
check("sections arrive in 3D", /\.rise \{[^}]*rotateX/.test(css));
check("and settle flat", /\.rise\.in \{[^}]*rotateX\(0deg\)/.test(css));
check("panels tilt, not just cards", (html.match(/data-tilt/g) ?? []).length >= 8, (html.match(/data-tilt/g) ?? []).length);
check("the tilt is driven by the attribute", /querySelectorAll\("\[data-tilt\]"\)/.test(script));
check("stats have depth", /\.stat b \{[^}]*translateZ/.test(css));
check("the proof panel has depth", /\.proof \.verdict \{[^}]*translateZ/.test(css));
check("the closing is a lit slab", /\.slab \{[^}]*perspective/.test(css));
check("the background parallaxes", /--par/.test(css) && /--par/.test(script));

// Every element that tilts must have its own perspective. One shared scene
// swings whatever sits far from its vanishing point, and these run the full
// height of the document.
// ANY rule for the selector, not the first one found — .feat is styled across
// several rules and its perspective lives in a later one. Checking only the
// first is the same mistake the padding check made.
for (const sel of [".feat", ".stat", ".proof", ".slab", ".rise"]) {
  const mine = rules.filter((r) => r.selector.split(",").some((one) => one.trim() === sel));
  check(`${sel}: has rules`, mine.length > 0, mine.length);
  check(
    `${sel}: carries its own perspective`,
    mine.some((r) => /perspective\(/.test(r.body)),
    mine.map((r) => r.selector),
  );
}

// Off-screen elements must be skipped before the maths runs — a long page has
// dozens of these and most are nowhere near the cursor.
check("off-screen tilters are skipped", /r\.bottom < 0 \|\| r\.top > h/.test(script));

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
