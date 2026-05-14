-- Migration: extend_risk_rules
-- Adds new editable rule fields to RiskRules so /rules can be the single source
-- of truth for user-level risk configuration.

ALTER TABLE "RiskRules" ADD COLUMN IF NOT EXISTS "dailyProfitTarget"    DECIMAL(10,2);
ALTER TABLE "RiskRules" ADD COLUMN IF NOT EXISTS "maxContracts"         INTEGER;
ALTER TABLE "RiskRules" ADD COLUMN IF NOT EXISTS "allowedSymbols"       TEXT;
ALTER TABLE "RiskRules" ADD COLUMN IF NOT EXISTS "sessionStartHour"     INTEGER;
ALTER TABLE "RiskRules" ADD COLUMN IF NOT EXISTS "sessionEndHour"       INTEGER;
ALTER TABLE "RiskRules" ADD COLUMN IF NOT EXISTS "tradingDays"          TEXT;
ALTER TABLE "RiskRules" ADD COLUMN IF NOT EXISTS "newsLockoutEnabled"   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RiskRules" ADD COLUMN IF NOT EXISTS "onBreachWarn"         BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "RiskRules" ADD COLUMN IF NOT EXISTS "onBreachAppLock"      BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "RiskRules" ADD COLUMN IF NOT EXISTS "onBreachCancelOrders" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RiskRules" ADD COLUMN IF NOT EXISTS "onBreachFlatten"      BOOLEAN NOT NULL DEFAULT false;
