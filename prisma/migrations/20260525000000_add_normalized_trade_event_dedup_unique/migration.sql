-- NormalizedTradeEvent: add a DB-level uniqueness guard on the natural dedup key.
--
-- Root cause: both ingestion paths (Tradovate webhook route and cron sync)
-- deduplicate trade events with a check-then-create pattern — findFirst, then
-- create if absent. Under concurrent reconciliation (a reconnect while a sync
-- is already running, or sync racing the webhook) two callers can both pass
-- the findFirst check before either inserts, producing duplicate rows. The
-- downstream trade-count and P&L derivations then double-count.
--
-- Fix: a unique index on (accountId, eventType, externalTradeId).
--
--   - eventType is part of the key because externalTradeId comes from two
--     separate Tradovate ID namespaces: order IDs (eventType "trade_opened")
--     and fill/execution IDs (eventType "fill" / "trade_closed*"). A numeric
--     order ID can equal a numeric fill ID; including eventType keeps those
--     genuinely distinct events from colliding, while still collapsing
--     same-type duplicates (the actual race).
--   - Rows with a NULL externalTradeId (e.g. "daily_pnl_updated") are exempt:
--     PostgreSQL treats NULLs as distinct, so any number of them coexist.
--
-- Pre-step: collapse any pre-existing exact duplicates so the unique index can
-- be created. For each (accountId, eventType, externalTradeId) group the
-- earliest row (by createdAt, then id) is kept — this matches the existing
-- "first write wins" behaviour of the check-then-create code. Duplicate rows
-- in a group carry no distinct information (same broker event), so removing
-- them only corrects double-counted trade totals; it does not otherwise change
-- P&L math.

DELETE FROM "NormalizedTradeEvent"
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT
      "id",
      ROW_NUMBER() OVER (
        PARTITION BY "accountId", "eventType", "externalTradeId"
        ORDER BY "createdAt" ASC, "id" ASC
      ) AS rn
    FROM "NormalizedTradeEvent"
    WHERE "externalTradeId" IS NOT NULL
  ) ranked
  WHERE ranked.rn > 1
);

CREATE UNIQUE INDEX "NormalizedTradeEvent_accountId_eventType_externalTradeId_key"
    ON "NormalizedTradeEvent"("accountId", "eventType", "externalTradeId");
