// src/test-appads.ts — the file AdMob checks before it will serve ads.
//   npm run test:appads
//
// Verification failing is silent from our side: AdMob just keeps saying
// unverified. So the ways it can be subtly wrong are worth pinning down, since
// none of them announce themselves.
import Fastify from "fastify";
import { appAdsRoutes } from "./routes/appAds.js";

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok && detail !== undefined) console.log("     ", JSON.stringify(detail));
};

const app = Fastify();
await app.register(appAdsRoutes);
const get = () => app.inject({ method: "GET", url: "/app-ads.txt" });

const before = process.env.ADMOB_PUBLISHER_ID;

console.log("\n— configured —");
process.env.ADMOB_PUBLISHER_ID = "pub-1234567890123456";
let res = await get();
check("200", res.statusCode === 200, res.statusCode);
// A crawler expecting text and handed JSON reads it as malformed, not missing.
check("is plain text", (res.headers["content-type"] ?? "").toString().includes("text/plain"));
check("the exact line Google wants",
  res.body.trim() === "google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0", res.body);
check("ends with a newline", res.body.endsWith("\n"));

console.log("\n— pasted in whatever form —");
process.env.ADMOB_PUBLISHER_ID = "1234567890123456";
check("a bare id gets the prefix", (await get()).body.includes("pub-1234567890123456"));
process.env.ADMOB_PUBLISHER_ID = "  pub-1234567890123456  ";
check("whitespace is trimmed", (await get()).body.includes("pub-1234567890123456"));

console.log("\n— the wrong id is refused, not published —");
// The APP id and the PUBLISHER id look alike and are not interchangeable.
// Serving the app id would produce a file that verifies against nothing while
// looking entirely plausible.
for (const wrong of [
  "ca-app-pub-5462924462242718~3822342819",
  "ca-app-pub-5462924462242718/3650952420",
  "pub-123",
  "not an id",
]) {
  process.env.ADMOB_PUBLISHER_ID = wrong;
  check(`refuses ${wrong.slice(0, 30)}`, (await get()).statusCode === 404, wrong);
}

console.log("\n— unset —");
delete process.env.ADMOB_PUBLISHER_ID;
res = await get();
check("404 rather than an empty file", res.statusCode === 404, res.statusCode);
// An EMPTY app-ads.txt is a valid declaration that nobody may sell this
// inventory. Publishing one would block the ads it exists to enable.
check("and never an empty body", res.body.trim().length > 0);

if (before === undefined) delete process.env.ADMOB_PUBLISHER_ID;
else process.env.ADMOB_PUBLISHER_ID = before;
await app.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
