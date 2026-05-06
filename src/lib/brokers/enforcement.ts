/**
 * Broker-side enforcement.
 *
 * All verified rule breaches flow through `applyBrokerDayLockout`, which is
 * the single shared broker-lockout adapter. It determines whether a trigger
 * supports broker-side enforcement, attempts the API call for supported
 * triggers, and returns a structured result. `triggerEnforcement` wraps it
 * to persist the GuardianIntervention audit record.
 *
 * ── Tradovate userAccountAutoLiq API audit ────────────────────────────────
 *
 * The question: can userAccountAutoLiq be used as a generic day-lockout for
 * any trigger by setting dailyLossAutoLiq to the current loss amount?
 *
 *   daily_loss_limit     → YES. VERIFIED.
 *                          Set dailyLossAutoLiq = current daily loss so the
 *                          account is immediately at/past the limit. Tradovate's
 *                          risk engine places it in liquidation-only mode.
 *                          changesLocked=true prevents removal mid-session.
 *                          Endpoint: userAccountAutoLiq/update (or /create).
 *
 *   profit_target        → NOT YET. UNVERIFIED FIELD.
 *                          TvUserAccountAutoLiq.dailyProfitAutoLiq exists in
 *                          the Tradovate OpenAPI spec but its exact behaviour
 *                          (immediate liq-only lock vs. soft alert) has not
 *                          been confirmed against a live account. Wire when
 *                          confirmed. Until then: internal_only.
 *
 *   trade_limit          → NO. NO MATCHING FIELD.
 *                          userAccountAutoLiq has no max-trades-per-day field.
 *                          userAccountRiskParameter has per-contract
 *                          maxOpeningOrderQty, not an account-wide trade count.
 *                          Order cancellation would require Orders Full Access
 *                          (currently Read Only). Internal_only.
 *
 *   consecutive_losses   → NO. NO MATCHING FIELD.
 *                          No Tradovate API field maps to a consecutive loss
 *                          streak limit. Internal_only.
 *
 *   trading_day_disabled → NO. NO MATCHING FIELD.
 *                          No Tradovate API field restricts trading to specific
 *                          days of the week. Internal_only.
 *
 *   session_end          → NOT YET IMPLEMENTED. NEEDS SCHEDULER.
 *                          Firing this trigger reliably requires a cron job
 *                          timed to the CME session close (4:00 PM CT). The
 *                          existing /api/cron/tradovate-sync endpoint handles
 *                          ongoing syncs but does not fire a session-end event.
 *                          TvUserAccountAutoLiq.flattenTimestamp may be usable
 *                          as a session-end mechanism but is unverified.
 *                          Internal_only until a session-end scheduler exists.
 *
 *   manual               → Internal_only. Guardrail-internal state change only.
 *
 * All outcomes — including failures — are logged to GuardianIntervention with
 * the exact endpoint, payload, and broker response for audit purposes.
 */

import { prisma } from "@/lib/db";
import { TradovateClient } from "./tradovate-client";
import type { Prisma } from "@prisma/client";
import {
  shouldSkipBrokerEnforcement,
  classifyEnforcementError,
  computeLossAmountToSet,
} from "./enforcement-helpers";

export type { EnforcementTrigger, BrokerLockStatus } from "./enforcement-helpers";
import type { EnforcementTrigger, BrokerLockStatus } from "./enforcement-helpers";

/**
 * Canonical enforcement capability per trigger type.
 *
 * "broker_enforced" — can be enforced server-side via Tradovate's Account
 *   Risk Settings API when the call succeeds.
 * "internal_only" — Guardrail locks the account in its own state and sends
 *   alerts, but has no proven Tradovate endpoint to enforce it at the broker
 *   level with the current permission set.
 */
