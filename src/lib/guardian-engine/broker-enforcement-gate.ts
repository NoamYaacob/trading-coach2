/**
 * Phase 2C-C: pure gate evaluation for listener-path broker enforcement.
 *
 * Evaluates all hard gates that must pass before a broker write is attempted.
 * This is the authoritative gate layer above applyBrokerDayLockout; the broker
 * layer has its own internal gates (shouldSkipBrokerEnforcement) as defense-in-depth.
 *
 * Safety contract:
 *   - Pure computation; no Prisma, no DB, no broker calls, no network I/O
 *   - BROKER_ENFORCEMENT_ENABLED (gate 1) short-circuits all other checks
 *   - Returns skipReason for every non-passing gate so failures are observable
 *   - trade_limit and max_loss_streak always produce a skipReason (internal-only rules)
 *
 * Gates (evaluated in order — first failure returns immediately):
 *   1. BROKER_ENFORCEMENT_ENABLED flag must be true
 *   2. TRADOVATE_LISTENER_ENABLE_LIVE must be false (live not supported in this phase)
 *   3. env must be "demo"
 *   4. Account must be in BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST
 *   5. Rule must be "daily_loss_limit" (only rule with a Tradovate API field)
 *   6. Account must be active: isActive=true and not missing from broker
 *   7. Connection status must be live (not expired / error / not_connected etc.)
 *   8. permissionLevel must be "full_access" (Account Risk Settings write requires it)
 *   9. An active InternalLockEvent must exist (precondition for broker enforcement)
 *  10. No existing GuardianIntervention with this dedup key (prevents duplicate write)
 */

import { buildListenerBrokerDedupKey } from "./broker-enforcement-dedup.ts";

/** Connection statuses that prevent broker writes. */
const NON_LIVE_CONNECTION_STATUSES = new Set([
  "expired",
  "connection_error",
  "not_connected",
  "pending_webhook",
  "oauth_pending_storage",
]);

/** Rules with a proven Tradovate API endpoint. All others are internal-only. */
const BROKER_ELIGIBLE_RULES = new Set(["daily_loss_limit"]);

export type BrokerEnforcementGateInput = {
  // ── Environment flag resolution (caller resolves from process.env) ──────────
  /** BROKER_ENFORCEMENT_ENABLED === "true" */
  brokerEnforcementEnabled: boolean;
  /** TRADOVATE_LISTENER_ENABLE_LIVE === "true" */
  listenerLiveEnabled: boolean;
  /** Parsed BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST ("id1,id2,...") */
  allowlistAccountIds: readonly string[];

  // ── Account facts ──────────────────────────────────────────────────────────
  accountId: string;
  /** BrokerConnection.env */
  env: string;
  /** ConnectedAccount.isActive */
  isActive: boolean;
  /** ConnectedAccount.missingFromBrokerSince != null */
  missingFromBroker: boolean;
  /** BrokerConnection.connectionStatus */
  connectionStatus: string | null;
  /** BrokerConnection.permissionLevel */
  permissionLevel: string | null;

  // ── Lock facts ─────────────────────────────────────────────────────────────
  /** null when no active InternalLockEvent exists for this account/rule/day */
  activeInternalLockEventId: string | null;
  ruleType: string;
  /** InternalLockEvent.observedAmount (daily loss, may be negative) */
  observedAmount: number | null;
  tradingDay: string;

  // ── Dedup state (caller checks DB) ─────────────────────────────────────────
  /** true when a GuardianIntervention with this dedup key already exists */
  existingInterventionWithDedupKey: boolean;
};

export type BrokerEnforcementGateResult = {
  allowed: boolean;
  skipReason: string | null;
  /** Idempotency key that would be written to GuardianIntervention */
  dedupKey: string;
  /** Tradovate endpoint name that would be called, or null when not allowed */
  brokerActionType: string | null;
  /**
   * Preview of the payload that would be sent. No secrets.
   * null when not allowed. The _note field confirms no request was sent.
   */
  payloadPreview: Record<string, unknown> | null;
};

