import type { AccountKind, AccountStatus, EnforcementMode } from "./types";
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
        text: "Test mode · Position exit and broker-side lockout were simulated. No Tradovate write was sent.",
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
        text: "Test mode · Position exit simulated.",
        kind: "dry_run",
      };
    default:
      return { text: "Position exit not recorded.", kind: "internal_only" };
  }
}

// ── Connection status label ───────────────────────────────────────────────────

/** Public-facing labels for BrokerConnection.connectionStatus. Raw enum values
 *  (e.g. "connected_readonly") are intentionally never exposed — the
 *  enforcement chip carries the capability nuance. */
const CONNECTION_STATUS_LABEL_MAP: Record<string, string> = {
  connected_live: "Connected",
  connected_readonly: "Connected",
  pending_webhook: "Awaiting first event",
  oauth_pending_storage: "OAuth pending",
  not_connected: "Not connected",
  connection_error: "Connection error",
  expired: "Expired — re-authorize",
};

export function deriveConnectionStatusLabel(rawStatus: string): string {
  return CONNECTION_STATUS_LABEL_MAP[rawStatus] ?? "Connection status unknown";
}

// ── Dry-run banner copy ───────────────────────────────────────────────────────

/** User-facing primary phrase: "Protection test mode". The internal enum value
 *  remains "dry_run" and the env var remains ENFORCEMENT_DRY_RUN — the rename
 *  only applies to copy that the user reads. */
export const DRY_RUN_BANNER_COPY =
  "Protection test mode: Guardrail is watching your accounts, but it will not block or close trades until live enforcement is enabled.";

// ── shouldShowEnforcementChip ─────────────────────────────────────────────────

/** When the mode is "dry_run" the per-account chip is suppressed — the
 *  top-level banner already communicates dry-run, so repeating the badge in
 *  every group header and row is visual noise. */
export function shouldShowEnforcementChip(mode: EnforcementMode): boolean {
  return mode !== "dry_run";
}

// ── deriveRowStatusLabel ──────────────────────────────────────────────────────

/** Visible badge label for an account row on the Dashboard.
 *
 * Refines the raw AccountStatus (which is a model concept) into a copy that
 * a non-technical trader recognises:
 *
 *   TRADABLE        — active, no broker capability gap, no consent gap
 *   ACTION REQUIRED — allowed but consent is missing OR broker permissions
 *                     are limited (read-only). Guides the user to the fix.
 *   WARNING         — approaching daily loss / trade limit
 *   LOCKED          — Guardrail STOPPED for the rest of the session
 *   UNAVAILABLE     — broker no longer returns this account
 *   NOT CONNECTED   — connection expired/error/never connected
 *   NEEDS RULES / PENDING / FIRM RULES MISSING — setup states
 */
export type RowStatusLabel =
  | "Tradable"
  | "Action required"
  | "Warning"
  | "Locked"
  | "Unavailable"
  | "Not connected"
  | "Needs rules"
  | "Pending"
  | "Firm rules missing";

export function deriveRowStatusLabel(input: {
  status: AccountStatus;
  setupNeededReason: "no_rules" | "pending_connection" | "prop_firm_rules_missing" | null;
  enforcementMode: EnforcementMode;
  requiresAutomatedActionsConsent: boolean;
}): RowStatusLabel {
  if (input.status === "unavailable") return "Unavailable";
  if (input.status === "locked") return "Locked";
  if (input.status === "warning") return "Warning";
  if (input.status === "not_connected") return "Not connected";
  if (input.status === "setup_needed") {
    if (input.setupNeededReason === "pending_connection") return "Pending";
    if (input.setupNeededReason === "prop_firm_rules_missing") return "Firm rules missing";
    return "Needs rules";
  }
  // status === "allowed" → refine based on consent + permission gaps.
  if (input.requiresAutomatedActionsConsent) return "Action required";
  if (input.enforcementMode === "broker_readonly") return "Action required";
  return "Tradable";
}

// ── derivePerAccountStateLabel ────────────────────────────────────────────────

/** Small state label rendered in the Rules / Mode column under the plan name.
 *  Priority is most-actionable first so the user sees the thing that needs
 *  attention before the positive/neutral states. */
export type PerAccountStateLabel =
  | "Test mode only"
  | "Consent required"
  | "Broker enforcement ready"
  | "Limited permissions"
  | "Monitoring only";

export function derivePerAccountStateLabel(input: {
  enforcementMode: EnforcementMode;
  requiresAutomatedActionsConsent: boolean;
}): PerAccountStateLabel {
  if (input.enforcementMode === "dry_run") return "Test mode only";
  if (input.requiresAutomatedActionsConsent) return "Consent required";
  if (input.enforcementMode === "broker_active") return "Broker enforcement ready";
  if (input.enforcementMode === "broker_readonly") return "Limited permissions";
  return "Monitoring only";
}

// ── deriveGroupStateSuffix ────────────────────────────────────────────────────

/** Short suffix appended to "Connected" in a firm-group header so the user
 *  can see at a glance whether anything across the group needs attention.
 *  Returns null when there's no useful state to highlight — the platform line
 *  then shows just "Connected · Synced 2m ago". */
export type GroupStateSuffix =
  | "Test mode"
  | "Consent required"
  | "Limited permissions"
  | "Broker enforcement ready"
  | null;

export function deriveGroupStateSuffix(input: {
  accounts: ReadonlyArray<{
    enforcementMode: EnforcementMode;
    requiresAutomatedActionsConsent: boolean;
  }>;
}): GroupStateSuffix {
  if (input.accounts.length === 0) return null;
  if (input.accounts.some((a) => a.enforcementMode === "dry_run")) return "Test mode";
  if (input.accounts.some((a) => a.requiresAutomatedActionsConsent)) {
    return "Consent required";
  }
  if (input.accounts.some((a) => a.enforcementMode === "broker_readonly")) {
    return "Limited permissions";
  }
  if (input.accounts.every((a) => a.enforcementMode === "broker_active")) {
    return "Broker enforcement ready";
  }
  return null;
}

