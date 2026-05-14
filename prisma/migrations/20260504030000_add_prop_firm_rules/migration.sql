-- Add prop firm limit fields to AccountRiskRules.
-- These fields drive effectiveLossBudget = min(maxDailyLoss, propFirmDailyLossLimit,
-- propFirmDrawdownRemaining) for evaluation / funded prop firm accounts.

ALTER TABLE "AccountRiskRules" ADD COLUMN "propFirmAccountSize" DECIMAL(14,2);
ALTER TABLE "AccountRiskRules" ADD COLUMN "propFirmDailyLossLimit" DECIMAL(10,2);
ALTER TABLE "AccountRiskRules" ADD COLUMN "propFirmMaxDrawdown" DECIMAL(10,2);
ALTER TABLE "AccountRiskRules" ADD COLUMN "propFirmTrailingDrawdown" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AccountRiskRules" ADD COLUMN "propFirmDrawdownRemaining" DECIMAL(10,2);
