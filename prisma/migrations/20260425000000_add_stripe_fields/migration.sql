-- Migration: add_stripe_fields
-- Add Stripe customer and subscription IDs to the User table.

ALTER TABLE "User"
  ADD COLUMN "stripeCustomerId" TEXT UNIQUE,
  ADD COLUMN "stripeSubscriptionId" TEXT UNIQUE;
