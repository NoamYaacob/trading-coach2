/**
 * Service layer for the manual Dashboard "Lockout" broker attempt.
 *
 * Invoked by POST /api/accounts/[id]/lockout AFTER the internal Guardrail lock
 * (LiveSessionState.riskState=STOPPED + InternalLockEvent) has been committed.
 *
 * Responsibilities:
 *   1. Idempotent per account + CME trading day — keyed on the
 *      GuardianIntervention.listenerBrokerDedupKey unique constraint, so
 *      repeated clicks in the same session attempt the broker write at most
 *      once.
 *   2. Attempt the broker lock via applyManualBrokerLock (reuses the
 *      userAccountAutoLiq risk-setting write — no orders / flatten / cancel).
 *   3. Record the outcome to GuardianIntervention (full audit: endpoint,
 *      payload, raw response, status, link to the InternalLockEvent).
 *   4. Flip InternalLockEvent.brokerActionTaken to true ONLY on a confirmed
 *      broker lock.
 *   5. NEVER roll back the internal lock — a broker failure leaves the
 *      Guardrail lock intact.
 *
 * No listener-worker code is touched. This is called only from the
 * user-initiated route.
 */

import { Prisma } from "@prisma/client";

import { prisma } from "../db";
import { applyManualBrokerLock } from "../brokers/manual-broker-lock";
import type { BrokerLockStatus } from "../brokers/enforcement-helpers";
import { buildListenerBrokerDedupKey } from "./broker-enforcement-dedup";

export type ManualBrokerLockServiceResult = {
  /** True when a broker write was attempted on this call (false = skipped/idempotent). */
  attempted: boolean;
  /** Broker outcome status, or "already_recorded" when a prior attempt exists. */
  status: BrokerLockStatus | "already_recorded";
  /** True only when Tradovate confirmed the lock (broker_locked). */
  brokerActionTaken: boolean;
  message: string;
  /** Idempotency key written to GuardianIntervention.listenerBrokerDedupKey. */
  dedupKey: string;
};

/**
 * Attempt a broker-side lock for an already-created manual InternalLockEvent.
 *
 * The internal lock is the precondition and is never modified destructively
 * here — on a broker failure the lock stays in place and only the audit row +
 * (optionally) brokerActionTaken reflect the broker outcome.
 */
