// lib/authErrors.test.ts — what a person sees when auth refuses.
//   npm run test:auth-errors     (plain node, no device)
import { MIN_PASSWORD_LENGTH, type AuthErrorKey, friendlyAuthErrorKey } from "./authErrors";
import { en, es } from "./i18n/translations";

let pass = 0,
  fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok && detail !== undefined) console.log("     ", JSON.stringify(detail));
};
const got = (raw: string) => friendlyAuthErrorKey(raw);

console.log("\n— real Supabase messages —");
// Verbatim strings Supabase actually returns.
const cases: [string, string][] = [
  ["User already registered", "auth.accountExists"],
  ["A user with this email address has already been registered", "auth.accountExists"],
  ["Password should be at least 6 characters.", "auth.tooShort"],
  ["Unable to validate email address: invalid format", "auth.badEmail"],
  ["Signups not allowed for this instance", "auth.signupFailed"],
  ["Database error saving new user", "auth.signupFailed"],
  ["Network request failed", "auth.offline"],
];
for (const [raw, want] of cases) {
  check(`"${raw.slice(0, 44)}" → ${want.split(".")[1]}`, got(raw) === want, got(raw));
}

console.log("\n— the cooldown Supabase phrases oddly —");
// Mentions neither "rate" nor "limit"; a naive matcher sends it to the generic
// message and the person retries immediately, extending the cooldown.
check(
  "'for security purposes' is caught",
  got("For security purposes, you can only request this after 51 seconds.") ===
    "auth.tooManyAttempts",
  got("For security purposes, you can only request this after 51 seconds."),
);
check("'Email rate limit exceeded'", got("Email rate limit exceeded") === "auth.tooManyAttempts");

console.log("\n— never leaks the raw text —");
// The guarantee: whatever arrives, the result is one of our own keys.
const nasty = [
  "AuthApiError: unexpected_failure at /token?grant_type=password",
  "",
  "   ",
  "500 Internal Server Error <html><body>nginx</body></html>",
  "invalid JWT: unable to parse or verify signature, token is expired",
  "{}",
  "undefined",
];
const allowed = new Set([
  "auth.tooManyAttempts",
  "auth.tooShort",
  "auth.badEmail",
  "auth.accountExists",
  "auth.offline",
  "auth.signupFailed",
]);
check(
  `all ${nasty.length} malformed inputs return a known key`,
  nasty.every((raw) => allowed.has(got(raw))),
  nasty.map(got),
);
check("an empty message is still actionable", got("") === "auth.signupFailed");

console.log("\n— case and wording don't matter —");
check("uppercase", got("USER ALREADY REGISTERED") === "auth.accountExists");
check("mixed case", got("Password Should Be At Least 8 Characters") === "auth.tooShort");

console.log("\n— precedence —");
// A rate-limited password reset mentions both; the cooldown is the one they
// can act on, so it must win.
check(
  "cooldown beats password wording",
  got("For security purposes, password reset can only be requested after 60 seconds") ===
    "auth.tooManyAttempts",
);

console.log("\n— one minimum, shared by both screens —");
// Signup used 6 and password reset used 8, so anyone who signed up with six
// characters was refused when resetting to the password they already had.
check("minimum is 8", MIN_PASSWORD_LENGTH === 8, MIN_PASSWORD_LENGTH);
check(
  "Supabase's own too-short message still maps to our copy",
  friendlyAuthErrorKey("Password should be at least 8 characters.") === "auth.tooShort",
);

console.log("\n— every key this can return actually exists —");
// These keys are returned dynamically, so neither the compiler (t takes a
// plain string) nor checkKeys.mjs (it scans for literal t("…") calls) can see
// them. Renaming one in translations.ts would otherwise ship a screen showing
// "auth.signupFailed" to someone who just failed to sign up — the same bug
// class as the plans.createAccount one. This is the only thing that catches it.
const returnable: AuthErrorKey[] = [
  "auth.tooManyAttempts",
  "auth.tooShort",
  "auth.badEmail",
  "auth.accountExists",
  "auth.offline",
  "auth.signupFailed",
];
const resolve = (bundle: Record<string, any>, key: string) =>
  key.split(".").reduce<any>((node, part) => node?.[part], bundle);

for (const key of returnable) {
  check(
    `${key} exists in both locales`,
    typeof resolve(en, key) === "string" && typeof resolve(es, key) === "string",
    { en: resolve(en, key), es: resolve(es, key) },
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
