-- Reopenable search history, per user, capped by tier.
--
-- Additive: a backend that doesn't know this table is unaffected.
CREATE TABLE "SearchHistory" (
    "id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "productIds" TEXT[],
    "storeCount" INTEGER NOT NULL DEFAULT 0,
    "searchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    CONSTRAINT "SearchHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SearchHistory_userId_keyword_key" ON "SearchHistory"("userId", "keyword");
CREATE INDEX "SearchHistory_userId_searchedAt_idx" ON "SearchHistory"("userId", "searchedAt");

ALTER TABLE "SearchHistory" ADD CONSTRAINT "SearchHistory_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
