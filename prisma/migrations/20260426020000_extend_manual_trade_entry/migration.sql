-- Migration: extend_manual_trade_entry
-- Adds riskAmount and breachReason for richer journal entries.

ALTER TABLE "ManualTradeEntry" ADD COLUMN IF NOT EXISTS "riskAmount"   DECIMAL(10,2);
ALTER TABLE "ManualTradeEntry" ADD COLUMN IF NOT EXISTS "breachReason" TEXT;
