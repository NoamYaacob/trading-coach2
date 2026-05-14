-- Prop firm rule profile foundation
ALTER TABLE "AccountRiskRules" ADD COLUMN "propFirmPhase" TEXT;
ALTER TABLE "AccountRiskRules" ADD COLUMN "propFirmEODDrawdown" DECIMAL(10,2);
ALTER TABLE "AccountRiskRules" ADD COLUMN "propFirmProfitTarget" DECIMAL(10,2);
ALTER TABLE "AccountRiskRules" ADD COLUMN "propFirmMinTradingDays" INTEGER;
