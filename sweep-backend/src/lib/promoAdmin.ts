// lib/promoAdmin.ts
//
// Creating and listing promo codes. The admin half of lib/promo.ts.
//
// Kept separate from redemption because the two have opposite threat models:
// redemption is public and hostile, creation is behind the admin key and
// trusted. Mixing them makes it harder to see which is which.

import { prisma } from "./prisma.js";
import { TIERS, type Tier } from "./tiers.js";
import { normalizeCode } from "./promo.js";

/**
 * Characters used when generating a code.
 *
 * No O/0, I/1, S/5 — codes get read off a screen, a sticker, or a paused video
 * and typed by hand, and those pairs are where that goes wrong. Losing six
 * characters costs nothing; a code that can't be typed correctly costs a
 * support email.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRTUVWXYZ2346789";

const MAX_DURATION_DAYS = 365;
const MAX_REDEMPTIONS = 100_000;

export interface CreateCodeInput {
  code?: string;
  tier: string;
  days: number;
  maxRedemptions?: number | null;
  expiresInDays?: number | null;
}

export async function createPromoCode(input: CreateCodeInput) {
  const tier = input.tier as Tier;
  if (!TIERS.includes(tier) || tier === "free") {
    throw new Error(`tier must be one of: ${TIERS.filter((t) => t !== "free").join(", ")}`);
  }

  const days = Math.floor(input.days);
  if (!Number.isFinite(days) || days < 1 || days > MAX_DURATION_DAYS) {
    throw new Error(`days must be between 1 and ${MAX_DURATION_DAYS}`);
  }

  const maxRedemptions =
    input.maxRedemptions === null || input.maxRedemptions === undefined
      ? null
      : Math.floor(input.maxRedemptions);
  if (
    maxRedemptions !== null &&
    (maxRedemptions < 1 || maxRedemptions > MAX_REDEMPTIONS)
  ) {
    throw new Error(`maxRedemptions must be between 1 and ${MAX_REDEMPTIONS}`);
  }

  // Stored in the same normalized form the redeem path produces, so a code
  // typed with dashes or in lower case still matches the row.
  const code = input.code?.trim() ? normalizeCode(input.code) : generateCode();
  if (code.length < 4) throw new Error("code must be at least 4 characters");

  const expiresAt =
    input.expiresInDays && input.expiresInDays > 0
      ? new Date(Date.now() + Math.floor(input.expiresInDays) * 86_400_000)
      : null;

  try {
    return await prisma.promoCode.create({
      data: {
        code,
        grantsTier: tier,
        grantsDurationDays: days,
        maxRedemptions,
        expiresAt,
      },
    });
  } catch {
    throw new Error(`"${code}" already exists`);
  }
}

export async function listPromoCodes(limit = 50) {
  const codes = await prisma.promoCode.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return codes.map((c) => ({
    code: c.code,
    tier: c.grantsTier,
    days: c.grantsDurationDays,
    used: c.timesRedeemed,
    max: c.maxRedemptions,
    expiresAt: c.expiresAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    // Precomputed so the page doesn't reimplement the rules in JavaScript and
    // get them subtly different from the server.
    exhausted: c.maxRedemptions !== null && c.timesRedeemed >= c.maxRedemptions,
    expired: c.expiresAt !== null && c.expiresAt.getTime() < Date.now(),
  }));
}

function generateCode(): string {
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

export interface DeleteResult {
  code: string;
  /** How many redemption records were removed with it. */
  redemptionsRemoved: number;
}

/**
 * Remove a code entirely.
 *
 * Redemption rows point at the code, so they go first or the delete fails on
 * the foreign key. Both happen in one transaction: a half-delete would leave
 * rows referencing a code that no longer exists.
 *
 * Grants already handed out are NOT revoked, and can't be — they live on the
 * wallet in their own columns, which is the same separation that stops a promo
 * from damaging a subscription. Deleting a code stops anyone ELSE redeeming it;
 * it doesn't reach back and take time off people who already have it. That's
 * the right behaviour (nobody should lose access because we tidied up an admin
 * table) but it has to be said out loud, since "delete" can suggest otherwise.
 */
export async function deletePromoCode(rawCode: string): Promise<DeleteResult> {
  const code = normalizeCode(rawCode);
  const promo = await prisma.promoCode.findUnique({ where: { code } });
  if (!promo) throw new Error(`"${code}" doesn't exist`);

  const [removed] = await prisma.$transaction([
    prisma.promoCodeRedemption.deleteMany({ where: { promoCodeId: promo.id } }),
    prisma.promoCode.delete({ where: { id: promo.id } }),
  ]);

  return { code, redemptionsRemoved: removed.count };
}