export async function maybeAttemptBrokerLockForManualLock(
  internalLockEventId: string,
): Promise<ManualBrokerLockServiceResult> {
  const lockEvent = await prisma.internalLockEvent.findUnique({
    where: { id: internalLockEventId },
    select: {
      id: true,
      accountId: true,
      userId: true,
      ruleType: true,
      tradingDay: true,
      clearedAt: true,
    },
  });

  if (lockEvent == null) {
    return {
      attempted: false,
      status: "broker_lock_failed",
      brokerActionTaken: false,
      message: `InternalLockEvent '${internalLockEventId}' not found — broker lock not attempted.`,
      dedupKey: "",
    };
  }

  const dedupKey = buildListenerBrokerDedupKey(
    lockEvent.accountId,
    lockEvent.ruleType,
    lockEvent.tradingDay,
  );

  // A cleared lock is stale — do not write to the broker.
  if (lockEvent.clearedAt != null) {
    return {
      attempted: false,
      status: "broker_lock_failed",
      brokerActionTaken: false,
      message: "Internal lock is already cleared — broker lock not attempted.",
      dedupKey,
    };
  }

  // Idempotency — at most one broker attempt per account + CME trading day.
  const existing = await prisma.guardianIntervention.findUnique({
    where: { listenerBrokerDedupKey: dedupKey },
    select: { id: true, brokerLockStatus: true },
  });
  if (existing != null) {
    return {
      attempted: false,
      status: "already_recorded",
      brokerActionTaken: existing.brokerLockStatus === "broker_locked",
      message: "Broker lock was already attempted for this account this CME session.",
      dedupKey,
    };
  }

  const result = await applyManualBrokerLock({
    accountId: lockEvent.accountId,
    userId: lockEvent.userId,
  });
  const brokerActionTaken = result.status === "broker_locked";

  // Record the broker outcome. A concurrent request may have inserted the same
  // dedup key between the check above and now — tolerate that unique-constraint
  // violation as an idempotent no-op rather than failing the lock.
  try {
    await prisma.guardianIntervention.create({
      data: {
        accountId: lockEvent.accountId,
        userId: lockEvent.userId,
        triggerType: "manual",
        outcome: result.status,
        message: result.message,
        sentAt: new Date(),
        ...(result.brokerEndpoint != null && { brokerEndpoint: result.brokerEndpoint }),
        ...(result.brokerPayload != null && {
          brokerPayloadJson: result.brokerPayload as Prisma.InputJsonValue,
        }),
        ...(result.brokerResponse != null && {
          brokerResponseJson: result.brokerResponse as Prisma.InputJsonValue,
        }),
        brokerLockStatus: result.status,
        flattenStatus: "not_needed",
        flattenMessage:
          "Manual lock: risk-setting write only — no position-close action attempted.",
        internalLockEventId: lockEvent.id,
        listenerBrokerDedupKey: dedupKey,
        tradingDay: lockEvent.tradingDay,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return {
        attempted: false,
        status: "already_recorded",
        brokerActionTaken,
        message: "Broker lock was already recorded for this account this CME session.",
        dedupKey,
      };
    }
    throw err;
  }

  // Flip brokerActionTaken only on a confirmed broker lock. A failure/unavailable
  // outcome leaves the internal lock untouched (brokerActionTaken stays false).
  if (brokerActionTaken) {
    await prisma.internalLockEvent.update({
      where: { id: lockEvent.id },
      data: { brokerActionTaken: true },
    });
  }

  return {
    attempted: true,
    status: result.status,
    brokerActionTaken,
    message: result.message,
    dedupKey,
  };
}

/**
 * Statuses that indicate a prior broker attempt did not actually execute a live
 * broker write — safe to retry now that ENFORCEMENT_DRY_RUN=false.
 */
const RETRYABLE_STATUSES = new Set<string>([
  "dry_run",
  "broker_lock_failed",
  "unavailable_permission",
  "unavailable_read_only",
  "unavailable_consent_missing",
  "monitoring_only",
  "not_requested",
]);

function isRetryableStatus(status: string): boolean {
  return RETRYABLE_STATUSES.has(status) || status.startsWith("unavailable_");
}

export type RetryManualBrokerLockResult = {
  /** "no_active_lock" | "already_broker_locked" | "no_prior_intervention" | "not_retryable" | "retried" */
  outcome:
    | "no_active_lock"
    | "already_broker_locked"
    | "no_prior_intervention"
    | "not_retryable"
    | "retried";
  /** The broker write result, present when outcome="retried". */
  status?: BrokerLockStatus;
  brokerActionTaken: boolean;
  message: string;
  dedupKey: string;
};

/**
 * Retry the broker-side lock for a manual InternalLockEvent whose prior
 * GuardianIntervention recorded a non-live result (dry_run / failed /
 * unavailable). Safe to call when ENFORCEMENT_DRY_RUN has been flipped to
 * false and you need the actual broker write to fire.
 *
 * Preconditions checked here — the function never writes if:
 *   - The InternalLockEvent is already cleared (clearedAt != null).
 *   - No prior GuardianIntervention exists (nothing to retry — use the POST
 *     /api/accounts/[id]/lockout route instead).
 *   - The prior intervention already has brokerLockStatus=broker_locked.
 *   - The prior brokerLockStatus is not a recognised retryable status.
 *
 * On a successful retry the existing GuardianIntervention row is updated
 * in-place (brokerLockStatus, outcome, message, brokerResponseJson) and
 * InternalLockEvent.brokerActionTaken is flipped to true.
 *
 * On failure the existing row is updated with the new failed/unavailable
 * status but the internal lock is never rolled back.
 */
export async function retryManualBrokerLock(
  internalLockEventId: string,
): Promise<RetryManualBrokerLockResult> {
  const lockEvent = await prisma.internalLockEvent.findUnique({
    where: { id: internalLockEventId },
    select: {
      id: true,
      accountId: true,
      userId: true,
      ruleType: true,
      tradingDay: true,
      clearedAt: true,
      brokerActionTaken: true,
    },
  });

  if (lockEvent == null || lockEvent.clearedAt != null) {
    return {
      outcome: "no_active_lock",
      brokerActionTaken: false,
      message:
        lockEvent == null
          ? `InternalLockEvent '${internalLockEventId}' not found.`
          : "Internal lock is already cleared — cannot retry a cleared lock.",
      dedupKey: "",
    };
  }

  const dedupKey = buildListenerBrokerDedupKey(
    lockEvent.accountId,
    lockEvent.ruleType,
    lockEvent.tradingDay,
  );

  const prior = await prisma.guardianIntervention.findUnique({
    where: { listenerBrokerDedupKey: dedupKey },
    select: { id: true, brokerLockStatus: true },
  });

  if (prior == null) {
    return {
      outcome: "no_prior_intervention",
      brokerActionTaken: false,
      message:
        "No prior GuardianIntervention found for this lock — use the lockout route to create one.",
      dedupKey,
    };
  }

  const priorBrokerActionTaken = prior.brokerLockStatus === "broker_locked";
  if (priorBrokerActionTaken) {
    return {
      outcome: "already_broker_locked",
      brokerActionTaken: true,
      message: "Broker lock is already confirmed — no retry needed.",
      dedupKey,
    };
  }

  if (!isRetryableStatus(prior.brokerLockStatus ?? "")) {
    return {
      outcome: "not_retryable",
      brokerActionTaken: false,
      message: `Prior brokerLockStatus '${prior.brokerLockStatus}' is not retryable.`,
      dedupKey,
    };
  }

  // Attempt the live broker write now.
  const result = await applyManualBrokerLock({
    accountId: lockEvent.accountId,
    userId: lockEvent.userId,
  });
  const brokerActionTaken = result.status === "broker_locked";

  // Update the existing GuardianIntervention row in-place so the audit trail
  // shows the current (retried) outcome while keeping the original sentAt.
  await prisma.guardianIntervention.update({
    where: { id: prior.id },
    data: {
      brokerLockStatus: result.status,
      outcome: result.status,
      message: result.message,
      ...(result.brokerEndpoint != null && { brokerEndpoint: result.brokerEndpoint }),
      ...(result.brokerPayload != null && {
        brokerPayloadJson: result.brokerPayload as Prisma.InputJsonValue,
      }),
      ...(result.brokerResponse != null && {
        brokerResponseJson: result.brokerResponse as Prisma.InputJsonValue,
      }),
    },
  });

  if (brokerActionTaken) {
    await prisma.internalLockEvent.update({
      where: { id: lockEvent.id },
      data: { brokerActionTaken: true },
    });
  }

  return {
    outcome: "retried",
    status: result.status,
    brokerActionTaken,
    message: result.message,
    dedupKey,
  };
}
