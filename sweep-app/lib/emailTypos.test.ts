// lib/emailTypos.test.ts — the "did you mean?" suggestion.
//   npm run test:email-typos     (plain node, no device)
import { suggestEmail } from "./emailTypos";

let pass = 0,
  fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok && detail !== undefined) console.log("     ", JSON.stringify(detail));
};

console.log("\n— the typos people actually make —");
const typos: [string, string][] = [
  ["ferret@gmial.com", "ferret@gmail.com"],
  ["ferret@gmai.com", "ferret@gmail.com"],
  ["ferret@gmail.con", "ferret@gmail.com"],
  ["ferret@gmail.co", "ferret@gmail.com"],
  ["ferret@gmail.cm", "ferret@gmail.com"],
  ["ferret@hotmial.com", "ferret@hotmail.com"],
  ["ferret@hotmail.con", "ferret@hotmail.com"],
  ["ferret@yaho.com", "ferret@yahoo.com"],
  ["ferret@outlok.com", "ferret@outlook.com"],
  ["ferret@icloud.co", "ferret@icloud.com"],
];
for (const [typed, want] of typos) {
  check(`${typed} → ${want.split("@")[1]}`, suggestEmail(typed) === want, suggestEmail(typed));
}

console.log("\n— real addresses are never questioned —");
const fine = [
  "ferret@gmail.com",
  "ferret@yahoo.co.uk",
  "ferret@proton.me",
  "ferret@me.com",
  "ferret@mail.com",       // a real provider one edit from gmail.com
  "ferret@pm.me",          // a real provider close to me.com
  "ferretonyt@gmail.com",
];
for (const address of fine) {
  check(`${address} left alone`, suggestEmail(address) === null, suggestEmail(address));
}

console.log("\n— domains we've never heard of are left alone —");
// The common case for anyone with a work or school address. Suggesting here
// would be both wrong and insulting.
const unknown = [
  "ferret@sweepshopping.com",
  "ferret@anthropic.com",
  "student@cambridge.ac.uk",
  "me@my-startup.io",
  "ferret@bbc.co.uk",
];
for (const address of unknown) {
  check(`${address} left alone`, suggestEmail(address) === null, suggestEmail(address));
}

console.log("\n— nothing said while still typing —");
const partial = ["", "  ", "ferret", "ferret@", "@gmail.com", "ferret@@gmail.com", "a@b"];
for (const address of partial) {
  check(`"${address}" → no suggestion`, suggestEmail(address) === null, suggestEmail(address));
}

console.log("\n— the local part is never touched —");
// We can't second-guess a name. Only the domain is ever changed.
const suggestion = suggestEmail("Weird.Name+tag_123@gmial.com");
check(
  "local part preserved exactly",
  suggestion === "Weird.Name+tag_123@gmail.com",
  suggestion,
);
check(
  "case in the local part survives",
  suggestEmail("FerretOnYT@gmial.com") === "FerretOnYT@gmail.com",
  suggestEmail("FerretOnYT@gmial.com"),
);

console.log("\n— a suggestion is always itself valid —");
// A suggestion that still has a typo would be worse than none.
const suggestions = typos.map(([typed]) => suggestEmail(typed));
check(
  "every suggestion lands on a known domain and needs no further fixing",
  suggestions.every((s) => s !== null && suggestEmail(s) === null),
  suggestions,
);

console.log("\n— whitespace —");
check("surrounding spaces ignored", suggestEmail("  ferret@gmial.com  ") === "ferret@gmail.com");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
