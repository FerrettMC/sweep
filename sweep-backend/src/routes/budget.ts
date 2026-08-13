// routes/budget.ts
//
// The budget tracker: manual expense logging for shopping spend, a monthly
// view, and caps you can set against it.
//
// Two things are enforced here rather than in the app:
//
//   - How far back you can read. History depth is a real paid difference, so
//     an out-of-range month is refused with a reason, not quietly emptied.
//   - Which caps you may set. Everyone gets one overall monthly budget; only
//     paid tiers can slice it up per category.
//
// Entries are plain rows that cost nothing to store, so logging itself is
// unlimited on every tier. Capping that would feel punitive and save nothing.

import type { FastifyInstance } from "fastify";
import { requireAuth } from "../lib/auth.js";
import {
  MAX_AMOUNT_CENTS,
  MAX_CATEGORY_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  availableCategories,
  DEFAULT_CATEGORIES,
  earliestReadableMonth,
  formatMonth,
  guessCategory,
  monthEnd,
  monthStart,
  parseMonth,
} from "../lib/budget.js";
import { prisma } from "../lib/prisma.js";
import { effectiveTier, limitsFor } from "../lib/tiers.js";

/** How the overall monthly budget is stored. See the schema for why not NULL. */
const OVERALL = "";

export async function budgetRoutes(app: FastifyInstance) {
  // ---- the month view ----
  app.get<{ Querystring: { month?: string } }>(
    "/budget",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.userId!;

      const wallet = await prisma.wallet.findUnique({ where: { userId } });
      if (!wallet) return reply.status(404).send({ error: "No wallet for user" });
      const limits = limitsFor(wallet);

      const now = new Date();
      const month = request.query.month ? parseMonth(request.query.month) : monthStart(now);
      if (!month) {
        return reply
          .status(400)
          .send({ error: "Month should look like 2026-08.", code: "INVALID_MONTH" });
      }

      const earliest = earliestReadableMonth(limits, now);
      if (earliest && month < earliest) {
        return reply.status(403).send({
          error:
            limits.budgetHistoryMonths === 1
              ? "Your plan shows the current month."
              : `Your plan keeps ${limits.budgetHistoryMonths} months of spending history.`,
          code: "HISTORY_LIMIT_REACHED",
          months: limits.budgetHistoryMonths,
          earliestMonth: formatMonth(earliest),
          tier: effectiveTier(wallet),
        });
      }

      const [entries, allLimits, usedCategories] = await Promise.all([
        prisma.budgetEntry.findMany({
          where: { userId, spentAt: { gte: month, lt: monthEnd(month) } },
          orderBy: { spentAt: "desc" },
          include: { product: true },
        }),
        prisma.budgetLimit.findMany({ where: { userId } }),
        prisma.budgetEntry.findMany({
          where: { userId },
          select: { category: true },
          distinct: ["category"],
        }),
      ]);

      const total = entries.reduce((sum, entry) => sum + entry.amount, 0);

      // Spend per category, biggest first — the useful ordering for "where did
      // the month actually go", which is the question this screen exists to
      // answer.
      const byCategory = new Map<string, number>();
      for (const entry of entries) {
        byCategory.set(entry.category, (byCategory.get(entry.category) ?? 0) + entry.amount);
      }

      const categoryLimits = new Map(
        allLimits.filter((row) => row.category !== OVERALL).map((row) => [row.category, row.amount]),
      );
      const overall = allLimits.find((row) => row.category === OVERALL) ?? null;

      const categories = [...byCategory.entries()]
        .map(([category, spent]) => ({
          category,
          spent,
          limit: categoryLimits.get(category) ?? null,
        }))
        .sort((a, b) => b.spent - a.spent);

      // A category with a cap but no spending yet still belongs on the screen —
      // "$0 of $200" is information, and hiding it makes a limit someone set
      // look like it didn't save.
      for (const [category, amount] of categoryLimits) {
        if (!byCategory.has(category)) {
          categories.push({ category, spent: 0, limit: amount });
        }
      }

      return {
        month: formatMonth(month),
        total,
        budget: overall?.amount ?? null,
        entries: entries.map(serializeEntry),
        categories,
        limits: {
          canSetCategoryLimits: limits.budgetLimits,
          canUseCustomCategories: limits.customCategories,
          canExport: limits.budgetExport,
          historyMonths: limits.budgetHistoryMonths,
          earliestMonth: earliest ? formatMonth(earliest) : null,
        },
        availableCategories: availableCategories(usedCategories.map((row) => row.category)),
        tier: effectiveTier(wallet),
      };
    },
  );

  // ---- log spending ----
  app.post("/budget", { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.userId!;
    const body = (request.body ?? {}) as {
      amount?: unknown;
      category?: unknown;
      description?: unknown;
      spentAt?: unknown;
      productId?: unknown;
    };

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) return reply.status(404).send({ error: "No wallet for user" });
    const limits = limitsFor(wallet);

    const amount = normalizeAmount(body.amount);
    if (amount === null) {
      return reply
        .status(400)
        .send({ error: "Enter an amount greater than zero.", code: "INVALID_AMOUNT" });
    }

    const category = normalizeCategory(body.category);
    if (!category) {
      return reply.status(400).send({ error: "Pick a category.", code: "INVALID_CATEGORY" });
    }
    // Custom categories are a paid perk, so a free user is held to the
    // defaults. Checked here because the client's picker can be bypassed.
    if (
      !limits.customCategories &&
      !(DEFAULT_CATEGORIES as readonly string[]).includes(category)
    ) {
      return reply.status(403).send({
        error: "Custom categories are a Pro feature.",
        code: "CUSTOM_CATEGORY_REQUIRES_TIER",
        tier: effectiveTier(wallet),
      });
    }

    const spentAt = normalizeDate(body.spentAt);
    if (spentAt === null) {
      return reply
        .status(400)
        .send({ error: "That date doesn't look right.", code: "INVALID_DATE" });
    }

    // A product link is only accepted if the product actually exists — a bad
    // id would otherwise fail as a foreign key error and surface as a 500.
    let productId: string | null = null;
    if (typeof body.productId === "string" && body.productId) {
      const product = await prisma.product.findUnique({
        where: { id: body.productId },
        select: { id: true },
      });
      productId = product?.id ?? null;
    }

    const entry = await prisma.budgetEntry.create({
      data: {
        userId,
        amount,
        category,
        description: normalizeDescription(body.description),
        spentAt,
        productId,
      },
      include: { product: true },
    });

    return reply.status(201).send({ entry: serializeEntry(entry) });
  });

  // ---- edit ----
  app.patch<{ Params: { id: string } }>(
    "/budget/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.userId!;
      const body = (request.body ?? {}) as {
        amount?: unknown;
        category?: unknown;
        description?: unknown;
        spentAt?: unknown;
      };

      const data: {
        amount?: number;
        category?: string;
        description?: string | null;
        spentAt?: Date;
      } = {};

      if (body.amount !== undefined) {
        const amount = normalizeAmount(body.amount);
        if (amount === null) {
          return reply
            .status(400)
            .send({ error: "Enter an amount greater than zero.", code: "INVALID_AMOUNT" });
        }
        data.amount = amount;
      }
      if (body.category !== undefined) {
        const category = normalizeCategory(body.category);
        if (!category) {
          return reply.status(400).send({ error: "Pick a category.", code: "INVALID_CATEGORY" });
        }
        data.category = category;
      }
      if (body.description !== undefined) {
        data.description = normalizeDescription(body.description);
      }
      if (body.spentAt !== undefined) {
        const spentAt = normalizeDate(body.spentAt);
        if (spentAt === null) {
          return reply
            .status(400)
            .send({ error: "That date doesn't look right.", code: "INVALID_DATE" });
        }
        data.spentAt = spentAt;
      }

      // Scoped by userId so an id guess can't edit someone else's spending.
      const updated = await prisma.budgetEntry.updateMany({
        where: { id: request.params.id, userId },
        data,
      });
      if (updated.count === 0) {
        return reply.status(404).send({ error: "Entry not found" });
      }

      return { ok: true };
    },
  );

  // ---- delete ----
  app.delete<{ Params: { id: string } }>(
    "/budget/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const deleted = await prisma.budgetEntry.deleteMany({
        where: { id: request.params.id, userId: request.userId! },
      });
      if (deleted.count === 0) {
        return reply.status(404).send({ error: "Entry not found" });
      }
      return { ok: true };
    },
  );

  // ---- set or clear a limit ----
  //
  // `category: null` is the overall monthly budget, which every tier gets.
  // A named category is a paid perk. `amount: null` clears it.
  app.put("/budget/limits", { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.userId!;
    const body = (request.body ?? {}) as { category?: unknown; amount?: unknown };

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) return reply.status(404).send({ error: "No wallet for user" });
    const limits = limitsFor(wallet);

    const category =
      body.category === null || body.category === undefined
        ? null
        : normalizeCategory(body.category);
    if (body.category !== null && body.category !== undefined && !category) {
      return reply.status(400).send({ error: "Pick a category.", code: "INVALID_CATEGORY" });
    }

    if (category !== null && !limits.budgetLimits) {
      return reply.status(403).send({
        error: "Per-category limits are a Pro feature. Your overall monthly budget still works.",
        code: "CATEGORY_LIMIT_REQUIRES_TIER",
        tier: effectiveTier(wallet),
      });
    }

    // `` is how "overall" is stored; the API keeps speaking null.
    const stored = category ?? OVERALL;

    if (body.amount === null) {
      await prisma.budgetLimit.deleteMany({ where: { userId, category: stored } });
      return { ok: true, category, amount: null };
    }

    const amount = normalizeAmount(body.amount);
    if (amount === null) {
      return reply
        .status(400)
        .send({ error: "Enter an amount greater than zero.", code: "INVALID_AMOUNT" });
    }

    await prisma.budgetLimit.upsert({
      where: { userId_category: { userId, category: stored } },
      create: { userId, category: stored, amount },
      update: { amount },
    });

    return { ok: true, category, amount };
  });

  // ---- what to prefill "I bought this" with ----
  //
  // The tracked product's current price and a guessed category, so logging a
  // purchase is a confirm rather than a form. Guesses only — everything here
  // is editable before it's saved.
  app.get<{ Params: { productId: string } }>(
    "/budget/prefill/:productId",
    { preHandler: requireAuth },
    async (request, reply) => {
      const product = await prisma.product.findUnique({
        where: { id: request.params.productId },
      });
      if (!product) return reply.status(404).send({ error: "Product not found" });

      return {
        productId: product.id,
        amount: product.currentPrice,
        category: guessCategory(product.retailer, product.title),
        description: product.title.slice(0, MAX_DESCRIPTION_LENGTH),
      };
    },
  );

  // ---- export ----
  app.get("/budget/export.csv", { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.userId!;

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) return reply.status(404).send({ error: "No wallet for user" });
    const limits = limitsFor(wallet);

    if (!limits.budgetExport) {
      return reply.status(403).send({
        error: "Exporting is a Pro feature.",
        code: "EXPORT_REQUIRES_TIER",
        tier: effectiveTier(wallet),
      });
    }

    // Export respects the same history window as the month view — otherwise
    // it would be a way to read back further than the plan allows.
    const earliest = earliestReadableMonth(limits, new Date());
    const entries = await prisma.budgetEntry.findMany({
      where: { userId, ...(earliest ? { spentAt: { gte: earliest } } : {}) },
      orderBy: { spentAt: "desc" },
      include: { product: true },
    });

    const rows = [
      "Date,Amount,Category,Description,Store,Link",
      ...entries.map((entry) =>
        [
          entry.spentAt.toISOString().slice(0, 10),
          (entry.amount / 100).toFixed(2),
          csvCell(entry.category),
          csvCell(entry.description ?? ""),
          csvCell(entry.product?.retailer ?? ""),
          csvCell(entry.product?.url ?? ""),
        ].join(","),
      ),
    ];

    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", 'attachment; filename="sweep-spending.csv"');
    return reply.send(rows.join("\n"));
  });
}

