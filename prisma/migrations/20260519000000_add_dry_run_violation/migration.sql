-- Add DryRunViolation table for Phase 2A dry-run rule evaluation.
-- Records what enforcement action WOULD have been taken by the realtime
-- listener worker without actually taking any action. Safe to inspect at
-- any time — no enforcement side-effects.

CREATE TABLE "DryRunViolation" (
    "id"                   TEXT NOT NULL,
    "userId"               TEXT NOT NULL,
    "accountId"            TEXT NOT NULL,
    "externalAccountId"    TEXT,
    "env"                  TEXT NOT NULL,
    "ruleType"             TEXT NOT NULL,
    "thresholdAmount"      DECIMAL(10,2),
    "thresholdCount"       INTEGER,
    "observedAmount"       DECIMAL(10,2),
    "observedCount"        INTEGER,
    "sourceEventId"        TEXT,
    "dryRun"               BOOLEAN NOT NULL DEFAULT true,
    "actionWouldHaveTaken" TEXT NOT NULL DEFAULT 'internal_lock',
    "tradingDay"           TEXT NOT NULL,
    "dedupKey"             TEXT NOT NULL,
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DryRunViolation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DryRunViolation_dedupKey_key" ON "DryRunViolation"("dedupKey");
CREATE INDEX "DryRunViolation_userId_tradingDay_idx" ON "DryRunViolation"("userId", "tradingDay");
CREATE INDEX "DryRunViolation_accountId_ruleType_tradingDay_idx" ON "DryRunViolation"("accountId", "ruleType", "tradingDay");

ALTER TABLE "DryRunViolation" ADD CONSTRAINT "DryRunViolation_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DryRunViolation" ADD CONSTRAINT "DryRunViolation_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "ConnectedAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
