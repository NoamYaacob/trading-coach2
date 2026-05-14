-- Migration: extend_connected_account
-- Adds token storage placeholders and connection metadata fields.
-- Columns are nullable; nothing is written here until Tradovate OAuth +
-- token encryption ship together. See docs/broker-integration-plan.md.

ALTER TABLE "ConnectedAccount" ADD COLUMN IF NOT EXISTS "accessTokenEncrypted"  TEXT;
ALTER TABLE "ConnectedAccount" ADD COLUMN IF NOT EXISTS "refreshTokenEncrypted" TEXT;
ALTER TABLE "ConnectedAccount" ADD COLUMN IF NOT EXISTS "tokenExpiresAt"        TIMESTAMP(3);
ALTER TABLE "ConnectedAccount" ADD COLUMN IF NOT EXISTS "capabilitiesJson"      JSONB;
ALTER TABLE "ConnectedAccount" ADD COLUMN IF NOT EXISTS "lastSyncAt"            TIMESTAMP(3);
ALTER TABLE "ConnectedAccount" ADD COLUMN IF NOT EXISTS "errorMessage"          TEXT;
