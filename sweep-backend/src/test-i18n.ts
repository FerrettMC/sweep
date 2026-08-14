// src/test-i18n.ts — translation parity and lookup.
//   npm run test:i18n     (no server or database needed)
import { LOCALES, STRINGS, allKeys, localeFrom, t } from "./lib/i18n.js";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, d?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${l}`);
  if (!ok && d !== undefined) console.log("     ", JSON.stringify(d).slice(0, 300));
};

console.log("\n— every locale has every key —");
const keys = allKeys();
console.log(`  ${keys.length} keys, ${LOCALES.length} locales`);
for (const locale of LOCALES) {
  const missing = keys.filter((k) => !(k in STRINGS[locale]));
  check(`${locale}: no missing keys`, missing.length === 0, missing);
  const extra = Object.keys(STRINGS[locale]).filter((k) => !keys.includes(k as never));
  check(`${locale}: no orphan keys`, extra.length === 0, extra);
}

console.log("\n— placeholders match across locales —");
const bad: string[] = [];
for (const key of keys) {
  const en = (STRINGS.en[key].match(/\{(\w+)\}/g) ?? []).sort().join(",");
  for (const locale of LOCALES) {
    const other = ((STRINGS[locale] as Record<string, string>)[key].match(/\{(\w+)\}/g) ?? []).sort().join(",");
    // A translation that drops {limit} renders a sentence with a hole in it.
    if (en !== other) bad.push(`${key} en:[${en}] ${locale}:[${other}]`);
  }
}
check(`no placeholder drift`, bad.length === 0, bad);

console.log("\n— nothing left untranslated by accident —");
const identical = keys.filter(
  (k) => STRINGS.en[k] === (STRINGS.es as Record<string, string>)[k] && STRINGS.en[k].length > 3,
);
// Legitimately identical: proper nouns, pure placeholders, and "manual",
// which is the same word in both languages.
const expected = new Set([
  "plan.pro.name",
  "plan.ultimate.name",
  "dial.radar",
  "dial.radarManual",
  "push.dropTitle",
  "push.radarTitle",
  "dial.none",
]);
const unexpected = identical.filter((k) => !expected.has(k));
check(`only proper nouns are identical`, unexpected.length === 0, unexpected);

console.log("\n— Accept-Language parsing —");
const cases: [string | undefined, string][] = [
  [undefined, "en"], ["en", "en"], ["es", "es"], ["es-MX", "es"],
  ["es-419,es;q=0.9,en;q=0.8", "es"], ["fr-FR,fr;q=0.9", "en"],
  ["EN-GB", "en"], ["", "en"], ["de,es;q=0.7", "es"],
];
for (const [header, want] of cases) {
  const got = localeFrom(header);
  check(`"${header ?? "(none)"}" -> ${got}`, got === want, { want, got });
}

console.log("\n— interpolation —");
check("substitutes values", t("es", "err.trackLimit", { limit: 20 }).includes("20"));
check("translates, not just passes through", t("es", "err.searchLimit") !== t("en", "err.searchLimit"));
check("unknown locale key falls back to English", t("es", "plan.free.name") === "Gratis");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
