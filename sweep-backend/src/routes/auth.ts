import type { FastifyInstance } from "fastify";
import { requireAuth, verifyPassword } from "../lib/auth.js";
import { SENSITIVE_LIMIT } from "../lib/rateLimit.js";
import { deleteAccount } from "../lib/deleteAccount.js";
import { prisma } from "../lib/prisma.js";

export async function authRoutes(app: FastifyInstance) {
  app.post(
    "/auth/sync-user",
    {
      preHandler: requireAuth,
      config: { rateLimit: SENSITIVE_LIMIT },
    },
    async (request, reply) => {
      const userId = request.userId!;
      const { email } = request.body as { email: string };

      const user = await prisma.user.upsert({
        where: { id: userId },
        update: {},
        create: {
          id: userId,
          email,
          wallet: { create: {} },
        },
      });

      return { user };
    },
  );

  app.get("/auth/me", { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.userId!;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { wallet: true },
    });

    if (!user) {
      return reply.status(404).send({ error: "User not found" });
    }

    return { user };
  });

  // ---- delete this account, permanently ----
  //
  // Required by Google Play for any app with accounts, and scoped strictly to
  // the caller: the user id comes from the verified token, never from the body,
  // so there is no id here for anyone to tamper with.
  app.delete(
    "/me",
    { preHandler: requireAuth, config: { rateLimit: SENSITIVE_LIMIT } },
    async (request, reply) => {
      const userId = request.userId!;
      const { confirm, password } = (request.body ?? {}) as {
        confirm?: unknown;
        password?: unknown;
      };

      // A deliberate second step. This is irreversible and there is no undo,
      // so it should not be reachable by a single malformed request.
      if (confirm !== true) {
        return reply.status(400).send({
          error: "Send { confirm: true } to delete this account.",
          code: "CONFIRMATION_REQUIRED",
        });
      }

      // Re-authenticate. A valid token only proves this phone was signed in at
      // some point — it says nothing about who is holding it right now, and an
      // unlocked phone is the realistic threat for an irreversible action.
      //
      // Checked here rather than in the app so it can't be skipped by calling
      // the API directly with a stolen token.
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (!user) return reply.status(404).send({ error: "Account not found" });

      if (typeof password !== "string" || !password) {
        return reply.status(400).send({
          error: "Enter your password to delete your account.",
          code: "PASSWORD_REQUIRED",
        });
      }

      const { error: reauthError } = await verifyPassword(user.email, password);
      if (reauthError) {
        // 403, not 401. The session IS valid — the caller simply failed a
        // second check. The app treats any 401-with-a-token as a dead session
        // and signs the user out, so returning 401 here would log someone out
        // for mistyping their password, which looks exactly like the deletion
        // succeeding.
        return reply.status(403).send({
          error: "That password isn't right.",
          code: "PASSWORD_INCORRECT",
        });
      }

      const summary = await deleteAccount(userId);
      request.log.info({ userId, ...summary }, "account deleted");

      return { ok: true, ...summary };
    },
  );
}
