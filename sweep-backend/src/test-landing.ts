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
check("declares both colour schemes", html.includes("prefers-color-scheme: dark"));

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