// ── deriveFooterCopy ──────────────────────────────────────────────────────────

/** The single line of disclosure text shown at the very bottom of the command
 *  center. Returns null when there is nothing actionable to say (e.g. a top-
 *  level dry-run banner is already shown — we don't repeat ourselves). */
export function deriveFooterCopy(input: {
  modes: ReadonlyArray<EnforcementMode>;
  /** When the dry-run banner is shown at the top, the footer suppresses any
   *  dry-run-related copy so the user sees the message exactly once. */
  hasDryRunBanner: boolean;
}): string | null {
  const { modes, hasDryRunBanner } = input;
  if (modes.length === 0) return null;

  const anyDryRun = modes.includes("dry_run");
  if (anyDryRun && hasDryRunBanner) {
    // Banner says it; footer stays silent to avoid repetition.
    return null;
  }
  if (anyDryRun) {
    return "Test mode active · No broker lockout or position-close actions are sent.";
  }
  if (modes.includes("broker_active")) {
    return "Broker enforcement available where permissions support it.";
  }
  if (modes.includes("broker_readonly") || modes.includes("permission_unverified")) {
    return "Some accounts have limited permissions and require reconnect for broker-side actions.";
  }
  return null;
}

// ── Estimated trade-count copy ────────────────────────────────────────────────

/** Long-form copy for the Estimated trade-count disclosure. Used as a
 *  tooltip / aria-label so the full explanation is reachable but does not
 *  bloat the row. The wording is product-critical: it explicitly states
 *  the count will not trigger lockout. */
export const ESTIMATED_TRADE_COUNT_HINT =
  "Guardrail will not use estimated trade count to lock the account unless it is verified.";

/** Short-form copy displayed inline in the table cell. Pairs with
 *  ESTIMATED_TRADE_COUNT_HINT (full text in the tooltip). */
export const ESTIMATED_TRADE_COUNT_SHORT = "Not used for lockout";

// ── deriveAccountKind ──────────────────────────────────────────────────────────

/** Map raw accountType to the Dashboard summary "kind" bucket.
 *  funded + personal → "live"; everything else (evaluation, demo, unknown) → "practice".
 *  This intentionally collapses sub-types so the user sees a clear two-way split
 *  rather than four columns. */
export function deriveAccountKind(accountType: string): AccountKind {
  if (accountType === "funded" || accountType === "personal") return "live";
  return "practice";
}

// ── deriveStaleSyncWarning ─────────────────────────────────────────────────────

export type StaleSyncWarning = {
  isStale: boolean;
  /** Minutes since the oldest account's last sync. null when no sync has happened. */
  minutesSinceOldestSync: number | null;
};

/** Returns whether the dashboard should show a "Data may be stale" warning.
 *  Stale when the oldest active broker account hasn't synced within `freshnessMs`.
 *  When `oldestSyncAt` is null (nothing has ever synced) we treat it as stale only
 *  if there is at least one broker account expected to sync. The caller passes
 *  `hasBrokerAccounts` to make that decision explicit. */
export function deriveStaleSyncWarning(input: {
  oldestSyncAt: Date | null;
  hasBrokerAccounts: boolean;
  freshnessMs: number;
  now?: Date;
}): StaleSyncWarning {
  const now = input.now ?? new Date();
  if (!input.hasBrokerAccounts) {
    return { isStale: false, minutesSinceOldestSync: null };
  }
  if (input.oldestSyncAt == null) {
    return { isStale: true, minutesSinceOldestSync: null };
  }
  const diffMs = now.getTime() - input.oldestSyncAt.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  return { isStale: diffMs > input.freshnessMs, minutesSinceOldestSync: minutes };
}

// ── deriveProtectionStatusPanel ───────────────────────────────────────────────

export type ProtectionStatusPanelData = {
  kind: "dry_run" | "consent_required" | "protection_locked";
  /** Whether to show the "Review Trading Plan" CTA (consent action is pending). */
  showConsentCta: boolean;
};

/**
 * Derives the single compact "Protection status" panel for the command center.
 * Replaces three separate banners (dry-run / consent-required / protection-locked)
 * with one panel; priority is most-actionable first: test mode → consent → locked.
 */
export function deriveProtectionStatusPanel(input: {
  isDryRunActive: boolean;
  requiresConsentCount: number;
  isProtectionLocked: boolean;
}): ProtectionStatusPanelData | null {
  const { isDryRunActive, requiresConsentCount, isProtectionLocked } = input;
  if (!isDryRunActive && requiresConsentCount === 0 && !isProtectionLocked) return null;
  const kind: ProtectionStatusPanelData["kind"] = isDryRunActive
    ? "dry_run"
    : requiresConsentCount > 0
    ? "consent_required"
    : "protection_locked";
  return { kind, showConsentCta: requiresConsentCount > 0 };
}

// ── deriveEnforcementMode ──────────────────────────────────────────────────────

export function deriveEnforcementMode(input: {
  platform: string;
  connectionStatus: string;
  isActive: boolean;
  permissionLevel: string | null | undefined;
  isDryRun: boolean;
}): EnforcementMode {
  if (!input.isActive) return "not_connected";
  if (
    input.connectionStatus === "connected_live" ||
    input.connectionStatus === "connected_readonly"
  ) {
    if (input.isDryRun) return "dry_run";
    if (input.permissionLevel === "full_access") return "broker_active";
    if (input.permissionLevel === "read_only") return "broker_readonly";
    return "permission_unverified";
  }
  return "not_connected";
}
