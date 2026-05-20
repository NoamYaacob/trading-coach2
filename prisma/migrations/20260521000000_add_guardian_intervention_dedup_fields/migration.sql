-- Phase 2C-A: audit/idempotency foundation for broker enforcement.
-- Adds three nullable fields to GuardianIntervention:
--
--   internalLockEventId    — FK to InternalLockEvent that preceded this enforcement.
--                            SET NULL on delete (intervention history is never lost).
--   listenerBrokerDedupKey — Unique dedup key for listener-path enforcement.
--                            Format: "${accountId}:${triggerType}:${tradingDay}:broker_enforcement"
--                            Unique constraint prevents concurrent duplicate broker writes.
--   tradingDay             — YYYY-MM-DD of the violation; needed for per-day dedup display.
--
-- All three fields are nullable — existing cron-path GuardianIntervention rows
-- are unaffected. No runtime behavior changes. No broker writes.

ALTER TABLE "GuardianIntervention" ADD COLUMN "internalLockEventId"    TEXT;
ALTER TABLE "GuardianIntervention" ADD COLUMN "listenerBrokerDedupKey" TEXT;
ALTER TABLE "GuardianIntervention" ADD COLUMN "tradingDay"             TEXT;

CREATE UNIQUE INDEX "GuardianIntervention_listenerBrokerDedupKey_key"
    ON "GuardianIntervention"("listenerBrokerDedupKey");

CREATE INDEX "GuardianIntervention_internalLockEventId_idx"
    ON "GuardianIntervention"("internalLockEventId");

ALTER TABLE "GuardianIntervention"
    ADD CONSTRAINT "GuardianIntervention_internalLockEventId_fkey"
    FOREIGN KEY ("internalLockEventId")
    REFERENCES "InternalLockEvent"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
