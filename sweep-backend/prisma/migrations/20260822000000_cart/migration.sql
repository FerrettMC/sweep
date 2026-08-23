-- The cart. Additive: a backend on the previous schema keeps working.
CREATE TABLE IF NOT EXISTS "CartItem" (
  "id"         TEXT NOT NULL,
  "quantity"   INTEGER NOT NULL DEFAULT 1,
  "priceAtAdd" INTEGER,
  "addedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId"     TEXT NOT NULL,
  "productId"  TEXT NOT NULL,
  CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CartItem_userId_productId_key"
  ON "CartItem"("userId", "productId");
CREATE INDEX IF NOT EXISTS "CartItem_userId_addedAt_idx"
  ON "CartItem"("userId", "addedAt");

ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS, like every other table.
ALTER TABLE "CartItem" ENABLE ROW LEVEL SECURITY;
