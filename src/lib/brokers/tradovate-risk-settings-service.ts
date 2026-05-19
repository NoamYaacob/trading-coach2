/**
 * Phase 2C — Rule-Save Sync path.
 *
 * Syncs a user's saved daily loss rule to Tradovate Risk Settings proactively
 * when a rule is saved. This is DISTINCT from the listener-path enforcement
 * (broker-enforcement-gate.ts / broker-enforcement-service.ts), which fires at
 * breach time and requires an active InternalLockEvent.
 *
 * Key differences from the listener path:
 *   - Triggered on rule-save, not on breach detection
 *   - Does NOT require an active InternalLockEvent
 *   - DOES require account allowlist + Guardian active (gates 7–8)
 *   - DOES require all other connection and permission gates
 *
 * Safety contracts:
 *   - No import from broker-enforcement-gate.ts or broker-enforcement-service.ts
 *     (the two sync paths must stay independent)
 *   - simulateTradovateRiskSettingsSync NEVER calls TradovateClient
 *   - All live broker writes are behind BROKER_ENFORCEMENT_ENABLED + env=demo gate
 *   - ENFORCEMENT_DRY_RUN=true prevents all broker writes
 */

import type { TradovateClient } from "./tradovate-client.ts";

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Rule keys that are NOT broker-eligible. Calling this service with any of
 * these keys must throw immediately. Only "maxDailyLoss" may be synced.
 */
export const BROKER_INELIGIBLE_RULE_KEYS = [
  "dailyProfitTarget",
  "maxTradesPerDay",
  "stopAfterLosses",
  "maxContracts",
  "sessionEndHour",
  "sessionEndBehavior",
] as const;

/** Connection statuses that prevent broker writes. */
const NON_LIVE_CONNECTION_STATUSES = new Set([
  "expired",
  "connection_error",
  "not_connected",
  "pending_webhook",
  "oauth_pending_storage",
]);

// ── Safety assertion ──────────────────────────────────────────────────────────

/**
 * Throws if ruleKey is not "maxDailyLoss". Call this at the top of any function
 * that would write broker risk settings to ensure no other rule type can ever
 * reach the Tradovate API through this service.
 */
export function assertDailyLossOnly(ruleKey: string): void {
  if (ruleKey !== "maxDailyLoss") {
    throw new Error(
      `Rule '${ruleKey}' is not broker-eligible. Only maxDailyLoss can be synced to Tradovate risk settings.`,
    );
  }
}

// ── Payload builder ───────────────────────────────────────────────────────────

/**
 * Builds the payload preview for a Tradovate risk settings sync.
 *
 * Always uses Math.abs so callers may pass either a positive limit or the
 * observed negative loss amount without risk of sending a negative value to
 * Tradovate.
 *
 * SAFETY: Only accepts maxDailyLoss as a number. This function does not accept
 * a ruleKey — its type signature intentionally prevents other rules from being
 * passed; use assertDailyLossOnly before calling if you have a dynamic ruleKey.
 */
export function buildTradovateRiskSettingsPayload(
  maxDailyLoss: number,
): Record<string, unknown> {
  return {
    dailyLossAutoLiq: Math.abs(maxDailyLoss),
    changesLocked: true,
  };
}

// ── Gate evaluation ───────────────────────────────────────────────────────────

export type CanSyncInput = {
  /** BROKER_ENFORCEMENT_ENABLED === "true" (caller resolves from process.env) */
  brokerEnforcementEnabled: boolean;
  /** BrokerConnection.env — only "demo" is supported */
  env: string;
  /** ConnectedAccount.isActive */
  isActive: boolean;
  /** ConnectedAccount.missingFromBrokerSince != null */
  missingFromBroker: boolean;
  /** BrokerConnection.connectionStatus */
  connectionStatus: string | null;
  /** BrokerConnection.permissionLevel */
  permissionLevel: string | null;
  /** Whether this account is in the explicit broker-enforcement allowlist */
  accountAllowlisted: boolean;
  /** Whether Guardian is currently active for this user/account */
  guardianEnabled: boolean;
};

