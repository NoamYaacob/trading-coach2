/**
 * Phase 2C-C: listener-path broker enforcement service.
 *
 * `maybeAttemptBrokerDailyLossLockoutForInternalLock` fetches all DB state
 * needed by the gate helper, evaluates all 10 gates, and — only when
 * gateResult.allowed === true — calls triggerEnforcement to attempt the
 * actual broker write and record a GuardianIntervention audit row.
 *
 * Safety contract:
 *   - Never called from the listener worker until explicitly wired in.
 *   - Gate evaluation short-circuits before any broker call when any gate fails.
 *   - triggerEnforcement handles its own error handling and audit recording.
 *   - No position exit. No order cancellation. No order placement.
 *   - Only demo accounts, daily_loss_limit rule, full_access permission.
 */

import { prisma } from "../db";
import { triggerEnforcement } from "../brokers/enforcement";
import {
  evaluateBrokerEnforcementGates,
  parseBrokerEnforcementAllowlist,
} from "./broker-enforcement-gate";
import { buildListenerBrokerDedupKey } from "./broker-enforcement-dedup";
import { isGuardianRuleEvaluationActive } from "./guardian-master-switch";
import { writeBrokerRiskSettingsSyncAudit } from "../brokers/broker-risk-settings-sync-audit-writer";

export type BrokerEnforcementServiceResult = {
  attempted: boolean;
  allowed: boolean;
  skipReason: string | null;
  dedupKey: string;
};

/**
 * Evaluate all broker enforcement gates for a given InternalLockEvent, then
 * call triggerEnforcement only if all gates pass.
 *
 * Returns a structured result indicating whether enforcement was attempted and
 * why it was skipped (if applicable). The caller must log this result.
 */
