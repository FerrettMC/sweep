// lib/rateLimit.ts
//
// Request throttling.
//
// Two different jobs, which is why there are two layers:
//
//   1. A global ceiling stops anyone hammering the API — cheap endpoints
//      included, because a flood of /plans still costs database connections.
//   2. Per-route ceilings on the endpoints that spend money. Tier quotas
//      already bound those per user, but a quota check is itself a database
//      round trip, and nothing stopped someone firing a thousand of them.
//
// Keyed by user id when we know who's asking, and by IP otherwise. Keying only
// by IP would let one abusive account hide behind a shared network, and keying
// only by account would let a signed-out flood through untouched.

import type { FastifyRequest } from "fastify";

/** Who this request counts against. */
export function rateLimitKey(request: FastifyRequest): string {
  // Set by requireAuth/optionalAuth, which run BEFORE this because the plugin
  // is mounted on preHandler rather than onRequest — see the note in index.ts.
  const userId = (request as FastifyRequest & { userId?: string }).userId;
  if (userId) return `u:${userId}`;

  // A guest's device id is client-supplied and trivially rotated, so it must
  // never be the rate-limit key — that's exactly the hole it would open.
  return `ip:${request.ip}`;
}

/**
 * Sensible default for ordinary reads and writes, PER ACCOUNT.
 *
 * Not a cap on total throughput: each signed-in user gets their own bucket, so
 * a thousand users is a thousand buckets. Only unauthenticated traffic shares
 * a key, and there it falls back to IP.
 *
 * 300 is generous on purpose. Guests behind one mobile carrier's NAT can be
 * thousands of people sharing an address, and throttling a whole network
 * because it's busy is the failure mode worth avoiding.
 */
export const GLOBAL_LIMIT = { max: 300, timeWindow: "1 minute" };

/**
 * Endpoints that trigger outbound scraping. These cost real money and real
 * latency, and the retailers themselves rate-limit us — so this protects our
 * relationship with them as much as it protects the server.
 */
export const SCRAPE_LIMIT = { max: 10, timeWindow: "1 minute" };

/** Auth-adjacent writes, where repeated attempts are the attack. */
export const SENSITIVE_LIMIT = { max: 20, timeWindow: "1 minute" };

/**
 * Promo redemption, where guessing IS the attack.
 *
 * A code is short enough to brute-force and a hit is worth real money, so this
 * is deliberately far tighter than SENSITIVE_LIMIT. Nobody legitimately types
 * more than a handful of codes a minute — they're reading one off a screen.
 */
export const REDEEM_LIMIT = { max: 5, timeWindow: "1 minute" };
