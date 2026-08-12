// src/lib/wallet.ts
import { prisma } from "./prisma.js";

type Tier = "free" | "pro" | "ultimate";

const SEARCH_LIMITS: Record<Tier, number> = {
  free: 1,
  pro: 10,
  ultimate: 100,
};

function startOfTodayUTC(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

// Resets searchesUsedToday to 0 if the wallet's last reset was before today.
async function resetIfNewDay(userId: string) {
  const today = startOfTodayUTC();

  await prisma.wallet.updateMany({
    where: { userId, searchesResetAt: { lt: today } },
    data: { searchesUsedToday: 0, searchesResetAt: today },
  });
}

export interface SearchConsumeResult {
  allowed: boolean;
  remaining: number;
  limit: number;
}

// Atomically checks the daily limit and consumes one search if available.
// Safe against concurrent requests: the UPDATE only matches rows where
// searchesUsedToday is still under the limit at the moment Postgres applies
// it, so two rapid-fire requests can't both slip through — same category of
// bug as the _layout.tsx race, fixed the same way (check + write in one atomic op).
export async function consumeSearch(
  userId: string,
): Promise<SearchConsumeResult> {
  await resetIfNewDay(userId);

  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) throw new Error(`No wallet found for user ${userId}`);

  const tier = (wallet.tier as Tier) ?? "free";
  const limit = SEARCH_LIMITS[tier] ?? SEARCH_LIMITS.free;

  const result = await prisma.wallet.updateMany({
    where: { userId, searchesUsedToday: { lt: limit } },
    data: { searchesUsedToday: { increment: 1 } },
  });

  if (result.count === 0) {
    return { allowed: false, remaining: 0, limit };
  }

  const updated = await prisma.wallet.findUnique({ where: { userId } });
  const remaining = Math.max(limit - (updated?.searchesUsedToday ?? limit), 0);

  return { allowed: true, remaining, limit };
}

// Call after the backend verifies a completed rewarded-ad watch (e.g. AdMob
// server-side verification callback) — never trust a client-only "ad finished"
// signal, or someone can fake it and get unlimited free searches.
export async function grantBonusSearch(userId: string) {
  await resetIfNewDay(userId);
  await prisma.wallet.update({
    where: { userId },
    data: { searchesUsedToday: { decrement: 1 } },
  });
}
