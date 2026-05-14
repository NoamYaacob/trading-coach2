-- Add session-end behavior field to default and account-specific rule models.
-- Nullable so existing rows are unaffected; null is treated as "wait_for_exit_then_lock"
-- (the safe default: lock new openings immediately, let active trades finish).
ALTER TABLE "RiskRules" ADD COLUMN "sessionEndBehavior" TEXT;
ALTER TABLE "AccountRiskRules" ADD COLUMN "sessionEndBehavior" TEXT;

-- Track whether an account is waiting for an open position to close before
-- applying the session-end lock (used by the "wait_for_exit_then_lock" behavior).
ALTER TABLE "LiveSessionState" ADD COLUMN "pendingSessionEndLock" BOOLEAN NOT NULL DEFAULT false;
