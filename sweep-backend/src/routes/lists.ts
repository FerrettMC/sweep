// routes/lists.ts
//
// Gift lists and wishlists, plus the public share link.
//
// The share endpoint is the only unauthenticated route in the app that returns
// user-created content, so it's the one worth being careful with:
//
//   - It's reachable only by an unguessable token, never by list id.
//   - It returns nothing that identifies the owner beyond a display name.
//   - Turning sharing off rotates the token, so old links die rather than
//     lingering as a URL someone still has in a chat thread.
//
// List items are capped per tier because every item is a real product row.
// Adding to a list doesn't start tracking it — tracking is what costs money,
// and a 100-item wishlist quietly becoming 100 tracked products is exactly the
// kind of thing that scales with signups.

import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { optionalAuth, requireAuth } from "../lib/auth.js";
import { SCRAPE_LIMIT } from "../lib/rateLimit.js";
import { prisma } from "../lib/prisma.js";
import { resolveProduct } from "../lib/resolveProduct.js";
import { effectiveTier, limitsFor } from "../lib/tiers.js";
import { displayName } from "../lib/xp.js";

const MAX_NAME_LENGTH = 60;
const MAX_DESCRIPTION_LENGTH = 200;
const MAX_NOTE_LENGTH = 140;

export async function listRoutes(app: FastifyInstance) {
  // ---- my lists ----
  app.get("/lists", { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.userId!;

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) return reply.status(404).send({ error: "No wallet for user" });

    const limits = limitsFor(wallet);
    const lists = await prisma.list.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        items: {
          orderBy: { addedAt: "desc" },
          include: { product: true },
        },
      },
    });

    return {
      lists: lists.map((list) => serializeList(list)),
      limits: {
        maxLists: limits.maxLists,
        maxItemsPerList: limits.maxItemsPerList,
        used: lists.length,
      },
      tier: effectiveTier(wallet),
    };
  });

  // ---- create ----
  app.post("/lists", { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.userId!;
    const { name, description } = (request.body ?? {}) as {
      name?: unknown;
      description?: unknown;
    };

    if (typeof name !== "string" || !name.trim()) {
      return reply.status(400).send({ error: "Give the list a name." });
    }
    if (name.length > MAX_NAME_LENGTH) {
      return reply
        .status(400)
        .send({ error: `Names are ${MAX_NAME_LENGTH} characters or fewer.` });
    }

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) return reply.status(404).send({ error: "No wallet for user" });

    const limits = limitsFor(wallet);
    const count = await prisma.list.count({ where: { userId } });
    if (count >= limits.maxLists) {
      return reply.status(403).send({
        error: `Your plan allows ${limits.maxLists} ${limits.maxLists === 1 ? "list" : "lists"}.`,
        code: "LIST_LIMIT_REACHED",
        limit: limits.maxLists,
        tier: effectiveTier(wallet),
      });
    }

    const list = await prisma.list.create({
      data: {
        userId,
        name: name.trim(),
        description:
          typeof description === "string" && description.trim()
            ? description.trim().slice(0, MAX_DESCRIPTION_LENGTH)
            : null,
      },
      include: { items: { include: { product: true } } },
    });

    return reply.status(201).send({ list: serializeList(list) });
  });

  // ---- rename / edit ----
  app.patch<{ Params: { id: string } }>(
    "/lists/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.userId!;
      const { name, description } = (request.body ?? {}) as {
        name?: unknown;
        description?: unknown;
      };

      const data: { name?: string; description?: string | null } = {};
      if (name !== undefined) {
        if (typeof name !== "string" || !name.trim()) {
          return reply.status(400).send({ error: "Give the list a name." });
        }
        data.name = name.trim().slice(0, MAX_NAME_LENGTH);
      }
      if (description !== undefined) {
        data.description =
          typeof description === "string" && description.trim()
            ? description.trim().slice(0, MAX_DESCRIPTION_LENGTH)
            : null;
      }

      // Scoped by userId so an id guess can't edit someone else's list.
      const updated = await prisma.list.updateMany({
        where: { id: request.params.id, userId },
        data,
      });
      if (updated.count === 0) {
        return reply.status(404).send({ error: "List not found" });
      }

      return { ok: true };
    },
  );

  // ---- delete ----
  app.delete<{ Params: { id: string } }>(
    "/lists/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const deleted = await prisma.list.deleteMany({
        where: { id: request.params.id, userId: request.userId! },
      });
      if (deleted.count === 0) {
        return reply.status(404).send({ error: "List not found" });
      }
      return { ok: true };
    },
  );

  // ---- add an item ----
  //
  // Accepts a pasted url or a retailer + retailerId pair, same as tracking.
  app.post<{ Params: { id: string } }>(
    "/lists/:id/items",
    {
      preHandler: requireAuth,
      config: { rateLimit: SCRAPE_LIMIT },
    },
    async (request, reply) => {
      const userId = request.userId!;
      const body = (request.body ?? {}) as {
        url?: string;
        retailer?: string;
        retailerId?: string;
        note?: unknown;
      };

      const list = await prisma.list.findFirst({
        where: { id: request.params.id, userId },
        include: { _count: { select: { items: true } } },
      });
      if (!list) return reply.status(404).send({ error: "List not found" });

      const wallet = await prisma.wallet.findUnique({ where: { userId } });
      if (!wallet)
        return reply.status(404).send({ error: "No wallet for user" });

      const limits = limitsFor(wallet);
      if (list._count.items >= limits.maxItemsPerList) {
        return reply.status(403).send({
          error: `Lists hold ${limits.maxItemsPerList} items on your plan.`,
          code: "LIST_ITEM_LIMIT_REACHED",
          limit: limits.maxItemsPerList,
          tier: effectiveTier(wallet),
        });
      }

      // Resolve the product. Handles pasted urls AND retailer+retailerId from
      // a search result, including looking up the real url for retailers whose
      // synthesized one wouldn't scrape (see lib/resolveProduct.ts).
      const resolved = await resolveProduct(body);
      if (!resolved.ok) {
        return reply
          .status(resolved.status)
          .send({ error: resolved.error, code: resolved.code });
      }
      const product = resolved.product;

      const item = await prisma.listItem.upsert({
        where: { listId_productId: { listId: list.id, productId: product.id } },
        create: {
          listId: list.id,
          productId: product.id,
          note:
            typeof body.note === "string" && body.note.trim()
              ? body.note.trim().slice(0, MAX_NOTE_LENGTH)
              : null,
        },
        update: {},
        include: { product: true },
      });

      return reply.status(201).send({ item: serializeItem(item) });
    },
  );

  // ---- remove an item ----
  app.delete<{ Params: { id: string; itemId: string } }>(
    "/lists/:id/items/:itemId",
    { preHandler: requireAuth },
    async (request, reply) => {
      // Confirm ownership via the parent list rather than trusting the item id.
      const list = await prisma.list.findFirst({
        where: { id: request.params.id, userId: request.userId! },
        select: { id: true },
      });
      if (!list) return reply.status(404).send({ error: "List not found" });

      const deleted = await prisma.listItem.deleteMany({
        where: { id: request.params.itemId, listId: list.id },
      });
      if (deleted.count === 0) {
        return reply.status(404).send({ error: "Item not on that list" });
      }
      return { ok: true };
    },
  );

  // ---- sharing ----
  app.post<{ Params: { id: string } }>(
    "/lists/:id/share",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.userId!;
      const { enabled } = (request.body ?? {}) as { enabled?: unknown };

      const wallet = await prisma.wallet.findUnique({ where: { userId } });
      if (!wallet)
        return reply.status(404).send({ error: "No wallet for user" });
      if (!limitsFor(wallet).shareableLists) {
        return reply
          .status(403)
          .send({
            error: "Sharing isn't available on your plan.",
            code: "TIER_REQUIRED",
          });
      }

      const list = await prisma.list.findFirst({
        where: { id: request.params.id, userId },
      });
      if (!list) return reply.status(404).send({ error: "List not found" });

      if (enabled === false) {
        // Clear the token as well as the flag. Leaving it would mean a link
        // someone already has keeps working the moment sharing is re-enabled.
        await prisma.list.update({
          where: { id: list.id },
          data: { isPublic: false, shareToken: null },
        });
        return { isPublic: false, shareToken: null };
      }

      const shareToken =
        list.shareToken ?? randomBytes(9).toString("base64url");
      await prisma.list.update({
        where: { id: list.id },
        data: { isPublic: true, shareToken },
      });

      return { isPublic: true, shareToken };
    },
  );

  // ---- the public view ----
  //
  // No auth. Reachable only with the token, and deliberately returns nothing
  // about the owner beyond their display name.
  app.get<{ Params: { token: string } }>(
    "/shared/:token",
    { preHandler: optionalAuth },
    async (request, reply) => {
      const list = await prisma.list.findUnique({
        where: { shareToken: request.params.token },
        include: {
          user: { select: { id: true, username: true } },
          items: { orderBy: { addedAt: "desc" }, include: { product: true } },
        },
      });

      if (!list || !list.isPublic) {
        return reply.status(404).send({
          error: "That list doesn't exist, or sharing was turned off.",
          code: "LIST_NOT_SHARED",
        });
      }

      return {
        name: list.name,
        description: list.description,
        owner: displayName(list.user),
        isOwner: request.userId === list.userId,
        items: list.items.map((item) => serializeItem(item)),
      };
    },
  );

  // ---- claim / unclaim on a shared list ----
  //
  // The point of a gift list: whoever's buying marks an item so two people
  // don't turn up with the same thing. Deliberately open to anyone holding the
  // link — requiring an account here would defeat the purpose.
  app.post<{ Params: { token: string; itemId: string } }>(
    "/shared/:token/items/:itemId/claim",
    async (request, reply) => {
      const { claimed } = (request.body ?? {}) as { claimed?: unknown };

      const list = await prisma.list.findUnique({
        where: { shareToken: request.params.token },
        select: { id: true, isPublic: true },
      });
      if (!list || !list.isPublic) {
        return reply.status(404).send({ error: "List not found" });
      }

      const updated = await prisma.listItem.updateMany({
        where: { id: request.params.itemId, listId: list.id },
        data: { claimed: claimed !== false },
      });
      if (updated.count === 0) {
        return reply.status(404).send({ error: "Item not on that list" });
      }

      return { ok: true, claimed: claimed !== false };
    },
  );
}

