/**
 * Explicit enforcement mode per account scope.
 *
 * Enforcement is always scoped to a specific brokerConnectionId + tradingAccountId pair.
 * These modes reflect what Guardrail can actually do, not what it aspires to do.
 *
 *   monitoring_only           – Rules evaluated; alerts fire in-app and via Telegram.
 *                               No broker-side action is taken or possible.
 *
 *   internal_app_lock         – Guardrail sets riskState and sends Telegram alerts.
 *                               No broker connection exists, so no broker-side action.
 *
 *   broker_enforcement_pending – Broker enforcement path exists and will be attempted
 *                               when a qualifying rule is breached (e.g. daily_loss_limit
 *                               on an active full-access Tradovate connection), but has
 *                               not yet been confirmed working for this account.
 *
 *   broker_enforced_active    – Broker enforcement was applied and confirmed at least once
 *                               for this account (GuardianIntervention.brokerLockStatus
 *                               === "broker_locked"). Shown on status/Guardian views.
 *
 *   broker_enforcement_failed – Broker enforcement was attempted but the broker rejected
 *                               the call (e.g. 403 permission denied, network error).
 *                               Shown on status/Guardian views.
 *
 * Note: broker_enforced_active and broker_enforcement_failed require querying
 * GuardianIntervention records and are not computed from connection metadata alone.
 * The Rules configuration page derives only monitoring_only / internal_app_lock /
 * broker_enforcement_pending based on platform and connection status.
 */
export type AccountEnforcementMode =
  | "monitoring_only"
  | "internal_app_lock"
  | "broker_enforcement_pending"
  | "broker_enforced_active"
  | "broker_enforcement_failed";

export type EnforcementModeInfo = {
  mode: AccountEnforcementMode;
  /** Short user-facing label */
  label: string;
  /** One or two sentences explaining what Guardrail can and cannot do for this scope */
  detail: string;
  /** Tailwind border + bg + text classes for the info banner */
  cls: string;
};

type AccountArg = {
  platform: string;
  brokerConnectionId: string | null;
  brokerConnection: {
    platform: string;
    connectionStatus: string;
  } | null;
};

const EXPIRED_STATUSES = new Set(["expired", "connection_error"]);

/**
 * Derives the enforcement mode for the Rules page configuration view.
 * Scoped to a single brokerConnectionId + tradingAccountId; never user-wide.
 *
 * Does not query GuardianIntervention — broker_enforced_active and
 * broker_enforcement_failed are status-view modes resolved elsewhere.
 */
export function computeEnforcementMode(
  account: AccountArg | null,
  isDefault: boolean,
): EnforcementModeInfo {
  if (isDefault) {
    return {
      mode: "monitoring_only",
      label: "Default template · Monitoring only",
      detail:
        "Applies to accounts that do not have their own rules. " +
        "Broker actions require account-level rules and verified broker permissions.",
      cls: "border-stone-200 bg-stone-50 text-stone-600",
    };
  }

  if (!account) {
    return {
      mode: "monitoring_only",
      label: "Monitoring only",
      detail: "Select an account to see its enforcement mode.",
      cls: "border-stone-200 bg-stone-50 text-stone-600",
    };
  }

  const { brokerConnectionId, brokerConnection } = account;
  const platform = brokerConnection?.platform ?? account.platform;
  const connStatus = brokerConnection?.connectionStatus ?? "not_connected";

  // No broker connection — connect a broker to enable live rule monitoring.
  if (!brokerConnectionId || !brokerConnection) {
    return {
      mode: "monitoring_only",
      label: "No broker connected",
      detail:
        "This account has no active broker connection. Connect a broker to enable live rule monitoring and enforcement.",
      cls: "border-stone-200 bg-stone-50 text-stone-600",
    };
  }

  // Connection degraded → monitoring suspended until restored
  if (EXPIRED_STATUSES.has(connStatus)) {
    return {
      mode: "monitoring_only",
      label: "Connection required",
      detail:
        "The broker connection for this account has expired or errored. " +
        "Reconnect to restore live rule monitoring. " +
        "No broker-side enforcement is active.",
      cls: "border-amber-200 bg-amber-50 text-amber-800",
    };
  }

  if (platform === "tradovate") {
    // connected_readonly: OAuth token is read-only — account data syncs, but writes
    // (e.g. userAccountAutoLiq) will fail with 403. Enforcement is monitoring-only.
    if (connStatus === "connected_readonly") {
      return {
        mode: "monitoring_only",
        label: "Not fully protected — alerts only",
        detail:
          "This account is connected in read-only mode. " +
          "Guardrail can evaluate rules and send alerts, but cannot lock the account or apply broker-side risk settings. " +
          "To enable enforcement, re-authorize with Account Risk Settings: Full Access.",
        cls: "border-amber-200 bg-amber-50 text-amber-800",
      };
    }

    // connected_live or active pending: full-access token — enforcement will be attempted
    // for daily_loss_limit via userAccountAutoLiq. Trade-count and loss-streak rules
    // remain monitoring-only (no Tradovate API field maps to those limits).
    return {
      mode: "broker_enforcement_pending",
      label: "Partial broker enforcement",
      detail:
        "Account data is synced. If a daily loss limit is set and breached, Guardrail will " +
        "attempt to engage Tradovate’s risk engine — placing this account in " +
        "liquidation-only mode for that session. " +
        "Trade-count and loss-streak limits are alert-only: Tradovate’s API does not " +
        "expose fields to enforce those at the broker level. " +
        "“Broker-enforced” will show on the Guardian page only after a broker lock " +
        "has been applied and confirmed for this account.",
      cls: "border-sky-200 bg-sky-50 text-sky-800",
    };
  }

  // Other active platform
  return {
    mode: "monitoring_only",
    label: "Monitoring only",
    detail:
      "Rules are evaluated from synced account data. " +
      "Alerts fire in-app and via Telegram. " +
      "Broker-side blocking is not active for this platform.",
    cls: "border-stone-200 bg-stone-50 text-stone-600",
  };
}
