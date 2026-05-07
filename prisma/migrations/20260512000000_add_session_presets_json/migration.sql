-- Add multi-select session presets JSON column.
-- Stores a JSON array of preset IDs e.g. '["ny_am","london"]'.
-- When set, takes precedence over sessionPreset/sessionStartTime/sessionEndTime.
ALTER TABLE "RiskRules" ADD COLUMN "sessionPresetsJson" TEXT;
