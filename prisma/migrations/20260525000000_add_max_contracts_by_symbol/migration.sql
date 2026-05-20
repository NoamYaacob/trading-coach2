-- Add symbol-specific max-contracts JSON field to the rule tables.
--
-- Phase 4 (foundation): stores per-symbol contract limits as a JSON string
-- array, e.g. '[{"symbol":"NQ","maxContracts":2},{"symbol":"MNQ","maxContracts":10}]'.
--
-- Additive and nullable: existing rows default to NULL (no symbol-specific
-- limits configured). No data migration required. Zero-downtime — adding a
-- nullable column does not lock the table.
--
-- No enforcement behaviour reads this column yet. UI and guardian-evaluator
-- wiring are later phases. Guardrail-monitored only — never written to broker.

ALTER TABLE "AccountRiskRules" ADD COLUMN "maxContractsBySymbolJson" TEXT;
ALTER TABLE "RiskRules" ADD COLUMN "maxContractsBySymbolJson" TEXT;
