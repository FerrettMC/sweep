-- Keyword search cache, plus seller feedback on Product.
--
-- Additive only: a backend running the previous schema keeps working against
-- this database, which is what makes it safe to migrate ahead of the deploy.

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "sellerRating" DOUBLE PRECISION;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "sellerRatingCount" INTEGER;

CREATE TABLE IF NOT EXISTS "SearchCache" (
  "id"         TEXT NOT NULL,
  "keyword"    TEXT NOT NULL,
  "retailer"   TEXT NOT NULL,
  "productIds" TEXT[] NOT NULL,
  "limit"      INTEGER NOT NULL,
  "fetchedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SearchCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SearchCache_keyword_retailer_key"
  ON "SearchCache"("keyword", "retailer");
CREATE INDEX IF NOT EXISTS "SearchCache_fetchedAt_idx"
  ON "SearchCache"("fetchedAt");

-- RLS, matching every other table: the app's public key must never reach this
-- directly. Prisma connects as the owner and bypasses it.
ALTER TABLE "SearchCache" ENABLE ROW LEVEL SECURITY;
