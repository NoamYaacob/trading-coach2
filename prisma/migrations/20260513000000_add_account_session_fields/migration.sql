ALTER TABLE "AccountRiskRules" ADD COLUMN "sessionPreset" TEXT;
ALTER TABLE "AccountRiskRules" ADD COLUMN "sessionStartTime" TEXT;
ALTER TABLE "AccountRiskRules" ADD COLUMN "sessionEndTime" TEXT;
ALTER TABLE "AccountRiskRules" ADD COLUMN "sessionPresetsJson" TEXT;
ALTER TABLE "AccountRiskRules" ADD COLUMN "ruleEditLockBufferMinutes" INTEGER;
