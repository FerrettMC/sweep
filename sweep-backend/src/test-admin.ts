// test-admin.ts — the admin portal's guards and numbers.
//   npm run test:admin
//
// The portal can only read, so the risk isn't corruption — it's exposure. Every
// number here is about the business, and the heaviest-use table has real email
// addresses in it, so the auth checks matter more than the arithmetic.
import "./testEnv.js";
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import { prisma } from "./lib/prisma.js";
import { adminRoutes } from "./routes/admin.js";
import { getAdminStats } from "./lib/adminStats.js";

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok && detail !== undefined) console.log("     ", JSON.stringify(detail).slice(0, 300));
};

const KEY = "test-admin-key-0123456789";
process.env.ADMIN_API_KEY = KEY;

const app = Fastify();
await app.register(adminRoutes);

try {
  console.log("\n— the page itself —");
  const page = await app.inject({ method: "GET", url: "/admin" });
  check("serves without a key", page.statusCode === 200, page.statusCode);
  check("contains no data, only the login form", !page.body.includes("heaviest\":"), "leaked data");
  check("asks search engines not to index it", page.body.includes("noindex"));

  console.log("\n— the page's own JavaScript parses —");
  // This page is built inside a TypeScript template literal, so every
  // backslash has to be doubled. Getting one wrong drops a real line break
  // into a JS string and kills the WHOLE script — the sign-in button stops
  // working because of a typo in an announcement template hundreds of lines
  // away, with nothing on screen to say so. It happened twice.
  //
  // node --check on the extracted script is the only thing that catches it
  // without opening a browser.
  const script = page.body.slice(
    page.body.indexOf("<script>") + 8,
    page.body.lastIndexOf("</script>"),
  );
  check("there is a script to check", script.length > 500, script.length);

  const tmp = `${tmpdir()}/sweep-admin-page-${Date.now()}.js`;
  writeFileSync(tmp, script);
  let syntaxError: string | null = null;
  try {
    execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" });
  } catch (err) {
    syntaxError = String((err as { stderr?: Buffer }).stderr ?? err).slice(0, 400);
  } finally {
    rmSync(tmp, { force: true });
  }
  check("it parses as valid JavaScript", syntaxError === null, syntaxError);

  // The handlers wired to onclick must actually exist, or the buttons are
  // decoration. A parse error is one way to lose them; a rename is another.
  for (const fn of ["signIn", "signOut", "announce", "useTemplate", "counts", "load"]) {
    check(`${fn}() is defined`, new RegExp(`function ${fn}\\s*\\(`).test(script));
  }

  console.log("\n— stats are guarded —");
  const noKey = await app.inject({ method: "GET", url: "/admin/stats" });
  check("no key is refused", noKey.statusCode === 401, noKey.statusCode);

  const wrong = await app.inject({
    method: "GET", url: "/admin/stats", headers: { "x-admin-key": "wrong-key-same-length!!" },
  });
  check("wrong key is refused", wrong.statusCode === 401, wrong.statusCode);

  const shortKey = await app.inject({
    method: "GET", url: "/admin/stats", headers: { "x-admin-key": "x" },
  });
  check("a short key doesn't crash the comparison", shortKey.statusCode === 401, shortKey.statusCode);

  const right = await app.inject({
    method: "GET", url: "/admin/stats", headers: { "x-admin-key": KEY },
  });
  check("the right key is accepted", right.statusCode === 200, right.statusCode);

  console.log("\n— refuses when unconfigured —");
  delete process.env.ADMIN_API_KEY;
  const unset = await app.inject({
    method: "GET", url: "/admin/stats", headers: { "x-admin-key": KEY },
  });
  // Defaulting open would expose every user's email to anyone who guessed the
  // path, on a deploy where someone forgot one environment variable.
  check("no key configured means 503, not open", unset.statusCode === 503, unset.statusCode);
  process.env.ADMIN_API_KEY = KEY;

  console.log("\n— the numbers hold together —");
  const stats = await getAdminStats();
  check("every field is present", Boolean(stats.users && stats.tiers && stats.usage && stats.retailers));
  check(
    "tier counts sum to the number of wallets",
    stats.tiers.free + stats.tiers.pro + stats.tiers.ultimate === (await prisma.wallet.count()),
    stats.tiers,
  );
  check("new today never exceeds the total", stats.users.newToday <= stats.users.total);
  check("new today never exceeds new this week", stats.users.newToday <= stats.users.newThisWeek);
  check("every retailer appears", stats.retailers.length >= 5, stats.retailers.length);
  check(
    "success rates are a fraction or null",
    stats.retailers.every((r) => r.successRate === null || (r.successRate >= 0 && r.successRate <= 1)),
  );
  check(
    "the metered ceiling is searches plus lookups",
    stats.usage.meteredCeiling === stats.usage.searchesToday + stats.usage.lookupsToday,
  );
  check("heaviest list is bounded", stats.heaviest.length <= 8, stats.heaviest.length);
} finally {
  await app.close();
  await prisma.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
