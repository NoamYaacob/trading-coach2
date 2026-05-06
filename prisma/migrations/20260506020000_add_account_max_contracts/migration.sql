-- Add per-account override for max contracts / position size.
-- When set, takes precedence over RiskRules.maxContracts for that account.
ALTER TABLE "AccountRiskRules" ADD COLUMN "maxContracts" INTEGER;
