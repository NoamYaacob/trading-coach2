-- Track how the per-account tradesCount in LiveSessionState was derived so the
-- dashboard and risk engine can downgrade enforcement when the source is
-- unreliable (e.g. unscoped fill/list on multi-account OAuth tokens).
--   verified    — count came from an account-scoped broker source we trust
--   estimated   — count derived from fills that may include other accounts
--   unavailable — fills could not be fetched at all this sync
ALTER TABLE "LiveSessionState"
  ADD COLUMN "tradeCountSource" TEXT NOT NULL DEFAULT 'verified';