export const ENFORCEMENT_CAPABILITIES = {
  daily_loss_limit: {
    capability: "broker_enforced" as const,
    brokerEndpoint: "userAccountAutoLiq/update (or /create)",
    permission: "Account Risk Settings: Full Access",
    notes:
      "Sets dailyLossAutoLiq to the current loss amount so Tradovate's risk engine " +
      "immediately places the account in liquidation-only mode and blocks new opening " +
      "orders for the rest of the trading session.",
  },
  trade_limit: {
    capability: "internal_only" as const,
    notes:
      "userAccountAutoLiq has no max-trades-per-day field. " +
      "userAccountRiskParameter has per-contract maxOpeningOrderQty but not an " +
      "account-wide trade count limit. Order cancellation would require Orders " +
      "Full Access. Internal Guardrail lock only.",
  },
  consecutive_losses: {
    capability: "internal_only" as const,
    notes:
      "No Tradovate API field maps to consecutive loss streaks. " +
      "Internal Guardrail lock only.",
  },
  profit_target: {
    capability: "internal_only" as const,
    notes:
      "TvUserAccountAutoLiq.dailyProfitAutoLiq exists in the Tradovate OpenAPI spec " +
      "but its exact lockout behaviour has not been confirmed against a live account. " +
      "Wire to broker enforcement when confirmed. Internal Guardrail lock only until then.",
  },
  trading_day_disabled: {
    capability: "internal_only" as const,
    notes:
      "Session-day gate: today is not a selected trading day. " +
      "No Tradovate API field maps to day-of-week trading restrictions. " +
      "Internal Guardrail lock only.",
  },
  manual: {
    capability: "internal_only" as const,
    notes: "Manual interventions are Guardrail-internal only.",
  },
} as const satisfies Record<
  EnforcementTrigger,
  { capability: "broker_enforced" | "internal_only"; brokerEndpoint?: string; permission?: string; notes: string }
>;

export type EnforcementContext = {
  accountId: string;
  userId: string;
  trigger: EnforcementTrigger;
  /** Short human-readable description of why enforcement fired */
  reason: string;
  /**
   * Current daily loss in dollars (absolute value, positive number).
   * Used to set the broker-side dailyLossAutoLiq threshold so the account is
   * immediately at/past the limit when the API call is processed.
   * Required for daily_loss_limit trigger; ignored for other triggers.
   */
  currentDailyLoss?: number | null;
};

/**
 * Result returned by `applyBrokerDayLockout`.
 * Does not include the human reason for the trigger — that is the caller's context.
 */
export type BrokerDayLockoutResult = {
  status: BrokerLockStatus;
  /** Outcome message describing what the broker did (or why it was skipped). */
  message: string;
  brokerEndpoint: string | null;
  /** Exact payload sent to the broker endpoint (null when no broker call was made). */
  brokerPayload: Record<string, unknown> | null;
  /** Raw response from the broker endpoint (null when no broker call was made). */
  brokerResponse: unknown;
};

/**
 * Attempt broker-side day lockout for a verified rule breach.
 *
 * This is the single shared path every verified rule breach flows through.
 * It determines whether the trigger supports broker-side enforcement, attempts
 * the API call for supported triggers, and returns a structured result.
 *
 * It does NOT write to GuardianIntervention — that is `triggerEnforcement`'s job.
 *
 * Safety invariants:
 *   - Read-only connections never reach a write endpoint.
 *   - A 403 from userAccountAutoLiq does not expire the OAuth connection
 *     (skipMarkExpired=true is set inside TradovateClient).
 *   - broker_locked is only returned when a read-back confirms the stored value.
 *   - All other triggers (trade_limit, consecutive_losses, profit_target,
 *     trading_day_disabled, manual) return monitoring_only — no broker call.
 */
