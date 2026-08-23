// routes/cart.ts
//
// HTTP over lib/cart.ts. All the behaviour lives there, which is what lets it
// be tested without minting a Supabase token for every case.

import type { FastifyInstance } from "fastify";
import { requireAuth } from "../lib/auth.js";
import {
  MAX_CART_ITEMS,
  addToCart,
  buildCart,
  clearCart,
  removeFromCart,
  setCartQuantity,
} from "../lib/cart.js";
import { resolveProduct } from "../lib/resolveProduct.js";

export async function cartRoutes(app: FastifyInstance) {
  app.get("/cart", { preHandler: requireAuth }, async (request) => {
    return buildCart(request.userId!);
  });

  // Takes the same shapes as everything else that names a product, so the cart
  // can be added to from search results, a lookup page or a pasted link
  // without each caller knowing which it holds.
  app.post("/cart", { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.userId!;
    const body = (request.body ?? {}) as {
      productId?: string;
      url?: string;
      retailer?: string;
      retailerId?: string;
      quantity?: number;
    };

    let productId = body.productId;
    if (!productId) {
      const resolved = await resolveProduct(body);
      if (!resolved.ok) {
        return reply
          .status(resolved.status)
          .send({ error: resolved.error, code: resolved.code });
      }
      productId = resolved.product.id;
    }

    const result = await addToCart(userId, productId, body.quantity ?? 1);
    if (!result.ok) {
      return result.reason === "full"
        ? reply.status(409).send({
            error: `A cart holds ${MAX_CART_ITEMS} items. Remove something first.`,
            code: "CART_FULL",
          })
        : reply.status(404).send({ error: "Product not found" });
    }

    return buildCart(userId);
  });

  app.patch("/cart/:productId", { preHandler: requireAuth }, async (request, reply) => {
    const { productId } = request.params as { productId: string };
    const { quantity } = (request.body ?? {}) as { quantity?: number };

    if (typeof quantity !== "number" || quantity < 0) {
      return reply.status(400).send({ error: "quantity must be 0 or more" });
    }

    const changed = await setCartQuantity(request.userId!, productId, quantity);
    if (!changed) return reply.status(404).send({ error: "Not in your cart" });
    return buildCart(request.userId!);
  });

  app.delete("/cart/:productId", { preHandler: requireAuth }, async (request) => {
    const { productId } = request.params as { productId: string };
    await removeFromCart(request.userId!, productId);
    return buildCart(request.userId!);
  });

  app.delete("/cart", { preHandler: requireAuth }, async (request) => {
    await clearCart(request.userId!);
    return buildCart(request.userId!);
  });
}
