import type { AccountStatus } from "./types";

export function deriveBreachReason(input: {
  status: AccountStatus;
  riskState: "NORMAL" | "WARNING" | "STOPPED" | null;
  dailyLossUsedPct: number | null;
  tradesCount: number | null;
  maxTradesPerDay: number | null;
  consecutiveLosses: number | null;
  stopAfterLosses: number | null;
  /** When not "verified", trade-limit breach copy is suppressed entirely
   *  because the count cannot be trusted to belong to this account. */
  tradeCountSource?: "verified" | "estimated" | "unavailable";
}): { headline: string; detail?: string } | null {
  if (input.status !== "warning" && input.status !== "locked") return null;

  const { tradesCount, maxTradesPerDay, consecutiveLosses, stopAfterLosses } = input;
  const tradeCountSource = input.tradeCountSource ?? "verified";
  const tradesAtOrOverLimit =
    tradeCountSource === "verified" &&
    tradesCount != null &&
    maxTradesPerDay != null &&
    tradesCount >= maxTradesPerDay;

  // Daily loss is definitively at the limit — always takes priority over trade count.
  if (input.dailyLossUsedPct != null && input.dailyLossUsedPct >= 1) {
    return {
      headline: "Daily loss limit reached",
      detail: "This account is locked for the rest of the trading day.",
    };
  }

  // Trade count is at or over limit (only when tradeCountSource is "verified").
  if (tradesAtOrOverLimit) {
    return {
      headline: "Trade activity may exceed limit",
      detail: "Review your Tradovate Performance Report to confirm.",
    };
  }

  // STOPPED but neither daily loss pct nor trade count pinpoints the cause —
  // daily P&L may be unavailable; fall back to generic locked message.
  if (input.riskState === "STOPPED") {
    return {
      headline: "Daily loss limit reached",
      detail: "This account is locked for the rest of the trading day.",
    };
  }

  if (consecutiveLosses != null && stopAfterLosses != null && consecutiveLosses >= stopAfterLosses) {
    return { headline: `Loss streak: ${consecutiveLosses}/${stopAfterLosses}` };
  }

  if (input.dailyLossUsedPct != null && input.dailyLossUsedPct >= 0.8) {
    return { headline: "Approaching daily loss limit" };
  }

  if (
    tradeCountSource === "verified" &&
    tradesCount != null &&
    maxTradesPerDay != null &&
    maxTradesPerDay > 1 &&
    tradesCount === maxTradesPerDay - 1
  ) {
    return {
      headline: `Trade limit warning: ${tradesCount}/${maxTradesPerDay}`,
      detail: "One trade left today.",
    };
  }

  return null;
}


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
  /** When not "verified", trade count alone cannot push status to locked/warning
   *  because it may include fills from other accounts on the same OAuth token. */
  tradeCountSource?: "verified" | "estimated" | "unavailable";
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

  // Trade-count-driven status only applies when the count is verified per
  // account; otherwise we may be reading mixed multi-account fill data and
  // must not lock the account based on trades alone.
  const tradeCountSource = input.tradeCountSource ?? "verified";
  if (tradeCountSource === "verified") {
    const { tradesCount, maxTradesPerDay } = input;
    if (tradesCount != null && maxTradesPerDay != null) {
      if (tradesCount >= maxTradesPerDay) return "locked";
      if (maxTradesPerDay > 1 && tradesCount === maxTradesPerDay - 1) return "warning";
    }
  }

  return "allowed";
}
