-- Promo grants get their own columns, separate from the paid subscription.
--
-- Both nullable with no default, so existing wallets are untouched and an
-- older backend that doesn't know these columns keeps working unchanged.
ALTER TABLE "Wallet" ADD COLUMN "promoTier" TEXT;
ALTER TABLE "Wallet" ADD COLUMN "promoExpiresAt" TIMESTAMP(3);
