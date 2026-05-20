/**
 * Phase 2C-B: pure broker enforcement simulation.
 *
 * Determines what broker action *would* be attempted for a qualifying
 * InternalLockEvent, without calling Tradovate or writing any DB row.
 *
 * Safety contract:
 *   - Pure computation only; no Prisma, no DB, no broker calls, no network I/O
 *   - BROKER_ENFORCEMENT_ENABLED must remain absent/false — broker enforcement
 *     functions are not imported or called from this module
 *   - Output is audit/display only — nothing here sends a Tradovate request
 *   - Only daily_loss_limit is broker-eligible; trade_limit and
 *     max_loss_streak are always skipped with an explicit reason
 *   - Live accounts (env !== "demo") are always skipped
 */

import { buildListenerBrokerDedupKey } from "./broker-enforcement-dedup.ts";

/** Rule types that have a real Tradovate API endpoint. */
const BROKER_ELIGIBLE_RULES = new Set(["daily_loss_limit"]);

/** Connection statuses that are not live enough to support a broker write. */
const NON_LIVE_CONNECTION_STATUSES = new Set([
  "expired",
  "connection_error",
  "not_connected",
  "pending_webhook",
  "oauth_pending_storage",
]);

export type SimulationInput = {
  accountId: string;
  internalLockEventId: string;
  ruleType: string;
  env: string;
  /** Connection status from BrokerConnection.connectionStatus */
  connectionStatus: string | null;
  /** Probed permission level from BrokerConnection.permissionLevel */
  permissionLevel: string | null;
  /** Tradovate numeric account id (string form) — used for payload preview */
  externalAccountId: string | null;
  /** Daily loss observed at the time the internal lock fired (positive dollars) */
  observedAmount: number | null;
  /** YYYY-MM-DD trading day of the lock event */
  tradingDay: string;
};

export type SimulationCandidate = {
  accountId: string;
  internalLockEventId: string;
  ruleType: string;
  brokerEligible: boolean;
  /** Tradovate endpoint that would be called, or null when not eligible */
  wouldBrokerActionType: string | null;
  /** Human-readable reason why the candidate was skipped, or null when eligible */
  skipReason: string | null;
  /** Idempotency key that would guard the broker write */
  listenerBrokerDedupKey: string;
  /**
   * Preview of the payload that would be sent to Tradovate.
   * Contains no secrets (no OAuth tokens, no passwords).
   * Amounts come from the InternalLockEvent.observedAmount field.
   * null when the rule is not broker-eligible.
   */
  simulatedPayloadPreview: Record<string, unknown> | null;
  brokerActionTaken: false;
  simulationOnly: true;
};

/**
 * Evaluate whether a single InternalLockEvent qualifies for broker enforcement,
 * and if so produce the payload that would be sent.
 *
 * This is intentionally a pure function — call it once per lock event inside
 * a route handler that has already fetched all the required account fields.
 */
export function simulateBrokerEnforcement(input: SimulationInput): SimulationCandidate {
  const dedupKey = buildListenerBrokerDedupKey(
    input.accountId,
    input.ruleType,
    input.tradingDay,
  );

  const base = {
    accountId: input.accountId,
    internalLockEventId: input.internalLockEventId,
    ruleType: input.ruleType,
    listenerBrokerDedupKey: dedupKey,
    brokerActionTaken: false as const,
    simulationOnly: true as const,
  };

  // Gate 1: only demo accounts — live is always skipped
  if (input.env !== "demo") {
    return {
      ...base,
      brokerEligible: false,
      wouldBrokerActionType: null,
      skipReason: "Account is not demo — live enforcement requires a separate design review and explicit authorization.",
      simulatedPayloadPreview: null,
    };
  }

  // Gate 2: rule must be broker-eligible
  if (!BROKER_ELIGIBLE_RULES.has(input.ruleType)) {
    return {
      ...base,
      brokerEligible: false,
      wouldBrokerActionType: null,
      skipReason: `Rule type '${input.ruleType}' has no applicable Tradovate API — internal lock only.`,
      simulatedPayloadPreview: null,
    };
  }

  // Gate 3: connection must be live
  const connStatus = input.connectionStatus ?? "not_connected";
  if (NON_LIVE_CONNECTION_STATUSES.has(connStatus)) {
    return {
      ...base,
      brokerEligible: false,
      wouldBrokerActionType: null,
      skipReason: `Connection status '${connStatus}' is not live — broker write would be blocked.`,
      simulatedPayloadPreview: null,
    };
  }

  // Gate 4: full_access permission required for Account Risk Settings writes
  if (input.permissionLevel !== "full_access") {
    return {
      ...base,
      brokerEligible: false,
      wouldBrokerActionType: null,
      skipReason: `Permission level '${input.permissionLevel ?? "unknown"}' is insufficient — Account Risk Settings: Full Access required.`,
      simulatedPayloadPreview: null,
    };
  }

  // All gates passed — this lock qualifies for broker enforcement.
  // Build the payload preview (no secrets, no live broker IDs that could be used directly).
  const tvAccountId =
    input.externalAccountId != null ? parseInt(input.externalAccountId, 10) : null;
  const lossAmountToSet = input.observedAmount != null && Number.isFinite(input.observedAmount)
    ? Math.max(0, Math.abs(input.observedAmount))
    : 0;

  const simulatedPayloadPreview: Record<string, unknown> = {
    // tvAccountId is the numeric Tradovate account id — not a secret
    accountId: tvAccountId,
    dailyLossAutoLiq: lossAmountToSet,
    changesLocked: true,
    // doNotUnlock intentionally omitted — would trap the account permanently
    _note: "Simulation preview only — no Tradovate request was sent.",
  };

  return {
    ...base,
    brokerEligible: true,
    wouldBrokerActionType: "userAccountAutoLiq/update (or /create)",
    skipReason: null,
    simulatedPayloadPreview,
  };
}
