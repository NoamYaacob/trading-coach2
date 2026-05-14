-- Add rawBrokerHardLimitEnabled to AccountRiskRules.
-- OFF by default. When true, Guardrail writes a global raw contract cap
-- (totalBy="Overall") to Tradovate instead of the default app-side-only
-- detection-response enforcement. WARNING: global raw cap counts all contracts
-- equally; with max=1, even 2 MNQ (0.2 NQ-equivalent) will be rejected.
ALTER TABLE "AccountRiskRules" ADD COLUMN "rawBrokerHardLimitEnabled" BOOLEAN NOT NULL DEFAULT false;
