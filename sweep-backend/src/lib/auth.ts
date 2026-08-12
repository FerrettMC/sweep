import { createClient } from "@supabase/supabase-js";
import type { FastifyReply, FastifyRequest } from "fastify";

const supabaseAuthClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
);

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
    /**
     * Anonymous per-install id, sent by guests so their daily search cap can
     * be enforced server-side. Never trusted for anything a real account can
     * do — it identifies a device, it does not authenticate a person.
     */
    guestDeviceId?: string;
  }
}

/**
 * Hard gate: no valid Supabase session, no access. Use on everything that
 * reads or writes user-owned data.
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return reply.status(401).send({ error: "Missing authorization token" });
  }

  const token = authHeader.slice(7);
  const { data, error } = await supabaseAuthClient.auth.getUser(token);

  if (error || !data.user) {
    return reply.status(401).send({ error: "Invalid or expired session" });
  }

  request.userId = data.user.id;
}

/**
 * Soft gate for endpoints guests may use (compiled search, deals feed).
 * Populates userId when a valid token is present, falls back to the device id
 * otherwise, and never rejects — the route decides what a guest may do.
 *
 * An invalid token is treated as "guest", not as an error, so an expired
 * session degrades to the guest experience instead of a wall.
 */
export async function optionalAuth(request: FastifyRequest, _reply: FastifyReply) {
  const authHeader = request.headers.authorization;

  if (authHeader?.startsWith("Bearer ")) {
    const { data } = await supabaseAuthClient.auth.getUser(authHeader.slice(7));
    if (data?.user) {
      request.userId = data.user.id;
      return;
    }
  }

  const deviceId = request.headers["x-device-id"];
  if (typeof deviceId === "string" && isValidDeviceId(deviceId)) {
    request.guestDeviceId = deviceId;
  }
}

/**
 * Device ids are client-generated UUIDs. Validate the shape so a caller can't
 * spray arbitrary strings and mint a fresh quota row per request.
 */
function isValidDeviceId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