export type CanSyncResult = {
  allowed: boolean;
  skipReason: string | null;
  /** Machine-readable reason code for audit logging; null when allowed=true */
  gateFailureReason: string | null;
};

/**
 * Evaluates all gates that must pass before a rule-save sync broker write is
 * attempted. Returns {allowed: false, skipReason} on the first gate that fails.
 *
 * Gates (evaluated in order — first failure returns immediately):
 *   1. BROKER_ENFORCEMENT_ENABLED must be true
 *   2. env must be "demo" (live not supported yet)
 *   3. isActive must be true
 *   4. missingFromBroker must be false
 *   5. connectionStatus must NOT be in expired/error/not_connected/pending set
 *   6. permissionLevel must be "full_access"
 *   7. accountAllowlisted must be true
 *   8. guardianEnabled must be true
 *
 * Not required here (unlike the listener path):
 *   - InternalLockEvent (listener-path only — breach-time enforcement)
 *   - Dedup key check (callers handle idempotency at the DB layer)
 */
export function canSyncTradovateRiskSettings(
  input: CanSyncInput,
): CanSyncResult {
  // Gate 1: BROKER_ENFORCEMENT_ENABLED flag
  if (!input.brokerEnforcementEnabled) {
    return {
      allowed: false,
      skipReason:
        "BROKER_ENFORCEMENT_ENABLED is not true — broker writes are disabled. " +
        "Set BROKER_ENFORCEMENT_ENABLED=true to enable rule-save sync.",
      gateFailureReason: "broker_enforcement_disabled",
    };
  }

  // Gate 2: Demo-only
  if (input.env !== "demo") {
    return {
      allowed: false,
      skipReason:
        `Account env is '${input.env}' — only demo accounts are eligible for rule-save sync. ` +
        "live enforcement is not yet implemented.",
      gateFailureReason: "env_not_demo",
    };
  }

  // Gate 3: Account must be active
  if (!input.isActive) {
    return {
      allowed: false,
      skipReason:
        "Account is inactive (archived or disabled) — rule-save sync skipped.",
      gateFailureReason: "account_inactive",
    };
  }

  // Gate 4: Account must be present in broker
  if (input.missingFromBroker) {
    return {
      allowed: false,
      skipReason:
        "Account is no longer returned by Tradovate (missingFromBrokerSince is set) — rule-save sync skipped.",
      gateFailureReason: "account_missing_from_broker",
    };
  }

  // Gate 5: Connection liveness
  const connStatus = input.connectionStatus ?? "not_connected";
  if (NON_LIVE_CONNECTION_STATUSES.has(connStatus)) {
    return {
      allowed: false,
      skipReason:
        `Connection status '${connStatus}' is not live — broker write would fail. ` +
        "Reconnect the Tradovate broker connection before syncing risk settings.",
      gateFailureReason: "connection_not_live",
    };
  }

  // Gate 6: Permission level
  if (input.permissionLevel !== "full_access") {
    return {
      allowed: false,
      skipReason:
        `Permission level '${input.permissionLevel ?? "unknown"}' is insufficient. ` +
        "Account Risk Settings: Full Access is required to write userAccountAutoLiq.",
      gateFailureReason: "insufficient_permissions",
    };
  }

  // Gate 7: Account must be in the explicit allowlist
  if (!input.accountAllowlisted) {
    return {
      allowed: false,
      skipReason:
        "Account is not in the broker-enforcement allowlist — rule-save sync blocked. " +
        "Add the account to the allowlist before enabling broker writes.",
      gateFailureReason: "account_not_allowlisted",
    };
  }

  // Gate 8: Guardian must be active
  if (!input.guardianEnabled) {
    return {
      allowed: false,
      skipReason:
        "Guardian is not active for this account — rule-save sync blocked. " +
        "Guardian must be active before broker risk-settings writes are permitted.",
      gateFailureReason: "guardian_inactive",
    };
  }

  return { allowed: true, skipReason: null, gateFailureReason: null };
}

// ── Input / result types ──────────────────────────────────────────────────────

