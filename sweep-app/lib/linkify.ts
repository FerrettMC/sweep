// lib/linkify.ts
//
// Turning URLs in announcement text into something tappable.
//
// ONLY OUR OWN DOMAINS, deliberately.
//
// Announcements are sent with an admin key, and their `href` is already
// restricted to in-app paths so that a leaked key can't put an arbitrary link
// in front of every user. Linkifying whatever appears in the body would undo
// that in one step — the blast radius of a stolen key would go from "a rude
// message" to "a phishing link delivered to the whole userbase".
//
// An allow-list keeps the useful half. The only links worth sending are the
// site and the Play listing, and both are ours.
//
// Anything else stays plain text: still readable, still copyable, just not a
// tap away.

/** Hosts we will turn into links. Suffix match, so subdomains are included. */
const ALLOWED = ["sweepshopping.com", "play.google.com"];

export interface TextPart {
  text: string;
  /** Present when this part should be tappable. */
  url?: string;
}

/** Matches bare domains and full URLs, with or without a scheme. */
const URL_RE = /\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?)/gi;

function hostOf(candidate: string): string | null {
  try {
    const withScheme = candidate.startsWith("http") ? candidate : `https://${candidate}`;
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function allowed(host: string): boolean {
  return ALLOWED.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/**
 * Split text into plain and tappable parts.
 *
 * Always returns at least one part, so a caller can render the result without
 * special-casing empty input.
 */
export function linkify(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;

  for (const match of text.matchAll(URL_RE)) {
    const raw = match[0];
    const at = match.index ?? 0;
    const host = hostOf(raw);

    if (!host || !allowed(host)) continue;

    if (at > last) parts.push({ text: text.slice(last, at) });
    parts.push({
      text: raw,
      // Normalised so a bare "sweepshopping.com" still opens. Without a scheme
      // Linking either refuses it or hands it to the wrong app.
      url: raw.startsWith("http") ? raw : `https://${raw}`,
    });
    last = at + raw.length;
  }

  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts.length > 0 ? parts : [{ text }];
}
