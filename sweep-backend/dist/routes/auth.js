import { requireAuth } from "../lib/auth.js";
import { SENSITIVE_LIMIT } from "../lib/rateLimit.js";
import { deleteAccount } from "../lib/deleteAccount.js";
import { prisma } from "../lib/prisma.js";
export async function authRoutes(app) {
    app.post("/auth/sync-user", {
        preHandler: requireAuth,
        config: { rateLimit: SENSITIVE_LIMIT },
    }, async (request, reply) => {
        const userId = request.userId;
        const { email } = request.body;
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
    });
    app.get("/auth/me", { preHandler: requireAuth }, async (request, reply) => {
        const userId = request.userId;
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
    app.delete("/me", { preHandler: requireAuth, config: { rateLimit: SENSITIVE_LIMIT } }, async (request, reply) => {
        const userId = request.userId;
        const { confirm } = (request.body ?? {});
        // A deliberate second step. This is irreversible and there is no undo,
        // so it should not be reachable by a single malformed request.
        if (confirm !== true) {
            return reply.status(400).send({
                error: "Send { confirm: true } to delete this account.",
                code: "CONFIRMATION_REQUIRED",
            });
        }
        const summary = await deleteAccount(userId);
        request.log.info({ userId, ...summary }, "account deleted");
        return { ok: true, ...summary };
    });
}
