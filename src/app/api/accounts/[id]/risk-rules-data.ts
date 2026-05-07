/**
 * Pure transformation: API request body → AccountRiskRules DB column shape.
 * No I/O. No framework imports. Safe to unit-test directly.
 */

export type RiskRulesBody = {
  maxDailyLoss?: number | null;
  riskPerTrade?: number | null;
  maxTradesPerDay?: number | null;
  stopAfterLosses?: number | null;
  allowedStartHour?: number | null;
  allowedEndHour?: number | null;
  sessionEndBehavior?: string | null;
  maxContracts?: number | null;
  selectedSessionPresets?: string[] | null;
  sessionPreset?: string | null;
  sessionStartTime?: string | null;
  sessionEndTime?: string | null;
  sessionTimezone?: string | null;
  ruleEditLockBufferMinutes?: number | null;
  // TODO: Move propFirm fields to Account setup / details page — not Trading Plan rules.
  propFirmAccountSize?: number | null;
  propFirmPhase?: string | null;
  propFirmDailyLossLimit?: number | null;
  propFirmMaxDrawdown?: number | null;
  propFirmEODDrawdown?: number | null;
  propFirmTrailingDrawdown?: boolean;
  propFirmDrawdownRemaining?: number | null;
  propFirmProfitTarget?: number | null;
  propFirmMinTradingDays?: number | null;
};

export function riskRulesData(r: RiskRulesBody) {
  return {
    maxDailyLoss: r.maxDailyLoss != null ? String(r.maxDailyLoss) : null,
    riskPerTrade: r.riskPerTrade != null ? String(r.riskPerTrade) : null,
    maxTradesPerDay: r.maxTradesPerDay ?? null,
    stopAfterLosses: r.stopAfterLosses ?? null,
    allowedStartHour: r.allowedStartHour ?? null,
    allowedEndHour: r.allowedEndHour ?? null,
    sessionEndBehavior: r.sessionEndBehavior ?? null,
    sessionPresetsJson: r.selectedSessionPresets != null ? JSON.stringify(r.selectedSessionPresets) : null,
    sessionPreset: r.sessionPreset ?? null,
    sessionStartTime: r.sessionStartTime ?? null,
    sessionEndTime: r.sessionEndTime ?? null,
    sessionTimezone: r.sessionTimezone ?? null,
    ruleEditLockBufferMinutes: r.ruleEditLockBufferMinutes ?? null,
    maxContracts: r.maxContracts ?? null,
    // propFirm fields: only written when explicitly present in the payload so
    // that saves from the Trading Plan (which omit them) preserve existing values.
    ...(r.propFirmAccountSize !== undefined && { propFirmAccountSize: r.propFirmAccountSize != null ? String(r.propFirmAccountSize) : null }),
    ...(r.propFirmPhase !== undefined && { propFirmPhase: r.propFirmPhase ?? null }),
    ...(r.propFirmDailyLossLimit !== undefined && { propFirmDailyLossLimit: r.propFirmDailyLossLimit != null ? String(r.propFirmDailyLossLimit) : null }),
    ...(r.propFirmMaxDrawdown !== undefined && { propFirmMaxDrawdown: r.propFirmMaxDrawdown != null ? String(r.propFirmMaxDrawdown) : null }),
    ...(r.propFirmEODDrawdown !== undefined && { propFirmEODDrawdown: r.propFirmEODDrawdown != null ? String(r.propFirmEODDrawdown) : null }),
    ...(r.propFirmTrailingDrawdown !== undefined && { propFirmTrailingDrawdown: r.propFirmTrailingDrawdown }),
    ...(r.propFirmDrawdownRemaining !== undefined && { propFirmDrawdownRemaining: r.propFirmDrawdownRemaining != null ? String(r.propFirmDrawdownRemaining) : null }),
    ...(r.propFirmProfitTarget !== undefined && { propFirmProfitTarget: r.propFirmProfitTarget != null ? String(r.propFirmProfitTarget) : null }),
    ...(r.propFirmMinTradingDays !== undefined && { propFirmMinTradingDays: r.propFirmMinTradingDays ?? null }),
  };
}
