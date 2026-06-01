/**
 * Phase 2C-C: listener-path broker enforcement service.
 *
 * `maybeAttemptBrokerDailyLossLockoutForInternalLock` fetches all DB state
 * needed by the gate helper, evaluates all 10 gates, and — only when
 * gateResult.allowed === true — calls triggerEnforcement to attempt the
 * actual broker write and record a GuardianIntervention audit row.
 *
 * `attemptRealBrokerEnforcementAfterDryRun` is the C7B controlled same-day
 * real-enforcement path. It is identical to the above except gate 10 (dedup)
 * is replaced with a stricter tri-state check: it requires an existing
 * GuardianIntervention with brokerLockStatus=dry_run (proves C6 ran),
 * blocks if brokerLockStatus=broker_locked (real enforcement already done),
 * and blocks if no prior dry_run exists (use the standard path instead).
 * triggerEnforcement is called WITHOUT listenerBrokerDedupKey so the new
 * real-enforcement intervention does not collide with the dry-run row's
 * unique constraint — the script's own broker_locked precondition check
 * provides at-most-once semantics for real enforcement.
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

/** Extended result type for the C7B dry-run→real transition path. */
export type BrokerEnforcementOnceRealResult = BrokerEnforcementServiceResult & {
  /** The dry-run GuardianIntervention that preceded this real attempt. */
  priorDryRunInterventionId: string | null;
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

/**
 * C7B controlled same-day real enforcement: attempt a real broker write for an
 * InternalLockEvent that was previously exercised via a dry-run only.
 *
 * Gate 10 (dedup) is replaced with a tri-state check:
 *   - No existing intervention        → blocked (use the standard path first)
 *   - brokerLockStatus = "broker_locked" → blocked (real enforcement already done)
 *   - brokerLockStatus = "dry_run"    → allowed (this is the exact transition we want)
 *   - any other brokerLockStatus      → blocked (unexpected state, investigate)
 *
 * triggerEnforcement is called WITHOUT listenerBrokerDedupKey to avoid the
 * unique-constraint conflict with the existing dry-run row. The at-most-once
 * guarantee for real enforcement comes from the broker_locked pre-check above.
 *
 * All other gates (1–9) are evaluated identically to the standard path.
 * Called only from scripts/trigger-c7b-real-broker-enforcement-current-lock.ts.
 */
export async function attemptRealBrokerEnforcementAfterDryRun(
  internalLockEventId: string,
): Promise<BrokerEnforcementOnceRealResult> {
  // ── Resolve env vars ────────────────────────────────────────────────────────
  const brokerEnforcementEnabled = process.env.BROKER_ENFORCEMENT_ENABLED === "true";
  const listenerLiveEnabled = process.env.TRADOVATE_LISTENER_ENABLE_LIVE === "true";
  const allowlistAccountIds = parseBrokerEnforcementAllowlist(
    process.env.BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST,
  );

  // ── Load InternalLockEvent with account context (identical to standard path) ─
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
      priorDryRunInterventionId: null,
    };
  }

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
      priorDryRunInterventionId: null,
    };
  }

  const account = lockEvent.account;
  const conn = account.brokerConnection;

  const dedupKey = buildListenerBrokerDedupKey(
    lockEvent.accountId,
    lockEvent.ruleType,
    lockEvent.tradingDay,
  );

  // ── Guardian master switch ──────────────────────────────────────────────────
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
      priorDryRunInterventionId: null,
    };
  }

  // ── Tri-state dedup check (replaces binary gate 10) ────────────────────────
  // Standard gate 10: any existing intervention → blocked.
  // C7B gate 10: only dry_run → allowed; broker_locked or none → blocked.
  const existingIntervention = await prisma.guardianIntervention.findUnique({
    where: { listenerBrokerDedupKey: dedupKey },
    select: { id: true, brokerLockStatus: true },
  });

  if (existingIntervention == null) {
    const skipReason =
      `No prior GuardianIntervention for dedup key '${dedupKey}'. ` +
      "Use maybeAttemptBrokerDailyLossLockoutForInternalLock for first-time enforcement.";
    await writeBrokerRiskSettingsSyncAudit({
      ...auditBase,
      outcome: "gate_blocked",
      gateFailureReason: "no_prior_dry_run_intervention",
      skipReason,
    });
    return { attempted: false, allowed: false, skipReason, dedupKey, priorDryRunInterventionId: null };
  }

  if (existingIntervention.brokerLockStatus === "broker_locked") {
    const skipReason =
      `GuardianIntervention '${existingIntervention.id}' already has brokerLockStatus=broker_locked — ` +
      "real broker enforcement was already recorded for this lock/day.";
    await writeBrokerRiskSettingsSyncAudit({
      ...auditBase,
      outcome: "gate_blocked",
      gateFailureReason: "real_enforcement_already_recorded",
      skipReason,
    });
    return { attempted: false, allowed: false, skipReason, dedupKey, priorDryRunInterventionId: null };
  }

  if (existingIntervention.brokerLockStatus !== "dry_run") {
    const skipReason =
      `GuardianIntervention '${existingIntervention.id}' has unexpected brokerLockStatus=` +
      `'${existingIntervention.brokerLockStatus ?? "(null)"}' (expected 'dry_run'). ` +
      "Investigate before attempting real enforcement.";
    await writeBrokerRiskSettingsSyncAudit({
      ...auditBase,
      outcome: "gate_blocked",
      gateFailureReason: "unexpected_prior_lock_status",
      skipReason,
    });
    return { attempted: false, allowed: false, skipReason, dedupKey, priorDryRunInterventionId: null };
  }

  const priorDryRunInterventionId = existingIntervention.id;

  // ── Evaluate gates 1–9 (existingInterventionWithDedupKey=false bypasses gate 10) ──
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
    // Gate 10 intentionally skipped: prior dry_run intervention verified above.
    existingInterventionWithDedupKey: false,
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
      priorDryRunInterventionId,
    };
  }

  // ── All gates passed — attempt real broker enforcement ──────────────────────
  const lossAmount =
    lockEvent.observedAmount != null && Number.isFinite(Number(lockEvent.observedAmount))
      ? Math.max(0, Math.abs(Number(lockEvent.observedAmount)))
      : 0;

  await triggerEnforcement({
    accountId: lockEvent.accountId,
    userId: lockEvent.userId,
    trigger: "daily_loss_limit",
    reason: `C7B controlled real enforcement after dry-run: daily loss ${lossAmount} observed on ${lockEvent.tradingDay} (InternalLockEvent ${internalLockEventId})`,
    currentDailyLoss: lossAmount,
    internalLockEventId: lockEvent.id,
    // listenerBrokerDedupKey intentionally omitted: the dry-run row already
    // occupies the standard dedup key slot. At-most-once for real enforcement
    // is guaranteed by the broker_locked tri-state check above.
    tradingDay: lockEvent.tradingDay,
    brokerEnforcementMode: "lock_only",
  });

  return {
    attempted: true,
    allowed: true,
    skipReason: null,
    dedupKey,
    priorDryRunInterventionId,
  };
}
