-- Add an optional user-facing display name to ConnectedAccount.
--
-- When set, displayName is shown everywhere a human reads the account
-- (sidebar, dashboard cards, settings, rules/trades selectors) in preference
-- to `label` / `externalAccountId`. The broker/internal identity columns
-- (`label`, `externalAccountId`) are unchanged and never replaced.
--
-- Nullable with no default: existing rows keep displayName = NULL and fall
-- back to the derived friendly label (propFirm + accountType) or `label`.

ALTER TABLE "ConnectedAccount" ADD COLUMN "displayName" TEXT;
