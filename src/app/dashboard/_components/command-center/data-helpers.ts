import type { AccountStatus } from "./types";
import type { BrokerLockStatus, FlattenStatus } from "@/lib/brokers/enforcement-helpers";

/**
 * What the dashboard's TradesCell should render for a given account.
 *
 *  - "verified": show numeric "X / max" with the usual progress bar — the
 *    count came from an account-scoped broker source we trust.
 *  - "estimated": show the literal string "Estimated" with no numeric ratio
 *    and no progress bar — the count was derived from fills that may include
 *    other accounts on the same multi-account OAuth token. Showing "12 / 3"
 *    in this case is misleading because the 12 isn't actually this account's.
 *  - "unavailable": show "Unavailable" — fills couldn't be fetched.
 *  - "no_data": show an em-dash — no count and no rule limit configured.
 */
export type TradeCountDisplay =
  | { kind: "no_data" }
  | { kind: "unavailable"; showHint: boolean }
  | { kind: "estimated" }
  | { kind: "verified"; used: number; max: number | null; pct: number };

export function getTradeCountDisplay(account: {
  platform: string;
  fillsSyncedAt: Date | null;
  lastSyncAt: Date | null;
  tradeCountSource: "verified" | "estimated" | "unavailable";
  tradesCount: number | null;
  maxTradesPerDay: number | null;
  tradesUsedPct: number | null;
}): TradeCountDisplay {
  // Broker account synced but fills never successfully fetched — count is unknown.
  const fillsFailed =
    account.platform !== "manual" &&
    account.fillsSyncedAt == null &&
    account.lastSyncAt != null;
  if (fillsFailed || account.tradeCountSource === "unavailable") {
    return { kind: "unavailable", showHint: account.platform !== "manual" };
  }

  if (account.tradeCountSource === "estimated") {
    return { kind: "estimated" };
  }

  if (account.maxTradesPerDay == null && account.tradesCount == null) {
    return { kind: "no_data" };
  }

  return {
    kind: "verified",
    used: account.tradesCount ?? 0,
    max: account.maxTradesPerDay,
    pct: account.tradesUsedPct ?? 0,
  };
}


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
  /** When set, the broker's /account/list no longer returns this account
   *  (reset, closed, or removed by the prop firm). Wins over every other
   *  status — we cannot trust any cached balance/P&L/rules for it. */
  missingFromBrokerSince?: Date | null;
}): AccountStatus {
  if (!input.isActive) return "not_connected";

  // Broker no longer returns this account — stale data, do not enforce.
  if (input.missingFromBrokerSince != null) return "unavailable";

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

// ── Broker enforcement note ───────────────────────────────────────────────────

/**
 * Visual kind drives the text colour in BrokerEnforcementNote:
 *   broker_active       → emerald  (Tradovate confirmed the lock)
 *   unavailable_permission → amber (permission gap — actionable)
 *   failed              → amber    (transient error — actionable)
 *   unavailable_readonly → stone   (read-only is expected — not an error)
 *   internal_only       → stone    (no broker API for this trigger)
 *   dry_run             → blue     (ENFORCEMENT_DRY_RUN=true; QA simulation)
 */
export type BrokerEnforcementKind =
  | "broker_active"
  | "unavailable_readonly"
  | "unavailable_permission"
  | "failed"
  | "internal_only"
  | "dry_run";

export type BrokerEnforcementCopy = {
  text: string;
  kind: BrokerEnforcementKind;
};

/**
 * Pure function: derive the enforcement note text and colour kind for a locked
 * account row. Only called when account.status === "locked".
 *
 * Design invariants:
 *  - "Broker-side lock active" appears ONLY when broker confirmed (broker_locked).
 *  - "Guardrail lock active" appears for every non-broker-confirmed state so the
 *    UI always distinguishes internal-only from broker-confirmed enforcement.
 *  - The read-only and permission cases carry distinct copy so operators know
 *    which action (re-authorize with full scope) resolves the gap.
 */
export function deriveBrokerEnforcementCopy(
  brokerLockStatus: BrokerLockStatus | null,
): BrokerEnforcementCopy {
  switch (brokerLockStatus) {
    case "dry_run":
      return {
        text: "Dry run · Position exit and broker-side lockout were simulated. No Tradovate write was sent.",
        kind: "dry_run",
      };
    case "broker_locked":
      return {
        text: "Broker-side lock active · Tradovate risk settings applied.",
        kind: "broker_active",
      };
    case "unavailable_read_only":
      return {
        text: "Guardrail lock active · Broker-side lock unavailable: connection is read-only.",
        kind: "unavailable_readonly",
      };
    case "unavailable_permission":
      return {
        text: "Guardrail lock active · Broker-side lock unavailable: Account Risk Settings permission missing.",
        kind: "unavailable_permission",
      };
    case "broker_lock_failed":
      return {
        text: "Guardrail lock active · Broker-side lock attempt failed.",
        kind: "failed",
      };
    case "monitoring_only":
      return {
        text: "Guardrail lock active · Broker-side blocking not applicable for this trigger.",
        kind: "internal_only",
      };
    default:
      // null, not_requested, pending, or any future value — safe fallback.
      return {
        text: "Guardrail lock active · No broker-side lock recorded.",
        kind: "internal_only",
      };
  }
}

// ── Flatten enforcement note ──────────────────────────────────────────────────

export type FlattenCopy = {
  text: string;
  /** same visual kind as BrokerEnforcementKind for consistent colouring */
  kind: BrokerEnforcementKind;
};

/**
 * Pure function: derive the position-exit note text and colour kind for the
 * intervention display. Separate from deriveBrokerEnforcementCopy so each
 * part of the enforcement can be presented independently.
 */
export function deriveFlattenCopy(flattenStatus: FlattenStatus | null): FlattenCopy {
  switch (flattenStatus) {
    case "flattened":
      return { text: "Position exit confirmed.", kind: "broker_active" };
    case "not_needed":
      return { text: "No open position found.", kind: "internal_only" };
    case "attempted":
      return { text: "Position exit sent — confirmation pending.", kind: "failed" };
    case "unavailable_read_only":
      return {
        text: "Position exit unavailable: read-only connection.",
        kind: "unavailable_readonly",
      };
    case "unavailable_permission":
      return {
        text: "Position exit unavailable: missing permission.",
        kind: "unavailable_permission",
      };
    case "failed":
      return { text: "Position exit failed.", kind: "failed" };
    case "dry_run":
      return {
        text: "Dry run · Position exit simulated.",
        kind: "dry_run",
      };
    default:
      return { text: "Position exit not recorded.", kind: "internal_only" };
  }
}
