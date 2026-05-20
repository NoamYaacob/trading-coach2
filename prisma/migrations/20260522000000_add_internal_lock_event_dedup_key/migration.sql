-- Phase 2B idempotency fix: add activeDedupKey to InternalLockEvent.
--
-- Root cause: repeated Tradovate props events called applyInternalLockForConnection
-- concurrently before the first transaction could commit riskState=STOPPED. Each
-- concurrent call saw riskState=NORMAL, passed canApplyInternalLock, and executed
-- an internalLockEvent.create — producing duplicate active rows (11 observed in
-- production for a single daily_loss_limit violation on 2026-05-14).
--
-- Fix: nullable unique column `activeDedupKey` with format:
--   "${accountId}:${ruleType}:${tradingDay}:internal_lock"
--
-- Active locks (clearedAt IS NULL) hold the key — the DB unique constraint
-- prevents a second INSERT from creating a duplicate. On clear (manual reset or
-- session end), the column is set to NULL so the slot can be reused after reset.
-- Multiple NULLs are allowed by the DB (NULL is not unique-constrained in both
-- PostgreSQL and SQLite), so cleared history rows coexist safely.
--
-- The application-side change switches internalLockEvent.create → upsert using
-- activeDedupKey as the conflict target, so concurrent transactions that race
-- past the riskState check produce a single row (the second upsert updates
-- observedAmount/updatedAt on the first row instead of inserting).

ALTER TABLE "InternalLockEvent" ADD COLUMN "activeDedupKey" TEXT;

CREATE UNIQUE INDEX "InternalLockEvent_activeDedupKey_key"
    ON "InternalLockEvent"("activeDedupKey");