// ---- validation ------------------------------------------------------------

/** Accepts cents as a number. Returns null for anything not a sane amount. */
function normalizeAmount(value: unknown): number | null {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return null;
  const cents = Math.round(amount);
  if (cents <= 0 || cents > MAX_AMOUNT_CENTS) return null;
  return cents;
}

function normalizeCategory(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const category = value.trim().slice(0, MAX_CATEGORY_LENGTH);
  return category || null;
}

function normalizeDescription(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const description = value.trim().slice(0, MAX_DESCRIPTION_LENGTH);
  return description || null;
}

/**
 * Absent means now. A future date is refused: this logs what you *have* spent,
 * and a future entry would quietly inflate the current month.
 */
function normalizeDate(value: unknown): Date | null {
  if (value === undefined || value === null) return new Date();
  if (typeof value !== "string") return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  // A day's grace, so a device clock slightly ahead isn't an error.
  if (date.getTime() > Date.now() + 24 * 60 * 60 * 1000) return null;
  return date;
}

function csvCell(text: string) {
  return `"${text.replace(/"/g, '""')}"`;
}

function serializeEntry(entry: {
  id: string;
  amount: number;
  category: string;
  description: string | null;
  spentAt: Date;
  product: { id: string; title: string; retailer: string; imageUrl: string | null; url: string } | null;
}) {
  return {
    id: entry.id,
    amount: entry.amount,
    category: entry.category,
    description: entry.description,
    spentAt: entry.spentAt,
    product: entry.product
      ? {
          id: entry.product.id,
          title: entry.product.title,
          retailer: entry.product.retailer,
          imageUrl: entry.product.imageUrl,
          url: entry.product.url,
        }
      : null,
  };
}
