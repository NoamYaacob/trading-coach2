-- Migration: add_stripe_fields
-- Add Stripe customer and subscription IDs to the User table.
-- Written with IF NOT EXISTS so this is safe to re-run against a DB that
-- already has these columns (e.g. a DB previously synced via prisma db push).

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "stripeCustomerId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "stripeSubscriptionId" TEXT;

-- Prisma represents @unique as a named index, not an inline column constraint.
CREATE UNIQUE INDEX IF NOT EXISTS "User_stripeCustomerId_key"     ON "User"("stripeCustomerId");
CREATE UNIQUE INDEX IF NOT EXISTS "User_stripeSubscriptionId_key" ON "User"("stripeSubscriptionId");
