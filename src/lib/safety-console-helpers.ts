/**
 * Pure helpers for the admin Safety Console at /debug/safety-console.
 *
 * No Prisma, no fs, no env reads — all inputs come from the caller so this
 * module is fully unit-testable. The page composes these with live data.
 */

export type SafetyAlertSeverity = "critical" | "warning" | "info";

export type SafetyAlert = {
  severity: SafetyAlertSeverity;
  code: string;
  message: string;
};

export type EnforcementFlags = {
  brokerEnforcementEnabled: boolean;
  listenerLiveEnabled: boolean;
  internalLockEnabled: boolean;
  dryRunEnabled: boolean;
  simulationEnabled: boolean;
  allowlist: string[];
};

export type ActiveLockSummary = {
  accountId: string;
  env: string | null;
};

export type HistoricalBrokerEnforcement = {
  brokerLockStatus: string | null;
};

export type ListenerSnapshot = {
  connectionId: string;
  env: string | null;
  status: string | null;
  lastHeartbeatAt: string | null;
  /**
   * True when this connection is part of the active rollout scope:
   *   - not expired
   *   - has at least one active protected account, OR
   *   - has at least one account in the BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST
   *
   * Non-rollout connections (old, expired, archived, unused) still appear in the
   * console for visibility but do not contribute to overall severity.
   */
  isRolloutRelevant: boolean;
};

/**
 * Determine whether a broker connection is in scope for the current rollout.
 * Used to suppress noise from old/expired/unused connections in the console.
 */
export function isConnectionRolloutRelevant(input: {
  connectionStatus: string;
  activeProtectedAccountCount: number;
  hasAllowlistedAccount: boolean;
}): boolean {
  if (input.connectionStatus === "expired") return false;
  if (input.hasAllowlistedAccount) return true;
  if (input.activeProtectedAccountCount > 0) return true;
  return false;
}

export type SafetyAlertInput = {
  flags: EnforcementFlags;
  activeLocks: ActiveLockSummary[];
  historicalBrokerEnforcements: HistoricalBrokerEnforcement[];
  listeners: ListenerSnapshot[];
  listenerStaleThresholdMs: number;
  now: Date;
};

export function readEnforcementFlagsFromEnv(
  env: Record<string, string | undefined>,
): EnforcementFlags {
  return {
    brokerEnforcementEnabled: env.BROKER_ENFORCEMENT_ENABLED === "true",
    listenerLiveEnabled: env.TRADOVATE_LISTENER_ENABLE_LIVE === "true",
    internalLockEnabled: env.GUARDRAIL_INTERNAL_LOCK_ENABLED === "true",
    dryRunEnabled: env.ENFORCEMENT_DRY_RUN === "true",
    simulationEnabled: env.BROKER_ENFORCEMENT_SIMULATION_ENABLED === "true",
    allowlist: (env.BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

export function deriveSafetyAlerts(input: SafetyAlertInput): SafetyAlert[] {
  const alerts: SafetyAlert[] = [];

  if (input.flags.listenerLiveEnabled) {
    alerts.push({
      severity: "critical",
      code: "listener_live_enabled",
      message:
        "TRADOVATE_LISTENER_ENABLE_LIVE=true — live broker accounts can be touched.",
    });
  }

  if (input.flags.brokerEnforcementEnabled) {
    alerts.push({
      severity: "critical",
      code: "broker_enforcement_enabled",
      message: "BROKER_ENFORCEMENT_ENABLED=true — real broker writes are armed.",
    });
  }

  if (input.flags.brokerEnforcementEnabled && !input.flags.dryRunEnabled) {
    alerts.push({
      severity: "critical",
      code: "dry_run_disabled_with_enforcement",
      message:
        "ENFORCEMENT_DRY_RUN=false while BROKER_ENFORCEMENT_ENABLED=true — broker writes will execute.",
    });
  }

  if (input.activeLocks.some((l) => l.env === "live")) {
    alerts.push({
      severity: "critical",
      code: "live_candidate_env",
      message:
        "One or more broker enforcement candidates target a LIVE broker connection.",
    });
  }

  if (input.activeLocks.length > 0) {
    alerts.push({
      severity: "warning",
      code: "active_internal_lock",
      message: `${input.activeLocks.length} active internal lock(s) detected.`,
    });
  }

  if (input.activeLocks.length > 1) {
    alerts.push({
      severity: "warning",
      code: "multiple_broker_candidates",
      message: `${input.activeLocks.length} broker enforcement candidates active simultaneously.`,
    });
  }

  const perAccount = new Map<string, number>();
  for (const lock of input.activeLocks) {
    perAccount.set(lock.accountId, (perAccount.get(lock.accountId) ?? 0) + 1);
  }
  if ([...perAccount.values()].some((n) => n > 1)) {
    alerts.push({
      severity: "warning",
      code: "duplicate_active_locks",
      message: "Duplicate active internal locks detected on the same account.",
    });
  }

  if (
    input.historicalBrokerEnforcements.some(
      (h) => h.brokerLockStatus === "broker_lock_failed",
    )
  ) {
    alerts.push({
      severity: "warning",
      code: "broker_lock_failed",
      message:
        "At least one historical broker enforcement failed (broker_lock_failed).",
    });
  }

  for (const listener of input.listeners) {
    // Only rollout-relevant connections affect overall severity. Old/expired/unused
    // connections still appear in the console but their listener state is ignored.
    if (!listener.isRolloutRelevant) continue;
    if (listener.status === "error" || listener.status === "closed") {
      alerts.push({
        severity: "warning",
        code: "listener_unhealthy",
        message: `Rollout listener …${listener.connectionId.slice(-10)} status=${listener.status}`,
      });
      continue;
    }
    if (listener.status === "open" && listener.lastHeartbeatAt) {
      const hb = Date.parse(listener.lastHeartbeatAt);
      if (
        Number.isFinite(hb) &&
        input.now.getTime() - hb > input.listenerStaleThresholdMs
      ) {
        alerts.push({
          severity: "warning",
          code: "listener_stale",
          message: `Rollout listener …${listener.connectionId.slice(-10)} heartbeat is stale.`,
        });
      }
    }
  }

  return alerts;
}

export function deriveOverallSeverity(alerts: SafetyAlert[]): SafetyAlertSeverity | "safe" {
  if (alerts.some((a) => a.severity === "critical")) return "critical";
  if (alerts.some((a) => a.severity === "warning")) return "warning";
  if (alerts.length > 0) return "info";
  return "safe";
}
