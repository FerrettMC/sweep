import { requireAuth } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";
export async function authRoutes(app) {
    app.post("/auth/sync-user", { preHandler: requireAuth }, async (request, reply) => {
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
}
