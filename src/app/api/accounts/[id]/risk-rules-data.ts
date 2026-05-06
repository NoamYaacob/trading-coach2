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
    maxContracts: r.maxContracts ?? null,
    propFirmAccountSize: r.propFirmAccountSize != null ? String(r.propFirmAccountSize) : null,
    propFirmPhase: r.propFirmPhase ?? null,
    propFirmDailyLossLimit: r.propFirmDailyLossLimit != null ? String(r.propFirmDailyLossLimit) : null,
    propFirmMaxDrawdown: r.propFirmMaxDrawdown != null ? String(r.propFirmMaxDrawdown) : null,
    propFirmEODDrawdown: r.propFirmEODDrawdown != null ? String(r.propFirmEODDrawdown) : null,
    propFirmTrailingDrawdown: r.propFirmTrailingDrawdown ?? false,
    propFirmDrawdownRemaining: r.propFirmDrawdownRemaining != null ? String(r.propFirmDrawdownRemaining) : null,
    propFirmProfitTarget: r.propFirmProfitTarget != null ? String(r.propFirmProfitTarget) : null,
    propFirmMinTradingDays: r.propFirmMinTradingDays ?? null,
  };
}
