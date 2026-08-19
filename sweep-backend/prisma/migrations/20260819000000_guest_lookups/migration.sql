-- Guest product-lookup counter.
--
-- Additive with defaults: a backend running the previous schema keeps working
-- against this database, which is what makes it safe to migrate before the new
-- build is fully rolled out.
ALTER TABLE "GuestQuota" ADD COLUMN IF NOT EXISTS "lookupsUsedToday" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "GuestQuota" ADD COLUMN IF NOT EXISTS "lookupsResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
