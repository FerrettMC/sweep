// src/test-probe.ts — the admin probe, and the things it must refuse.
//   npm run test:probe
//
// This endpoint makes the production server fetch a url somebody typed. That is
// the shape of every SSRF, and the admin key is not the whole defence — a key
// can leak, and what sits behind this one includes the cloud metadata service,
// which hands credentials to anything on the box that asks it nicely.
//
// So the refusals get tested harder than the happy path. The happy path failing
// is an inconvenience; a refusal failing is a credential leak.
import "./testEnv.js";
import { _internal, probe } from "./lib/probe.js";

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok && detail !== undefined) console.log("     ", JSON.stringify(detail));
};

const { isForbiddenAddress, refuse, bouncedToRoot } = _internal;

console.log("\n— addresses the server must never fetch —");
for (const ip of [
  "127.0.0.1", "127.1.1.1", "0.0.0.0",
  "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1",
  "169.254.169.254", // the one that matters: cloud metadata
  "100.64.0.1",
  "::1", "fc00::1", "fd12::34", "fe80::1",
  "::ffff:127.0.0.1", "::ffff:169.254.169.254",
]) {
  check(`refuses ${ip}`, isForbiddenAddress(ip), ip);
}

console.log("\n— addresses it may —");
for (const ip of ["1.1.1.1", "8.8.8.8", "23.55.1.9", "172.32.0.1", "192.169.0.1", "2606:4700::1111"]) {
  check(`allows ${ip}`, !isForbiddenAddress(ip), ip);
}

console.log("\n— urls refused before any request goes out —");
check("localhost by name", (await refuse("http://localhost:3001/admin")) !== null);
check("127.0.0.1 directly", (await refuse("http://127.0.0.1/")) !== null);
check("the metadata service", (await refuse("http://169.254.169.254/latest/meta-data/")) !== null);
check("file urls", (await refuse("file:///etc/passwd")) !== null);
check("gopher urls", (await refuse("gopher://example.com/")) !== null);
check("nonsense", (await refuse("not a url")) !== null);
check("a real public url is allowed", (await refuse("https://example.com/")) === null);

console.log("\n— what it reports —");
const good = await probe("https://example.com/");
check("reaches a public page", good.status === 200, { status: good.status, error: good.error });
check("times it", good.ms > 0);
check("measures it", good.bytes > 0);
check("finds no challenge on a plain page", good.challenges.length === 0, good.challenges);
check("refuses nothing", good.refused === null);

const blocked = await probe("http://169.254.169.254/latest/meta-data/");
check("metadata is refused, not fetched", blocked.refused !== null, blocked);
check("and no status comes back", blocked.status === null);
// The distinction matters when reading the result: refused is our guard,
// error is the network, and a challenge is the store.
check("refusal is not reported as an error", blocked.error === null);

console.log("\n— a bounce to the homepage is a block, not a success —");
// The failure this was written for: Walmart answered a product url with its
// homepage, which carries __NEXT_DATA__ and a handful of carousel prices, so
// the probe called it "reachable, with product data". It was a soft block.
check("product url to root is a bounce",
  bouncedToRoot("https://www.walmart.com/ip/12345", "https://www.walmart.com/"));
check("search url to root is a bounce",
  bouncedToRoot("https://www.newegg.com/p/pl?d=ssd", "https://www.newegg.com/"));
// And the cases that are NOT a bounce, which matter just as much — flagging a
// normal redirect as a block sends you chasing a proxy you do not need.
check("homepage to homepage is not", !bouncedToRoot("https://x.com/", "https://x.com/"));
check("a trailing slash is not", !bouncedToRoot("https://x.com/a/b", "https://x.com/a/b/"));
check("adding a locale is not", !bouncedToRoot("https://x.com/shoes", "https://x.com/us/shoes"));
// A query string on the root does not make it a destination.
check("root with a query is still a bounce",
  bouncedToRoot("https://x.com/p/1", "https://x.com/?ref=home"));

console.log("\n— a store that is actually blocked reads as blocked —");
// Newegg refuses datacenters, which is the whole reason this exists. From a
// home connection it answers, so this asserts the SHAPE of the result rather
// than a verdict that depends on where the tests are run.
const store = await probe("https://www.newegg.com/p/pl?d=ssd");
check("returns a usable result either way",
  store.refused === null && (store.status !== null || store.error !== null), store);
if (store.status === 200) {
  check("and says whether a parser would find anything",
    Array.isArray(store.markers) && typeof store.priceish === "number");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
