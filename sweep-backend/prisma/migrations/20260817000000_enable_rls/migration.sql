-- Lock the public schema away from the PostgREST API.
--
-- Supabase exposes every table in `public` through its REST API, authorised by
-- the anon/publishable key. That key ships inside the Android app, so anyone
-- who downloads it can read it — which meant the whole database was
-- world-readable and world-writable.
--
-- Verified before this migration, using the key extracted from the app: it
-- could read User, Wallet, TrackedProduct and List, and PATCH a wallet to a
-- paid tier. That is free Ultimate for anyone who looked.
--
-- Enabling RLS with no policies denies everything through PostgREST. The
-- backend is unaffected: Prisma connects as the table owner over a direct
-- Postgres connection, and owners bypass RLS.
--
-- No policies are added, deliberately. Nothing should reach these tables
-- except our API, which does its own authorisation — a policy here would be a
-- second authorisation system to keep in step with the first.

ALTER TABLE public."User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PushToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Wallet" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PriceHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TrackedProduct" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ScrapeCheck" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ScraperAlert" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."IpQuota" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."GuestQuota" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AdReward" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Deal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."List" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ListItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."BudgetEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SavedSearch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."BudgetLimit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Transaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PromoCode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PromoCodeRedemption" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."_prisma_migrations" ENABLE ROW LEVEL SECURITY;
