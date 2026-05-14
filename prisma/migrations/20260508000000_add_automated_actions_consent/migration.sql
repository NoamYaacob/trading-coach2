-- Persisted consent for automated broker actions (lockout + position close).
-- Default value is NULL → existing accounts/templates will be blocked from
-- broker writes by applyBrokerDayLockout's consent gate until the user
-- re-saves rules with the consent checkbox.
ALTER TABLE "RiskRules"
  ADD COLUMN "automatedActionsConsentAt" TIMESTAMP(3),
  ADD COLUMN "automatedActionsConsentVersion" TEXT;

ALTER TABLE "AccountRiskRules"
  ADD COLUMN "automatedActionsConsentAt" TIMESTAMP(3),
  ADD COLUMN "automatedActionsConsentVersion" TEXT;
