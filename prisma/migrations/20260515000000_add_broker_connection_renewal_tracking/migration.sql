-- Add token renewal tracking fields to BrokerConnection.
-- lastRenewedAt: set on every successful renewal so the debug endpoint can show
--               "minutes since last renewal" alongside "minutes until expiry".
-- lastRenewError: stores the reason text written by markExpiredWithAccounts; cleared
--                on each successful renewal so it represents the most recent failure.
ALTER TABLE "BrokerConnection" ADD COLUMN "lastRenewedAt" TIMESTAMP(3);
ALTER TABLE "BrokerConnection" ADD COLUMN "lastRenewError" TEXT;
