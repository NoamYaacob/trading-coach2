import type { AccountStatus } from "./types";

export function derivePropFirmSetupNeeded(input: {
  isPropFirm: boolean;
  hasAccountRules: boolean;
  hasDefaultRules: boolean;
  hasPropFirmDailyLossLimit: boolean;
  hasPropFirmMaxDrawdown: boolean;
  hasPropFirmDrawdownRemaining: boolean;
}): boolean {
  if (!input.isPropFirm) return false;
  // Prop firm limits are optional extras — if any rule source covers the account,
  // it is not in a "setup needed" state.
  if (input.hasAccountRules || input.hasDefaultRules) return false;
  return (
    !input.hasPropFirmDailyLossLimit &&
    !input.hasPropFirmMaxDrawdown &&
    !input.hasPropFirmDrawdownRemaining
  );
}

export function deriveStatus(input: {
  isActive: boolean;
  platform: string;
  connectionStatus: string;
  hasAnyRules: boolean;
  propFirmSetupNeeded: boolean;
  riskState: "NORMAL" | "WARNING" | "STOPPED" | null;
  dailyLossUsedPct: number | null;
  tradesCount: number | null;
  maxTradesPerDay: number | null;
}): AccountStatus {
  if (!input.isActive) return "not_connected";

  // Broker accounts that have not finished setup or have a broken connection.
  if (input.platform !== "manual") {
    if (
      input.connectionStatus === "not_connected" ||
      input.connectionStatus === "connection_error" ||
      input.connectionStatus === "expired"
    ) {
      return "not_connected";
    }
    if (
      input.connectionStatus === "pending_webhook" ||
      input.connectionStatus === "oauth_pending_storage"
    ) {
      return "setup_needed";
    }
  }

  // Risk-state checks come before setup checks — a STOPPED account is locked
  // even if prop-firm-specific limits have not been entered yet.
  if (input.riskState === "STOPPED") return "locked";
  if (input.riskState === "WARNING") return "warning";

  if (!input.hasAnyRules) return "setup_needed";
  if (input.propFirmSetupNeeded) return "setup_needed";

  const lossPct = input.dailyLossUsedPct ?? 0;
  if (lossPct >= 1.0) return "locked";
  if (lossPct >= 0.8) return "warning";

  const { tradesCount, maxTradesPerDay } = input;
  if (tradesCount != null && maxTradesPerDay != null) {
    if (tradesCount >= maxTradesPerDay) return "locked";
    if (maxTradesPerDay > 1 && tradesCount === maxTradesPerDay - 1) return "warning";
  }

  return "allowed";
}
