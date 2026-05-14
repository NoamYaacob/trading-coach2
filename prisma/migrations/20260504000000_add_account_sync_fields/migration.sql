-- Add broker-synced snapshot columns to ConnectedAccount.
-- balance: account equity from Tradovate cashBalance endpoint ("amount").
-- cashBalance: cash available (same source as balance for Tradovate).
-- openPnl: sum of unrealised P&L across open positions.

ALTER TABLE "ConnectedAccount" ADD COLUMN "balance" DECIMAL(14, 2);
ALTER TABLE "ConnectedAccount" ADD COLUMN "cashBalance" DECIMAL(14, 2);
ALTER TABLE "ConnectedAccount" ADD COLUMN "openPnl" DECIMAL(10, 2);
