-- Add position-flatten tracking columns to GuardianIntervention.
-- These fields record the outcome of the pre-lockout position exit step
-- that runs for daily_loss_limit and profit_target triggers.
-- All columns are nullable so existing rows and older trigger types are unaffected.
ALTER TABLE "GuardianIntervention" ADD COLUMN "flattenStatus"      TEXT;
ALTER TABLE "GuardianIntervention" ADD COLUMN "flattenMessage"     TEXT;
ALTER TABLE "GuardianIntervention" ADD COLUMN "flattenPayloadJson" JSONB;
ALTER TABLE "GuardianIntervention" ADD COLUMN "flattenResponseJson" JSONB;