// ---- serialization ---------------------------------------------------------

function serializeItem(item: {
  id: string;
  note: string | null;
  claimed: boolean;
  addedAt: Date;
  product: {
    id: string;
    retailer: string;
    retailerId: string;
    title: string;
    imageUrl: string | null;
    url: string;
    currentPrice: number | null;
    listPrice: number | null;
  };
}) {
  return {
    id: item.id,
    note: item.note,
    claimed: item.claimed,
    addedAt: item.addedAt,
    product: {
      id: item.product.id,
      retailer: item.product.retailer,
      retailerId: item.product.retailerId,
      title: item.product.title,
      imageUrl: item.product.imageUrl,
      url: item.product.url,
      price: item.product.currentPrice,
      listPrice: item.product.listPrice,
    },
  };
}

function serializeList(list: {
  id: string;
  name: string;
  description: string | null;
  shareToken: string | null;
  isPublic: boolean;
  createdAt: Date;
  items: Parameters<typeof serializeItem>[0][];
}) {
  const prices = list.items
    .map((item) => item.product.currentPrice)
    .filter((price): price is number => price !== null);

  return {
    id: list.id,
    name: list.name,
    description: list.description,
    isPublic: list.isPublic,
    shareToken: list.shareToken,
    createdAt: list.createdAt,
    itemCount: list.items.length,
    // Handy on the list card, and free to compute here.
    totalValue: prices.reduce((sum, price) => sum + price, 0),
    items: list.items.map((item) => serializeItem(item)),
  };
}
