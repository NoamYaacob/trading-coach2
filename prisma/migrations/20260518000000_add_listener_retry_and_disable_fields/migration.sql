-- Add soft-retry tracking, operator disable switch, and last-frame diagnostics
-- to BrokerConnection so the listener worker can recover from auth failures
-- automatically with backoff instead of marking the connection permanently
-- dead, and so /api/debug/tradovate-listener/status can show why the WS
-- last closed without log diving.

ALTER TABLE "BrokerConnection" ADD COLUMN "listenerLastAuthFailureAt" TIMESTAMP(3);
ALTER TABLE "BrokerConnection" ADD COLUMN "listenerNextRetryAt" TIMESTAMP(3);
ALTER TABLE "BrokerConnection" ADD COLUMN "listenerRetryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BrokerConnection" ADD COLUMN "listenerDisabledAt" TIMESTAMP(3);
ALTER TABLE "BrokerConnection" ADD COLUMN "listenerLastCloseCode" INTEGER;
ALTER TABLE "BrokerConnection" ADD COLUMN "listenerLastCloseReason" TEXT;
ALTER TABLE "BrokerConnection" ADD COLUMN "listenerLastAuthStatus" INTEGER;
