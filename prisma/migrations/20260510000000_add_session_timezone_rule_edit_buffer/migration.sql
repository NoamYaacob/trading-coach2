ALTER TABLE "RiskRules" ADD COLUMN "sessionTimezone" TEXT;
ALTER TABLE "RiskRules" ADD COLUMN "ruleEditLockBufferMinutes" INTEGER;
ALTER TABLE "AccountRiskRules" ADD COLUMN "sessionTimezone" TEXT;
