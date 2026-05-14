-- Add real-time WebSocket listener tracking fields to BrokerConnection.
-- Set by the TradovateListenerManager worker; read by the dashboard to show
-- listener freshness instead of a generic "Data may be stale" warning.
ALTER TABLE "BrokerConnection" ADD COLUMN "listenerStatus" TEXT;
ALTER TABLE "BrokerConnection" ADD COLUMN "listenerConnectedAt" TIMESTAMP(3);
ALTER TABLE "BrokerConnection" ADD COLUMN "listenerLastEventAt" TIMESTAMP(3);
ALTER TABLE "BrokerConnection" ADD COLUMN "listenerLastHeartbeatAt" TIMESTAMP(3);
ALTER TABLE "BrokerConnection" ADD COLUMN "listenerErrorMessage" TEXT;
