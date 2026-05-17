-- Add reconnect reconciliation tracking fields to BrokerConnection.
--
-- Written by the listener-worker after each listener-ready event (initial
-- connect and reconnects) to record whether fill/trade state was
-- successfully recovered after a WebSocket gap.
--
-- Diagnostics only: no broker enforcement behaviour reads these fields.
-- Enables the admin Safety Console to show whether any reconciliation
-- gaps were detected after reconnects.

ALTER TABLE "BrokerConnection" ADD COLUMN "lastReconciliationAt" TIMESTAMP(3);
ALTER TABLE "BrokerConnection" ADD COLUMN "lastReconciliationTrigger" TEXT;
ALTER TABLE "BrokerConnection" ADD COLUMN "lastReconciliationStatus" TEXT;
ALTER TABLE "BrokerConnection" ADD COLUMN "lastReconciliationError" TEXT;
ALTER TABLE "BrokerConnection" ADD COLUMN "lastReconciledAccountCount" INTEGER;
