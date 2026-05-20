-- Phase 2B: InternalLockEvent audit table.
-- Written when the realtime listener sets riskState=STOPPED for a demo account.
-- No broker action is ever taken — internalOnly=true, brokerActionTaken=false always.
-- clearedAt is stamped by the reset-session-state endpoint when riskState is cleared.

CREATE TABLE "InternalLockEvent" (
    "id"                TEXT        NOT NULL,
    "accountId"         TEXT        NOT NULL,
    "userId"            TEXT        NOT NULL,
    "ruleType"          TEXT        NOT NULL,
    "tradingDay"        TEXT        NOT NULL,
    "thresholdAmount"   DECIMAL(10,2),
    "thresholdCount"    INTEGER,
    "observedAmount"    DECIMAL(10,2),
    "observedCount"     INTEGER,
    "internalOnly"      BOOLEAN     NOT NULL DEFAULT true,
    "brokerActionTaken" BOOLEAN     NOT NULL DEFAULT false,
    "clearedAt"         TIMESTAMP(3),
    "clearedBy"         TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternalLockEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InternalLockEvent_accountId_createdAt_idx"  ON "InternalLockEvent"("accountId", "createdAt");
CREATE INDEX "InternalLockEvent_userId_createdAt_idx"     ON "InternalLockEvent"("userId",    "createdAt");
CREATE INDEX "InternalLockEvent_accountId_tradingDay_idx" ON "InternalLockEvent"("accountId", "tradingDay");

ALTER TABLE "InternalLockEvent" ADD CONSTRAINT "InternalLockEvent_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "ConnectedAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
