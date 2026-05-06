-- Add probed permission level columns to BrokerConnection.
-- The capability probe runs after OAuth and during periodic sync. It calls a
-- safe Tradovate read endpoint that requires Account Risk Settings permission,
-- so a successful read is strong evidence that broker-side enforcement writes
-- (userAccountAutoLiq/update, order/liquidatepositions) will also be permitted.
-- Both columns nullable: existing rows are unaffected and treated as "not yet probed".
ALTER TABLE "BrokerConnection" ADD COLUMN "permissionLevel" TEXT;
ALTER TABLE "BrokerConnection" ADD COLUMN "permissionsProbedAt" TIMESTAMP(3);
