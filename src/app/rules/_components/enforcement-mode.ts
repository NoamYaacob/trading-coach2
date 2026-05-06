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
 *   dry_run                    – ENFORCEMENT_DRY_RUN=true. Guardrail simulates lockout
 *                               and position exit; no Tradovate writes are sent.
 *
 * Capability is determined by `BrokerConnection.permissionLevel`, populated by the
 * server-side permission probe (calls userAccountAutoLiq/deps which requires the
 * Account Risk Settings permission). When the probe has not yet run, the mode is
 * reported conservatively as "permission_unverified".
 */
export type AccountEnforcementMode =
  | "monitoring_only"
  | "internal_app_lock"
  | "broker_enforcement_pending"
  | "broker_enforced_active"
  | "broker_enforcement_failed"
  | "permission_unverified"
  | "dry_run";

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
  /** ENFORCEMENT_DRY_RUN env var. When true, overrides label to user-facing "Protection test mode". */
  isDryRun?: boolean;
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
  // Dry-run takes precedence over all other classification — when the server is
  // running in simulation mode, no broker writes will be sent regardless of the
  // underlying capability. Show this prominently so operators are not surprised.
  if (options.isDryRun) {
    return {
      mode: "dry_run",
      // User-facing label — internal enum value stays "dry_run".
      label: "Protection test mode",
      detail:
        "Protection test mode: changes and rule breaches are simulated. " +
        "No Tradovate write actions are sent. " +
        "Disable ENFORCEMENT_DRY_RUN on the server to engage real broker actions.",
      cls: "border-blue-200 bg-blue-50 text-blue-900",
    };
  }

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
        label: "Broker enforcement available",
        detail:
          "Tradovate connection verified with Account Risk Settings: Full Access. " +
          "If a daily loss limit or daily profit target is set and breached, Guardrail will " +
          "engage Tradovate’s risk engine — placing this account in liquidation-only mode for that session " +
          "and attempting to close any open positions. " +
          "Trade-count and loss-streak limits remain alert-only (no broker API field for those).",
        cls: "border-sky-200 bg-sky-50 text-sky-800",
      };
    }

    // Permission probe has not yet run (or returned an inconclusive result).
    // Be honest: we don't know the capability. The next sync will verify, and
    // the first enforcement attempt will reveal the actual permission state.
    return {
      mode: "permission_unverified",
      label: "Permission level not yet verified",
      detail:
        "Account data is syncing. Guardrail has not yet probed Tradovate to confirm whether broker-side enforcement is available. " +
        "Capability will be verified automatically on the next sync. " +
        "Until then, internal lock and alerts are active; broker-side actions will be attempted on first breach.",
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
