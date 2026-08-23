// lib/linkify.test.ts — which links in an announcement become tappable.
//   npm run test:linkify
//
// The allow-list is a security boundary, not a formatting choice: announcements
// go to every user, so a link they can tap is a link somebody with the admin
// key chose to put in front of all of them.
import { linkify } from "./linkify";

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok && detail !== undefined) console.log("     ", JSON.stringify(detail));
};
const linked = (s: string) => linkify(s).filter((p) => p.url).map((p) => p.url);

console.log("\n— our own links become tappable —");
check("bare domain", linked("Read more at sweepshopping.com today")[0] === "https://sweepshopping.com");
check("with https", linked("see https://sweepshopping.com/privacy")[0] === "https://sweepshopping.com/privacy");
check("subdomain", linked("api.sweepshopping.com/admin").length === 1);
check("the Play listing", linked("https://play.google.com/store/apps/details?id=x").length === 1);

console.log("\n— everything else stays plain text —");
// The point of the allow-list. A stolen admin key must not become a phishing
// link delivered to the entire userbase.
for (const bad of [
  "totally-not-phishing.com",
  "https://sweepshopping.com.evil.co/steal",
  "http://evil.co/sweepshopping.com",
  "bit.ly/abc",
  "sweepshopping.com.attacker.net",
]) {
  check(`"${bad.slice(0, 38)}" not linked`, linked(bad).length === 0, linkify(bad));
}

console.log("\n— the text survives intact —");
const mixed = "Go to sweepshopping.com or evil.co for more";
check(
  "every character is preserved",
  linkify(mixed).map((p) => p.text).join("") === mixed,
  linkify(mixed),
);
check("only one part is tappable", linkify(mixed).filter((p) => p.url).length === 1);

console.log("\n— nothing to do —");
check("plain text is one part", linkify("Etsy is live now").length === 1);
check("plain text has no url", linkify("Etsy is live now")[0].url === undefined);
check("empty string still returns a part", linkify("").length === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
