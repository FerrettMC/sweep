// lib/authErrors.ts
//
// Which message to show when the auth provider refuses.
//
// Supabase writes its errors for whoever is integrating the SDK, not for
// whoever is signing up. "AuthApiError: User already registered" and "Signups
// not allowed for this instance" both read as though the app is broken and the
// person did something wrong, and neither tells them what to do next.
//
// A pure function returning a translation key, rather than a formatted string,
// so the decision can be tested without a device and the copy stays in
// translations.ts with everything else.
//
// The raw message still reaches Sentry. Nothing is lost for debugging by not
// showing it to the person signing up.

export type AuthErrorKey =
  | "auth.tooManyAttempts"
  | "auth.tooShort"
  | "auth.badEmail"
  | "auth.accountExists"
  | "auth.offline"
  | "auth.signupFailed";

export function friendlyAuthErrorKey(raw: string): AuthErrorKey {
  const message = raw.toLowerCase();

  // Checked before anything else: Supabase phrases its cooldown as "for
  // security purposes you can only request this after N seconds", which
  // mentions neither "rate" nor "limit" and would otherwise fall through to
  // the generic message.
  if (/rate limit|too many requests|for security purposes/.test(message)) {
    return "auth.tooManyAttempts";
  }

  if (/password/.test(message) && /short|least|weak|characters/.test(message)) {
    return "auth.tooShort";
  }

  if (/email/.test(message) && /invalid|unable to validate/.test(message)) {
    return "auth.badEmail";
  }

  // Deliberately loose between "already" and the verb: Supabase returns both
  // "User already registered" and "A user with this email address has already
  // been registered", and an exact-phrase match catches only the first.
  if (/already\b.{0,12}\b(registered|exists|in use)/.test(message)) {
    return "auth.accountExists";
  }

  if (/network|fetch|timeout|connection/.test(message)) {
    return "auth.offline";
  }

  // Signups disabled, provider outage, and anything they add in future. One
  // honest sentence beats a precise message nobody can act on.
  return "auth.signupFailed";
}