export async function applyBrokerDayLockout(
  ctx: Pick<EnforcementContext, "accountId" | "userId" | "trigger" | "currentDailyLoss">,
): Promise<BrokerDayLockoutResult> {
  const { accountId, userId, trigger, currentDailyLoss } = ctx;

  const account = await prisma.connectedAccount.findUnique({
    where: { id: accountId },
    select: {
      platform: true,
      brokerConnection: { select: { connectionStatus: true } },
    },
  });

  const platform = account?.platform ?? "unknown";
  const connStatus = account?.brokerConnection?.connectionStatus ?? "not_connected";

  const skipResult = shouldSkipBrokerEnforcement({ platform, trigger, connectionStatus: connStatus });

  if (skipResult.skip) {
    let message = skipResult.reason;
    if (skipResult.lockStatus === "unavailable_read_only") {
      message += " Guardrail is monitoring and alerting only for this account.";
    }
    return {
      status: skipResult.lockStatus,
      message,
      brokerEndpoint: null,
      brokerPayload: null,
      brokerResponse: null,
    };
  }

  // ── Attempt broker-side lock via userAccountAutoLiq ───────────────────────
  // Only daily_loss_limit reaches this path (shouldSkipBrokerEnforcement gates all others).
  //
  // Step 1 (read): GET userAccountAutoLiq/deps?masterid={tvAccountId}
  //   — finds any existing rule record; passes skipMarkExpired=true
  // Step 2 (write): POST userAccountAutoLiq/update (or /create)
  //   — sets dailyLossAutoLiq = lossAmountToSet, changesLocked = true
  // Step 3 (confirm): read-back GET if response doesn't echo the field
  //   — broker_locked only when read-back confirms the stored value
  const lossAmountToSet = computeLossAmountToSet(currentDailyLoss);

  try {
    const brokerClient = new TradovateClient(accountId, userId);
    await brokerClient.initialize();

    const result = await brokerClient.applyDailyLossLock({ lossAmountToSet });

    if (result.confirmed) {
      console.info("[enforcement] broker lock confirmed", {
        accountId,
        endpoint: result.endpoint,
        lossAmountToSet,
        readbackValue: result.readbackValue,
      });
      return {
        status: "broker_locked",
        message:
          `Broker-side lock applied via ${result.endpoint}. ` +
          `dailyLossAutoLiq=$${lossAmountToSet.toFixed(2)}, changesLocked=true. ` +
          `Tradovate confirmed the stored value (readback: $${(result.readbackValue ?? lossAmountToSet).toFixed(2)}). ` +
          `Tradovate will halt new opening orders for the rest of the trading session.`,
        brokerEndpoint: result.endpoint,
        brokerPayload: result.payload,
        brokerResponse: result.response,
      };
    } else {
      console.warn("[enforcement] broker lock unconfirmed — value mismatch", {
        accountId,
        endpoint: result.endpoint,
        lossAmountToSet,
        readbackValue: result.readbackValue,
      });
      return {
        status: "broker_lock_failed",
        message:
          `Broker lock via ${result.endpoint} accepted by API but value not confirmed. ` +
          `Sent dailyLossAutoLiq=$${lossAmountToSet.toFixed(2)}, ` +
          `read-back returned ${result.readbackValue != null ? `$${result.readbackValue.toFixed(2)}` : "null"}. ` +
          `Guardrail is monitoring and alerting only.`,
        brokerEndpoint: result.endpoint,
        brokerPayload: result.payload,
        brokerResponse: result.response,
      };
    }
  } catch (err) {
    const { lockStatus, failureReason } = classifyEnforcementError(err);

    console.error("[enforcement] broker lock failed", {
      accountId,
      trigger,
      lockStatus,
      failureReason,
    });

    return {
      status: lockStatus,
      message:
        `Broker lock attempt failed: ${failureReason} ` +
        "Guardrail is monitoring and alerting only.",
      brokerEndpoint: null,
      brokerPayload: null,
      brokerResponse: null,
    };
  }
}

/**
 * Fire enforcement for a verified rule breach.
 *
 * Calls `applyBrokerDayLockout` to attempt broker-side enforcement, then
 * persists a GuardianIntervention audit record regardless of outcome.
 *
 * The caller is responsible for ensuring this is only called on the
 * NORMAL → STOPPED transition (not on repeated syncs where the account
 * is already STOPPED).
 */
export async function triggerEnforcement(ctx: EnforcementContext): Promise<void> {
  const { accountId, userId, trigger, reason } = ctx;

  console.info("[enforcement] trigger fired", {
    accountId,
    trigger,
    reason,
    currentDailyLoss: ctx.currentDailyLoss,
  });

  const result = await applyBrokerDayLockout(ctx);

  await prisma.guardianIntervention.create({
    data: {
      accountId,
      userId,
      triggerType: trigger,
      outcome: result.status,
      message: result.message,
      sentAt: new Date(),
      ...(result.brokerEndpoint != null && { brokerEndpoint: result.brokerEndpoint }),
      ...(result.brokerPayload != null && { brokerPayloadJson: result.brokerPayload as Prisma.InputJsonValue }),
      ...(result.brokerResponse != null && { brokerResponseJson: result.brokerResponse as Prisma.InputJsonValue }),
      brokerLockStatus: result.status,
    },
  });
}
