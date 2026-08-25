// src/test-video2.ts — the /video2 b-roll actually runs.
//   npm run test:video2
//
// This page lives inside a TypeScript template literal, where a lone backslash
// becomes a real line break in the served JavaScript. That has broken this
// codebase's inline pages twice, and it fails silently: the HTML renders, the
// script dies, and the animation simply never starts — which you only notice
// while recording.
//
// It also checks the claims. Every string on that page is quoted from the app,
// and a video is the worst place for the app's wording to have drifted.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const source = readFileSync(new URL("./routes/videoMock2.ts", import.meta.url), "utf8");

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok && detail !== undefined) console.log("     ", JSON.stringify(detail));
};

console.log("\n— the script survives the template literal —");
const script = source.slice(
  source.indexOf("<script>") + "<script>".length,
  source.indexOf("</script>"),
);
check("a script block was found", script.length > 200, script.length);

const tmp = join(tmpdir(), `sweep-video2-${Date.now()}.js`);
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

// The specific way this file breaks: a real newline inside a JS string.
check("no unescaped backslashes in the page", !/\\(?!\\)/.test(source.slice(source.indexOf("const PAGE"))));

console.log("\n— every beat is wired up —");
const ids = [...source.matchAll(/id="(s\d+)"/g)].map((m) => m[1]);
const beats = [...script.matchAll(/\["(s\d+)"/g)].map((m) => m[1]);
check("every scene appears in the timeline", ids.every((id) => beats.includes(id)), { ids, beats });
check("every timeline entry has a scene", beats.every((b) => ids.includes(b)), { ids, beats });
check("the timeline is a loop", script.includes("% BEATS.length"));

console.log("\n— it is the length it claims to be —");
const holds = [...script.matchAll(/,\s*(\d{4})\]/g)].map((m) => Number(m[1]));
const total = holds.reduce((a, b) => a + b, 0);
check("every beat has a hold", holds.length === beats.length, { holds, beats: beats.length });
// Long enough to narrate, short enough for a vertical feed.
check(`total runtime is ${(total / 1000).toFixed(1)}s`, total >= 20000 && total <= 35000, total);
check("no beat is too short to speak over", holds.every((h) => h >= 2500), holds);

console.log("\n— the copy is the app's, not invented —");
const translations = readFileSync(
  new URL("../../sweep-app/lib/i18n/translations.ts", import.meta.url),
  "utf8",
);
const verdicts = readFileSync(new URL("./lib/saleVerdict.ts", import.meta.url), "utf8");

for (const phrase of ["Is this sale real?", "Price history", "What buyers say", "Shipping"]) {
  check(`"${phrase}" is a real section header`, translations.includes(phrase) && source.includes(phrase));
}
check('"Lowest price we\'ve seen" is the real verdict', verdicts.includes("Lowest price we've seen"));
check("the page uses it", source.includes("Lowest price we&rsquo;ve seen"));
check('"is just the normal price" is the real verdict', verdicts.includes("is just the normal price"));

console.log("\n— it only shows stores that are live —");
// Walmart included deliberately: it was switched on. Best Buy is not, and a
// demo of a store nobody can use is the kind of thing people notice.
for (const live of ["Amazon", "Walmart", "eBay", "Etsy"]) {
  check(`${live} appears`, source.includes(`>${live}<`));
}
for (const off of ["Best Buy", "Newegg", "ASOS"]) {
  check(`${off} does not`, !source.includes(off));
}

console.log("\n— no fabricated discount is pinned on a named store —");
const claimBlock = source.slice(source.indexOf('hlBadge claim'), source.indexOf('hlBadge claim') + 400);
check("the big claim belongs to a marketplace seller",
  claimBlock.includes("Marketplace seller"), claimBlock.slice(0, 160));
for (const brand of ["Amazon", "Walmart", "eBay", "Etsy"]) {
  check(`it is not attributed to ${brand}`, !claimBlock.includes(brand));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
