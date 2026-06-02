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