export async function maybeAttemptBrokerDailyLossLockoutForInternalLock(
  internalLockEventId: string,
): Promise<BrokerEnforcementServiceResult> {
  // ── Resolve env vars ────────────────────────────────────────────────────────
  const brokerEnforcementEnabled = process.env.BROKER_ENFORCEMENT_ENABLED === "true";
  const listenerLiveEnabled = process.env.TRADOVATE_LISTENER_ENABLE_LIVE === "true";
  const allowlistAccountIds = parseBrokerEnforcementAllowlist(
    process.env.BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST,
  );

  // ── Load InternalLockEvent with account context ─────────────────────────────
  const lockEvent = await prisma.internalLockEvent.findUnique({
    where: { id: internalLockEventId },
    select: {
      id: true,
      accountId: true,
      userId: true,
      ruleType: true,
      tradingDay: true,
      observedAmount: true,
      clearedAt: true,
      account: {
        select: {
          isActive: true,
          missingFromBrokerSince: true,
          externalAccountId: true,
          brokerConnectionId: true,
          brokerConnection: {
            select: {
              env: true,
              connectionStatus: true,
              permissionLevel: true,
            },
          },
          user: {
            select: { guardianProfile: { select: { guardianEnabled: true } } },
          },
        },
      },
    },
  });

  if (lockEvent == null) {
    return {
      attempted: false,
      allowed: false,
      skipReason: `InternalLockEvent '${internalLockEventId}' not found`,
      dedupKey: "",
    };
  }

  // Build the shared audit base. Used by every blocked-exit branch below so
  // listener-path gate failures are persisted to BrokerRiskSettingsSyncAudit
  // (same table the rule-save path uses — outcomes are filterable by
  // outcome=gate_blocked and gateFailureReason).
  const auditBase = {
    userId: lockEvent.userId,
    accountId: lockEvent.accountId,
    externalAccountId: lockEvent.account.externalAccountId ?? null,
    brokerConnectionId: lockEvent.account.brokerConnectionId ?? null,
    broker: "tradovate" as const,
    ruleType: "daily_loss_limit" as const,
    environment: lockEvent.account.brokerConnection?.env ?? null,
    dryRun: process.env.ENFORCEMENT_DRY_RUN === "true",
    brokerEnforcementEnabled,
  };

  // An already-cleared lock event is stale — do not enforce
  if (lockEvent.clearedAt != null) {
    const skipReason = `InternalLockEvent '${internalLockEventId}' is already cleared (clearedAt is set)`;
    await writeBrokerRiskSettingsSyncAudit({
      ...auditBase,
      outcome: "gate_blocked",
      gateFailureReason: "internal_lock_event_cleared",
      skipReason,
    });
    return {
      attempted: false,
      allowed: false,
      skipReason,
      dedupKey: buildListenerBrokerDedupKey(lockEvent.accountId, lockEvent.ruleType, lockEvent.tradingDay),
    };
  }

  const account = lockEvent.account;
  const conn = account.brokerConnection;

  const dedupKey = buildListenerBrokerDedupKey(
    lockEvent.accountId,
    lockEvent.ruleType,
    lockEvent.tradingDay,
  );

  // ── Guardian master switch — defense in depth ───────────────────────────────
  // The internal lock evaluator already skips guardian-off accounts (so this
  // function is normally never reached for them), but Guardian could be turned
  // off after a lock was created. No broker enforcement may be attempted while
  // Guardian is off for the account owner.
  if (!isGuardianRuleEvaluationActive(account.user?.guardianProfile ?? null)) {
    const skipReason = "Guardian disabled for the account owner (master switch off)";
    await writeBrokerRiskSettingsSyncAudit({
      ...auditBase,
      outcome: "gate_blocked",
      gateFailureReason: "guardian_disabled",
      skipReason,
    });
    return {
      attempted: false,
      allowed: false,
      skipReason,
      dedupKey,
    };
  }

  // ── Dedup check — has a GuardianIntervention with this key already been written? ──
  const existingIntervention = await prisma.guardianIntervention.findUnique({
    where: { listenerBrokerDedupKey: dedupKey },
    select: { id: true },
  });

  // ── Evaluate all 10 gates ───────────────────────────────────────────────────
  const gateResult = evaluateBrokerEnforcementGates({
    brokerEnforcementEnabled,
    listenerLiveEnabled,
    allowlistAccountIds,
    accountId: lockEvent.accountId,
    env: conn?.env ?? "live",
    isActive: account.isActive,
    missingFromBroker: account.missingFromBrokerSince != null,
    connectionStatus: conn?.connectionStatus ?? null,
    permissionLevel: conn?.permissionLevel ?? null,
    activeInternalLockEventId: lockEvent.id,
    ruleType: lockEvent.ruleType,
    observedAmount: lockEvent.observedAmount != null ? Number(lockEvent.observedAmount) : null,
    tradingDay: lockEvent.tradingDay,
    existingInterventionWithDedupKey: existingIntervention != null,
  });

  if (!gateResult.allowed) {
    await writeBrokerRiskSettingsSyncAudit({
      ...auditBase,
      outcome: "gate_blocked",
      gateFailureReason: gateResult.gateFailureReason,
      skipReason: gateResult.skipReason,
    });
    return {
      attempted: false,
      allowed: false,
      skipReason: gateResult.skipReason,
      dedupKey,
    };
  }

  // ── All gates passed — attempt broker enforcement ───────────────────────────
  const lossAmount =
    lockEvent.observedAmount != null && Number.isFinite(Number(lockEvent.observedAmount))
      ? Math.max(0, Math.abs(Number(lockEvent.observedAmount)))
      : 0;

  await triggerEnforcement({
    accountId: lockEvent.accountId,
    userId: lockEvent.userId,
    trigger: "daily_loss_limit",
    reason: `Listener-path broker enforcement: daily loss ${lossAmount} observed on ${lockEvent.tradingDay} (InternalLockEvent ${internalLockEventId})`,
    currentDailyLoss: lossAmount,
    internalLockEventId: lockEvent.id,
    listenerBrokerDedupKey: dedupKey,
    tradingDay: lockEvent.tradingDay,
    // Phase 2C-C first-activation contract: risk-setting write only, no
    // position-close action. See applyBrokerDayLockout for the mode switch.
    brokerEnforcementMode: "lock_only",
  });

  return {
    attempted: true,
    allowed: true,
    skipReason: null,
    dedupKey,
  };
}
