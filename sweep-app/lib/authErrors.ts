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

/**
 * Shortest password we'll set.
 *
 * Lives here rather than in either screen because it was 6 on signup and 8 on
 * password reset, which meant someone who signed up with six characters could
 * not reset to the password they already had — refused by a rule that did not
 * exist when they chose it.
 *
 * Eight is the floor NIST recommends for user-chosen secrets, and these
 * accounts carry live subscriptions. The two keystrokes are not what makes
 * people abandon a signup.
 *
 * Only checked when SETTING a password. Existing shorter ones keep working;
 * nobody is locked out of an account they already have.
 */
export const MIN_PASSWORD_LENGTH = 8;

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
