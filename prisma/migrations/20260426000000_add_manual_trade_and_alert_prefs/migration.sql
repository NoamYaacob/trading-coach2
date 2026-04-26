-- Migration: add_manual_trade_and_alert_prefs
-- Adds ManualTradeEntry (journal) and AlertPreferences models.

CREATE TABLE IF NOT EXISTS "ManualTradeEntry" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "symbol"       TEXT NOT NULL,
  "direction"    TEXT NOT NULL,
  "entryPrice"   DECIMAL(12,4),
  "exitPrice"    DECIMAL(12,4),
  "stopPrice"    DECIMAL(12,4),
  "targetPrice"  DECIMAL(12,4),
  "quantity"     DECIMAL(10,4),
  "pnl"          DECIMAL(10,2),
  "rMultiple"    DECIMAL(6,2),
  "strategy"     TEXT,
  "ruleBreached" BOOLEAN NOT NULL DEFAULT false,
  "notes"        TEXT,
  "tradedAt"     TIMESTAMP(3) NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ManualTradeEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AlertPreferences" (
  "id"              TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "inAppEnabled"    BOOLEAN NOT NULL DEFAULT true,
  "emailEnabled"    BOOLEAN NOT NULL DEFAULT false,
  "telegramEnabled" BOOLEAN NOT NULL DEFAULT false,
  "onDailyLoss"     BOOLEAN NOT NULL DEFAULT true,
  "onMaxTrades"     BOOLEAN NOT NULL DEFAULT true,
  "onConsecLosses"  BOOLEAN NOT NULL DEFAULT true,
  "onProfitTarget"  BOOLEAN NOT NULL DEFAULT false,
  "onMarketClose"   BOOLEAN NOT NULL DEFAULT false,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AlertPreferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AlertPreferences_userId_key" ON "AlertPreferences"("userId");

CREATE INDEX IF NOT EXISTS "ManualTradeEntry_userId_tradedAt_idx" ON "ManualTradeEntry"("userId", "tradedAt");

ALTER TABLE "ManualTradeEntry"
  ADD CONSTRAINT "ManualTradeEntry_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AlertPreferences"
  ADD CONSTRAINT "AlertPreferences_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
