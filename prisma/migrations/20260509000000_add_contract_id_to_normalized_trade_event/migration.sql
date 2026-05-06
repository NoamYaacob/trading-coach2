-- Add contractId to NormalizedTradeEvent for position-aware entry detection.
-- Used to track net position per contract/symbol so fills can be classified
-- as entries (flat→non-flat, scale-in, reversal) vs. exits (reductions).
-- Nullable: existing rows and non-fill events leave this column NULL.
ALTER TABLE "NormalizedTradeEvent"
  ADD COLUMN "contractId" INTEGER;

CREATE INDEX "NormalizedTradeEvent_accountId_contractId_occurredAt_idx"
  ON "NormalizedTradeEvent"("accountId", "contractId", "occurredAt");
