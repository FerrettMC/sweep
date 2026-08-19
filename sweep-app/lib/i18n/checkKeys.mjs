// lib/i18n/checkKeys.mjs — every t("…") in the app resolves to a real string.
//   npm run test:i18n
//
// Written after a button shipped reading "plans.createAccount". translate()
// falls back to the key itself when it can't find one, which is the right
// runtime behaviour — a raw key on screen is better than a crash — but it
// means a typo or a forgotten key looks completely fine until someone opens
// that screen. Nothing else catches it: TypeScript can't, because keys are
// strings, and the parity check only compares the two locales to each other.
import fs from "fs";
import path from "path";

const root = path.resolve(import.meta.dirname, "../..");
const src = fs.readFileSync(path.join(root, "lib/i18n/translations.ts"), "utf8");

const enBody = src.slice(src.indexOf("export const en = {"), src.indexOf("export const es"));
const esBody = src.slice(src.indexOf("export const es"));

function keysOf(body) {
  const out = new Set();
  let section = null;
  for (const line of body.split("\n")) {
    let m = line.match(/^  ([a-zA-Z]+): \{/);
    if (m) { section = m[1]; continue; }
    m = line.match(/^    ([a-zA-Z]+):/);
    if (m && section) out.add(`${section}.${m[1]}`);
  }
  return out;
}

const en = keysOf(enBody);
const es = keysOf(esBody);

// Every source file that could call t().
const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.tsx?$/.test(entry.name)) files.push(full);
  }
})(root);

const used = new Map();
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  for (const m of text.matchAll(/\bt\(\s*"([a-zA-Z]+\.[a-zA-Z]+)"/g)) {
    if (!used.has(m[1])) used.set(m[1], path.relative(root, file));
  }
}

let failed = 0;

const missing = [...used].filter(([key]) => !en.has(key));
if (missing.length) {
  failed = 1;
  console.log(`\n❌ ${missing.length} key(s) used but not defined:`);
  for (const [key, file] of missing) console.log(`   ${key.padEnd(32)} ${file}`);
} else {
  console.log(`✅ all ${used.size} keys used in the app exist`);
}

const gaps = [...en].filter((k) => !es.has(k));
if (gaps.length) {
  failed = 1;
  console.log(`\n❌ ${gaps.length} key(s) missing from Spanish: ${gaps.join(", ")}`);
} else {
  console.log(`✅ ${en.size} keys, both locales in step`);
}

// Unused keys are only worth reporting, not failing: some are referenced
// dynamically, and dead copy costs nothing but tidiness.
const unused = [...en].filter((k) => !used.has(k));
if (unused.length) console.log(`\nℹ️  ${unused.length} defined but not referenced directly`);

process.exit(failed);
