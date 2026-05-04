-- Add broker lock tracking columns to GuardianIntervention
ALTER TABLE "GuardianIntervention" ADD COLUMN "brokerEndpoint" TEXT;
ALTER TABLE "GuardianIntervention" ADD COLUMN "brokerPayloadJson" JSONB;
ALTER TABLE "GuardianIntervention" ADD COLUMN "brokerResponseJson" JSONB;
ALTER TABLE "GuardianIntervention" ADD COLUMN "brokerLockStatus" TEXT;
