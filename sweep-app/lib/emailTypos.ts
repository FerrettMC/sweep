// lib/emailTypos.ts
//
// "Did you mean gmail.com?" at the moment someone types their address.
//
// Sweep signs people in immediately without confirming their email, which is
// deliberate — the confirmation wall is where people abandon signup. The cost
// of that choice is that a mistyped address is never caught, and the address
// is the only route back into an account whose password has been forgotten.
// For a subscriber that means a subscription they've paid for and can't reach.
//
// Rather than build verification to catch a problem that is almost always one
// fat-fingered domain, this catches the fat-fingered domain. It handles the
// realistic failure — gmial.com, gmail.con, hotmial.com — and does nothing
// clever with the local part, which we can't second-guess.
//
// It only ever SUGGESTS. Nothing here blocks a signup or rewrites what someone
// typed: plenty of real addresses sit on domains this has never heard of, and
// being wrong must cost the user one glance, not their account.

/**
 * Providers common enough that a near-miss is far more likely to be a typo
 * than a real domain.
 *
 * Doubles as an allow-list: an exact match returns no suggestion immediately,
 * which is what stops "mail.com" being corrected to "gmail.com".
 */
const KNOWN_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "hotmail.com",
  "hotmail.co.uk",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "mail.com",
  "gmx.com",
  "zoho.com",
  "yandex.com",
  "comcast.net",
  "verizon.net",
  "att.net",
  "sbcglobal.net",
  "bellsouth.net",
  "cox.net",
  "charter.net",
  "earthlink.net",
  "btinternet.com",
  "sky.com",
  "orange.fr",
  "web.de",
  "t-online.de",
];

/** Levenshtein distance, capped — we only care about "very close". */
function distance(a: string, b: string, cap: number): number {
  // A large length gap can't be within the cap, and skipping the matrix for
  // it keeps this cheap enough to run on every keystroke.
  if (Math.abs(a.length - b.length) > cap) return cap + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      best = Math.min(best, current[j]);
    }
    // Every path through this row is already too expensive.
    if (best > cap) return cap + 1;
    previous = current;
  }

  return previous[b.length];
}

/**
 * A corrected address, or null when there's nothing worth saying.
 *
 * Null covers three different situations on purpose — the domain is already
 * known-good, the address isn't complete enough to judge, or it's on a domain
 * we've simply never heard of. In all three the right move is to stay quiet.
 */
export function suggestEmail(raw: string): string | null {
  const email = raw.trim();

  // Exactly one @, with something either side. Anything else is either
  // mid-typing or not an address, and neither is worth a suggestion.
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  if (email.slice(0, at).includes("@")) return null;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase();

  // Already a domain we recognise. Checked first, so a real address on a real
  // provider is never questioned.
  if (KNOWN_DOMAINS.includes(domain)) return null;

  // Two edits on a long domain, one on a short one. Allowing two everywhere
  // would "correct" me.com to pm.me, which is a different real provider.
  const cap = domain.length >= 9 ? 2 : 1;

  let best: { domain: string; score: number } | null = null;
  for (const candidate of KNOWN_DOMAINS) {
    const score = distance(domain, candidate, cap);
    if (score <= cap && (best === null || score < best.score)) {
      best = { domain: candidate, score };
    }
  }

  if (!best) return null;
  return `${local}@${best.domain}`;
}
