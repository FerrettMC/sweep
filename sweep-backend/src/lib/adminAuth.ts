// lib/adminAuth.ts
//
// One admin key check, shared by everything behind it.
//
// This started as a copy in each admin endpoint, which was fine at two and a
// liability at four: an auth check that exists in several places is one that
// eventually differs in one of them. The specific risk here isn't theoretical
// — an unset secret must REFUSE rather than default open, and a plain ===
// comparison leaks the key a character at a time to anyone willing to time it.
// Both are easy to get right once and easy to forget on the fourth copy.

import type { FastifyReply, FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison, safe on mismatched lengths.
 *
 * timingSafeEqual throws rather than returning false when the buffers differ
 * in length, so the length check has to come first. It leaks only the length
 * of the key, which is not the secret.
 */
export function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Fastify preHandler for admin-only endpoints.
 *
 * Returns 503 when ADMIN_API_KEY is not set, rather than allowing the request.
 * A missing secret means misconfiguration, and the safe reading of "no key
 * configured" is "nobody is an admin", never "everybody is".
 */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) {
    request.log.error("ADMIN_API_KEY is not set");
    return reply.status(503).send({ error: "Admin endpoints not configured" });
  }

  const provided = request.headers["x-admin-key"];
  if (typeof provided !== "string" || !secretsMatch(provided, expected)) {
    return reply.status(401).send({ error: "Unauthorized" });
  }
}