export type SyncInput = CanSyncInput & {
  /** The daily loss limit dollar amount to write (positive or negative both accepted). */
  maxDailyLoss: number;
};

export type SimulateResult =
  | {
      attempted: false;
      allowed: false;
      skipReason: string;
      payloadPreview: null;
    }
  | {
      attempted: true;
      allowed: true;
      dryRun: true;
      payloadPreview: Record<string, unknown>;
      skipReason: null;
    };

export type SyncResult =
  | {
      synced: false;
      skipReason: string;
      auditNote: string;
      /** Machine-readable reason code when a canSync gate blocked the write */
      gateFailureReason: string | null;
      payloadPreview: null;
      brokerResponse: null;
    }
  | {
      synced: false;
      skipReason: string;
      auditNote: "dry_run";
      payloadPreview: Record<string, unknown>;
      brokerResponse: null;
    }
  | {
      synced: true;
      skipReason: null;
      auditNote: "broker_write_attempted";
      payloadPreview: Record<string, unknown>;
      brokerResponse: unknown;
    };

// ── Simulate (never calls broker) ────────────────────────────────────────────

/**
 * Dry-run simulation of the risk-settings sync. Evaluates all gates and builds
 * a payload preview, but NEVER calls TradovateClient regardless of any flag or
 * environment variable.
 *
 * Use this to validate gate logic and inspect what would be sent to Tradovate
 * without risking any actual broker write.
 */
export async function simulateTradovateRiskSettingsSync(
  input: SyncInput,
): Promise<SimulateResult> {
  const gateResult = canSyncTradovateRiskSettings(input);

  if (!gateResult.allowed) {
    return {
      attempted: false,
      allowed: false,
      skipReason: gateResult.skipReason!,
      payloadPreview: null,
    };
  }

  const payloadPreview = buildTradovateRiskSettingsPayload(input.maxDailyLoss);

  return {
    attempted: true,
    allowed: true,
    dryRun: true,
    payloadPreview,
    skipReason: null,
  };
}

// ── Live sync (calls broker when all gates pass) ──────────────────────────────

/**
 * Syncs the user's daily loss rule to Tradovate Risk Settings.
 *
 * Gate evaluation order:
 *   1–6. canSyncTradovateRiskSettings gates (see above)
 *   7.   ENFORCEMENT_DRY_RUN env var (process.env.ENFORCEMENT_DRY_RUN === "true")
 *
 * If any gate fails → returns a skip result with auditNote.
 * If dry run → returns preview result with auditNote "dry_run", no broker call.
 * If all gates pass + not dry run + BROKER_ENFORCEMENT_ENABLED → calls
 *   client.applyDailyLossLock with the computed loss amount.
 */
export async function syncDailyLossRiskSettingToTradovate(
  input: SyncInput,
  client: TradovateClient,
): Promise<SyncResult> {
  const gateResult = canSyncTradovateRiskSettings(input);

  if (!gateResult.allowed) {
    return {
      synced: false,
      skipReason: gateResult.skipReason!,
      auditNote: "gate_blocked",
      gateFailureReason: gateResult.gateFailureReason,
      payloadPreview: null,
      brokerResponse: null,
    };
  }

  const payloadPreview = buildTradovateRiskSettingsPayload(input.maxDailyLoss);

  // Dry-run gate: if set, log the preview but skip the actual broker call
  if (process.env.ENFORCEMENT_DRY_RUN === "true") {
    return {
      synced: false,
      skipReason: "ENFORCEMENT_DRY_RUN=true — broker write skipped.",
      auditNote: "dry_run",
      payloadPreview,
      brokerResponse: null,
    };
  }

  // All gates passed and dry-run is not active — call the broker
  const lossAmountToSet = Math.abs(input.maxDailyLoss);
  const brokerResponse = await client.applyDailyLossLock({
    lossAmountToSet,
    changesLocked: true,
  });

  return {
    synced: true,
    skipReason: null,
    auditNote: "broker_write_attempted",
    payloadPreview,
    brokerResponse,
  };
}
