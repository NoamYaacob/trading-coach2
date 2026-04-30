-- Migration: add_pnl_audit_fields
-- Adds fees, grossPnl, and pnlSource for a full broker/trader audit trail.

ALTER TABLE "ManualTradeEntry" ADD COLUMN IF NOT EXISTS "fees"      DECIMAL(10,2);
ALTER TABLE "ManualTradeEntry" ADD COLUMN IF NOT EXISTS "grossPnl"  DECIMAL(10,2);
ALTER TABLE "ManualTradeEntry" ADD COLUMN IF NOT EXISTS "pnlSource" TEXT;
