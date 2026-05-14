-- Account protection layer: per-account status, daily lock snapshot,
-- pending rule changes, broker discovery/missing tracking.

-- ── ConnectedAccount: protection + discovery columns ─────────────────────
ALTER TABLE "ConnectedAccount"
  ADD COLUMN "protectionStatus"               TEXT NOT NULL DEFAULT 'protected',
  ADD COLUMN "pendingProtectionStatus"        TEXT,
  ADD COLUMN "pendingProtectionEffectiveDate" TEXT,
  ADD COLUMN "lastSeenInBrokerAt"             TIMESTAMP(3),
  ADD COLUMN "missingFromBrokerSince"         TIMESTAMP(3);

CREATE INDEX "ConnectedAccount_userId_protectionStatus_idx"
  ON "ConnectedAccount" ("userId", "protectionStatus");

-- ── RiskRules: cutoff config + pending payload ───────────────────────────
ALTER TABLE "RiskRules"
  ADD COLUMN "protectionLockCutoffMinutes" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "pendingPayloadJson"          JSONB,
  ADD COLUMN "pendingEffectiveDate"        TEXT;

-- ── AccountRiskRules: pending payload ────────────────────────────────────
ALTER TABLE "AccountRiskRules"
  ADD COLUMN "pendingPayloadJson"   JSONB,
  ADD COLUMN "pendingEffectiveDate" TEXT;

-- ── DailyAccountProtection: per-day lock snapshot ────────────────────────
CREATE TABLE "DailyAccountProtection" (
  "id"                  TEXT          NOT NULL,
  "userId"              TEXT          NOT NULL,
  "connectedAccountId"  TEXT          NOT NULL,
  "tradingDay"          TEXT          NOT NULL,
  "protectionStatus"    TEXT          NOT NULL,
  "ruleSource"          TEXT          NOT NULL,
  "lockedAt"            TIMESTAMP(3),
  "canChangeUntil"      TIMESTAMP(3),
  "createdAt"           TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3)  NOT NULL,
  CONSTRAINT "DailyAccountProtection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyAccountProtection_connectedAccountId_tradingDay_key"
  ON "DailyAccountProtection" ("connectedAccountId", "tradingDay");

CREATE INDEX "DailyAccountProtection_userId_tradingDay_idx"
  ON "DailyAccountProtection" ("userId", "tradingDay");

ALTER TABLE "DailyAccountProtection"
  ADD CONSTRAINT "DailyAccountProtection_connectedAccountId_fkey"
  FOREIGN KEY ("connectedAccountId") REFERENCES "ConnectedAccount" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
