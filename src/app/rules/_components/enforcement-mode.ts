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
 *   broker_enforcement_pending – Full-access Tradovate connection is verified.
 *                               Daily loss breaches apply a Tradovate risk setting
 *                               (userAccountAutoLiq) that places the account in
 *                               liquidation-only mode. Profit targets, trade count, and
 *                               consecutive-loss limits use app-level locking only.
 *
 *   broker_enforced_active    – Broker enforcement was applied and confirmed at least once
 *                               for this account (GuardianIntervention.brokerLockStatus
 *                               === "broker_locked"). Shown on status/Guardian views.
 *
 *   broker_enforcement_failed – Broker enforcement was attempted but the broker rejected
 *                               the call (e.g. 403 permission denied, network error).
 *                               Shown on status/Guardian views.
 *
 * Capability is determined by `BrokerConnection.permissionLevel`, populated by the
 * server-side permission probe (calls userAccountAutoLiq/deps which requires the
 * Account Risk Settings permission). When the probe has not yet run, the mode is
 * reported conservatively as "permission_unverified".
 *
 * Note: the server-side `ENFORCEMENT_DRY_RUN` flag is intentionally not surfaced in
 * this user-facing mode. The Trading Plan UI describes capability — what the system
 * is wired to do — not the runtime simulation flag, which is a dev/operator concern.
 */
export type AccountEnforcementMode =
  | "monitoring_only"
  | "internal_app_lock"
  | "broker_enforcement_pending"
  | "broker_enforced_active"
  | "broker_enforcement_failed"
  | "permission_unverified";

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
    /** "full_access" | "read_only" | "unknown" | null (not yet probed) */
    permissionLevel?: string | null;
  } | null;
};

export type ComputeEnforcementOptions = {
  /** True when at least one of the user's connected accounts has full_access permission.
   *  Drives the Default-template copy ("Broker risk settings available" vs "Guardrail rules"). */
  hasFullAccessAccount?: boolean;
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
  options: ComputeEnforcementOptions = {},
): EnforcementModeInfo {
  if (isDefault) {
    if (options.hasFullAccessAccount) {
      return {
        mode: "monitoring_only",
        label: "Default template",
        detail:
          "Rules are saved in Guardrail. Eligible Tradovate accounts can trigger broker risk settings on breach.",
        cls: "border-stone-200 bg-stone-50 text-stone-600",
      };
    }
    return {
      mode: "monitoring_only",
      label: "Default template",
      detail:
        "Rules are saved in Guardrail. Broker-side behavior depends on each account's permissions.",
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
  const permissionLevel = brokerConnection?.permissionLevel ?? null;

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
      label: "Unavailable — reconnect required",
      detail:
        "The broker connection for this account has expired or errored. " +
        "Reconnect to restore live rule monitoring. " +
        "No broker-side enforcement is active.",
      cls: "border-amber-200 bg-amber-50 text-amber-800",
    };
  }

  if (platform === "tradovate") {
    // Capability is decided by the probed permission level, not by the
    // legacy connectionStatus string (which conflated webhook-arrival
    // with permission-level).
    if (permissionLevel === "read_only") {
      return {
        mode: "monitoring_only",
        label: "Limited permissions — alerts only",
        detail:
          "This Tradovate connection lacks Account Risk Settings: Full Access. " +
          "Guardrail can evaluate rules and send alerts, but cannot apply broker-side risk settings or close positions. " +
          "To enable enforcement, re-authorize with full permissions in the Tradovate API key settings.",
        cls: "border-amber-200 bg-amber-50 text-amber-800",
      };
    }

    if (permissionLevel === "full_access") {
      return {
        mode: "broker_enforcement_pending",
        label: "Broker risk settings enabled",
        detail:
          "Daily loss can be protected through Tradovate broker risk settings. " +
          "Profit targets are monitored in Guardrail.",
        cls: "border-emerald-200 bg-emerald-50 text-emerald-800",
      };
    }

    // Permission probe has not yet run (or returned an inconclusive result).
    return {
      mode: "permission_unverified",
      label: "Permission level not yet verified",
      detail:
        "Account data is syncing. Guardrail has not yet confirmed whether this Tradovate connection has full broker permissions. " +
        "Capability will be verified automatically on the next sync. " +
        "Until then, Guardrail will alert only.",
      cls: "border-stone-200 bg-stone-50 text-stone-600",
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