export function evaluateBrokerEnforcementGates(
  input: BrokerEnforcementGateInput,
): BrokerEnforcementGateResult {
  const dedupKey = buildListenerBrokerDedupKey(
    input.accountId,
    input.ruleType,
    input.tradingDay,
  );

  const blocked = (skipReason: string): BrokerEnforcementGateResult => ({
    allowed: false,
    skipReason,
    dedupKey,
    brokerActionType: null,
    payloadPreview: null,
  });

  // Gate 1: BROKER_ENFORCEMENT_ENABLED flag
  if (!input.brokerEnforcementEnabled) {
    return blocked(
      "BROKER_ENFORCEMENT_ENABLED is not true — broker writes are disabled. " +
      "Set BROKER_ENFORCEMENT_ENABLED=true to enable (see rollout checklist in design doc).",
    );
  }

  // Gate 2: Live listener must be disabled
  if (input.listenerLiveEnabled) {
    return blocked(
      "TRADOVATE_LISTENER_ENABLE_LIVE=true — live enforcement is not supported in Phase 2C. " +
      "Demo-only enforcement requires this flag to be false.",
    );
  }

  // Gate 3: Demo-only
  if (input.env !== "demo") {
    return blocked(
      `Account env is '${input.env}' — only demo accounts are eligible. ` +
      "Live enforcement is not implemented in Phase 2C.",
    );
  }

  // Gate 4: Allowlist
  if (!input.allowlistAccountIds.includes(input.accountId)) {
    return blocked(
      `Account '${input.accountId}' is not in BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST. ` +
      "Add the account id to the allowlist env var before enabling enforcement.",
    );
  }

  // Gate 5: Rule eligibility
  if (!BROKER_ELIGIBLE_RULES.has(input.ruleType)) {
    return blocked(
      `Rule type '${input.ruleType}' has no applicable Tradovate API — internal lock only. ` +
      "Only daily_loss_limit supports broker-side enforcement in Phase 2C.",
    );
  }

  // Gate 6: Account availability
  if (!input.isActive) {
    return blocked(
      "Account is inactive (archived or disabled) — broker write skipped.",
    );
  }
  if (input.missingFromBroker) {
    return blocked(
      "Account is no longer returned by Tradovate (missingFromBrokerSince is set) — broker write skipped.",
    );
  }

  // Gate 7: Connection liveness
  const connStatus = input.connectionStatus ?? "not_connected";
  if (NON_LIVE_CONNECTION_STATUSES.has(connStatus)) {
    return blocked(
      `Connection status '${connStatus}' is not live — broker write would fail. ` +
      "Reconnect the Tradovate broker connection before attempting enforcement.",
    );
  }

  // Gate 8: Permission level
  if (input.permissionLevel !== "full_access") {
    return blocked(
      `Permission level '${input.permissionLevel ?? "unknown"}' is insufficient. ` +
      "Account Risk Settings: Full Access is required to write userAccountAutoLiq.",
    );
  }

  // Gate 9: Active InternalLockEvent must exist
  if (input.activeInternalLockEventId == null) {
    return blocked(
      "No active InternalLockEvent found for this account/rule/day. " +
      "Broker enforcement requires a preceding internal app lock (Phase 2B precondition).",
    );
  }

  // Gate 10: Idempotency — no duplicate GuardianIntervention
  if (input.existingInterventionWithDedupKey) {
    return blocked(
      `A GuardianIntervention with dedup key '${dedupKey}' already exists. ` +
      "Broker enforcement is at-most-once per account/rule/day.",
    );
  }

  // All gates passed — build the payload preview
  const lossAmountToSet =
    input.observedAmount != null && Number.isFinite(input.observedAmount)
      ? Math.max(0, Math.abs(input.observedAmount))
      : 0;

  const payloadPreview: Record<string, unknown> = {
    dailyLossAutoLiq: lossAmountToSet,
    changesLocked: true,
    // doNotUnlock intentionally omitted — would trap the account permanently
    _note: "Gate-evaluation preview — no Tradovate request sent.",
  };

  return {
    allowed: true,
    skipReason: null,
    dedupKey,
    brokerActionType: "userAccountAutoLiq/update (or /create)",
    payloadPreview,
  };
}

/**
 * Parse the BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST env var into an array.
 * Returns an empty array when the var is absent or blank.
 */
export function parseBrokerEnforcementAllowlist(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
