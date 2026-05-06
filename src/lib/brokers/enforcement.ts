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
 *   profit_target        → YES. VERIFIED (OpenAPI audit, May 2026).
 *                          Set dailyProfitAutoLiq = current daily profit so
 *                          the account is immediately at/past the limit.
 *                          Tradovate's risk engine places it in
 *                          liquidation-only mode. changesLocked=true prevents
 *                          removal mid-session.
 *                          Endpoint: userAccountAutoLiq/update (or /create).
 *                          ⚠ LIVE QA REQUIRED: field confirmed by OpenAPI schema
 *                          and read-back logic, but live broker behavior must be
 *                          validated on a demo/sim account before treating this
 *                          as fully broker-enforced in production.
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
  classifyFlattenError,
  computeLossAmountToSet,
  computeProfitAmountToSet,
  isEnforcementDryRun,
} from "./enforcement-helpers";

export type { EnforcementTrigger, BrokerLockStatus, FlattenStatus, BrokerFlattenResult } from "./enforcement-helpers";
import type { EnforcementTrigger, BrokerLockStatus, FlattenStatus, BrokerFlattenResult } from "./enforcement-helpers";

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
    capability: "broker_enforced" as const,
    brokerEndpoint: "userAccountAutoLiq/update (or /create)",
    permission: "Account Risk Settings: Full Access",
    notes:
      "Sets dailyProfitAutoLiq to the current daily profit so Tradovate's risk engine " +
      "immediately places the account in liquidation-only mode and blocks new opening " +
      "orders for the rest of the trading session. Verified via OpenAPI audit (May 2026). " +
      "⚠ LIVE QA REQUIRED: dailyProfitAutoLiq confirmed by OpenAPI schema and read-back " +
      "logic, but live broker behavior must be validated on a demo/sim account before " +
      "marketing this as fully broker-enforced.",
  },
  trading_day_disabled: {
    capability: "internal_only" as const,
    notes:
      "Session-day gate: today is not a selected trading day. " +
      "No Tradovate API field maps to day-of-week trading restrictions. " +
      "Internal Guardrail lock only.",
  },
  session_end: {
    capability: "internal_only" as const,
    notes:
      "Firing this trigger reliably requires a cron job timed to the CME session " +
      "close (4:00 PM CT). TvUserAccountAutoLiq.flattenTimestamp may be usable as " +
      "a session-end mechanism but is unverified. Internal_only until a session-end " +
      "scheduler exists and flattenTimestamp is tested against a live account.",
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
  /**
   * Current daily P&L in dollars (positive on a profitable day).
   * Used to set the broker-side dailyProfitAutoLiq threshold so the account is
   * immediately at/past the profit limit when the API call is processed.
   * Required for profit_target trigger; ignored for other triggers.
   */
  currentDailyPnl?: number | null;
};

/**
 * Result returned by `applyBrokerDayLockout`.
 * Does not include the human reason for the trigger — that is the caller's context.
 *
 * For triggers that support position flattening (daily_loss_limit, profit_target),
 * the flatten step runs before the day lockout step. Both outcomes are persisted.
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
  /** Outcome of the position-exit step (runs before day lockout for supported triggers). */
  flattenStatus: FlattenStatus;
  flattenMessage: string;
  flattenPayload: Record<string, unknown> | null;
  flattenResponse: unknown;
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
 *   - Every trigger is routed through an explicit switch — the default branch
 *     returns monitoring_only without calling any broker endpoint, so a future
 *     trigger cannot accidentally reach applyDailyLossLock or applyProfitTargetLock.
 */
export async function applyBrokerDayLockout(
  ctx: Pick<EnforcementContext, "accountId" | "userId" | "trigger" | "currentDailyLoss" | "currentDailyPnl">,
): Promise<BrokerDayLockoutResult> {
  const { accountId, userId, trigger, currentDailyLoss } = ctx;

  const account = await prisma.connectedAccount.findUnique({
    where: { id: accountId },
    select: {
      platform: true,
      externalAccountId: true,
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
    const flattenSkipStatus: FlattenStatus =
      skipResult.lockStatus === "unavailable_read_only" ? "unavailable_read_only" : "not_needed";
    return {
      status: skipResult.lockStatus,
      message,
      brokerEndpoint: null,
      brokerPayload: null,
      brokerResponse: null,
      flattenStatus: flattenSkipStatus,
      flattenMessage:
        flattenSkipStatus === "unavailable_read_only"
          ? "Position exit unavailable: connection is read-only."
          : "Position exit not applicable for this trigger or platform.",
      flattenPayload: null,
      flattenResponse: null,
    };
  }

  // ── Dry-run mode ─────────────────────────────────────────────────────────
  // When ENFORCEMENT_DRY_RUN=true, skip all broker write endpoints and return
  // the intended payload so QA can verify what would have been sent.
  // The Guardrail internal lock (riskState = STOPPED) still applies.
  // No TradovateClient is instantiated and no broker API is called.
  if (isEnforcementDryRun()) {
    const tvAccountId =
      account?.externalAccountId != null ? parseInt(account.externalAccountId, 10) : null;

    let intendedLockoutEndpoint: string;
    let intendedLockoutPayload: Record<string, unknown>;
    const supportsFlatten = trigger === "daily_loss_limit" || trigger === "profit_target";

    if (trigger === "daily_loss_limit") {
      const lossAmountToSet = computeLossAmountToSet(currentDailyLoss);
      intendedLockoutEndpoint = "userAccountAutoLiq/update (or /create)";
      intendedLockoutPayload = { accountId: tvAccountId, dailyLossAutoLiq: lossAmountToSet, changesLocked: true };
    } else if (trigger === "profit_target") {
      const profitAmountToSet = computeProfitAmountToSet(ctx.currentDailyPnl);
      intendedLockoutEndpoint = "userAccountAutoLiq/update (or /create)";
      intendedLockoutPayload = { accountId: tvAccountId, dailyProfitAutoLiq: profitAmountToSet, changesLocked: true };
    } else {
      intendedLockoutEndpoint = "none";
      intendedLockoutPayload = {};
    }

    const intendedFlattenPayload = supportsFlatten
      ? { positions: ["(open position IDs from position/deps read)"], admin: false }
      : null;

    console.info("[enforcement/dry-run] broker writes simulated — no Tradovate call made", {
      accountId,
      trigger,
      tvAccountId,
      intendedFlattenEndpoint: supportsFlatten ? "order/liquidatepositions" : "none",
      intendedFlattenPayload,
      intendedLockoutEndpoint,
      intendedLockoutPayload,
    });

    const dryRunMessage =
      supportsFlatten
        ? "Dry run · Position exit and broker-side lockout were simulated. No Tradovate write was sent."
        : `Dry run · Broker-side lockout was simulated. No Tradovate write was sent. Would have called ${intendedLockoutEndpoint} with payload: ${JSON.stringify(intendedLockoutPayload)}.`;

    return {
      status: "dry_run",
      message: dryRunMessage,
      brokerEndpoint: intendedLockoutEndpoint,
      brokerPayload: intendedLockoutPayload,
      brokerResponse: null,
      flattenStatus: "dry_run",
      flattenMessage:
        supportsFlatten
          ? "Dry run · Position exit simulated. Would have called order/liquidatepositions if open positions exist."
          : "Position exit not applicable for this trigger.",
      flattenPayload: intendedFlattenPayload,
      flattenResponse: null,
    };
  }

  // ── Explicit switch: one broker method per trigger ────────────────────────
  // Only triggers with a proven Tradovate API field reach this code.
  // shouldSkipBrokerEnforcement (above) gates all other triggers before
  // TradovateClient is ever instantiated.
  //
  // The switch is exhaustive by design: every case that calls a broker write
  // endpoint is named explicitly, and the default case is a defensive guard
  // that returns monitoring_only without calling any endpoint — so a future
  // trigger added to the type cannot accidentally reach applyDailyLossLock
  // or applyProfitTargetLock.
  //
  // Three-step pattern for each broker-enforced case:
  //   Step 1 (read):    GET  userAccountAutoLiq/deps?masterid={tvAccountId}
  //   Step 2 (write):   POST userAccountAutoLiq/update (or /create)
  //   Step 3 (confirm): read-back GET if response doesn't echo the field
  //                     → broker_locked only when confirmed = true
  try {
    const brokerClient = new TradovateClient(accountId, userId);
    await brokerClient.initialize();

    switch (trigger) {
      case "daily_loss_limit": {
        // Step 1: flatten open positions (fail-safe — failure does not block lockout)
        let flattenResult: BrokerFlattenResult;
        try {
          flattenResult = await brokerClient.applyFlattenOpenPositions();
        } catch (flattenErr) {
          flattenResult = classifyFlattenError(flattenErr);
          console.warn("[enforcement] position flatten failed — proceeding to day lockout", {
            accountId,
            flattenStatus: flattenResult.flattenStatus,
          });
        }

        // Step 2: apply broker-side day lockout
        const lossAmountToSet = computeLossAmountToSet(currentDailyLoss);
        const result = await brokerClient.applyDailyLossLock({ lossAmountToSet });

        if (result.confirmed) {
          console.info("[enforcement] daily loss broker lock confirmed", {
            accountId,
            endpoint: result.endpoint,
            lossAmountToSet,
            readbackValue: result.readbackValue,
            flattenStatus: flattenResult.flattenStatus,
          });
          return {
            status: "broker_locked",
            message:
              `${flattenResult.flattenMessage} ` +
              `Broker-side lock applied via ${result.endpoint}. ` +
              `dailyLossAutoLiq=$${lossAmountToSet.toFixed(2)}, changesLocked=true. ` +
              `Tradovate confirmed the stored value (readback: $${(result.readbackValue ?? lossAmountToSet).toFixed(2)}). ` +
              `Tradovate will halt new opening orders for the rest of the trading session.`,
            brokerEndpoint: result.endpoint,
            brokerPayload: result.payload,
            brokerResponse: result.response,
            ...flattenResult,
          };
        }
        console.warn("[enforcement] daily loss broker lock unconfirmed — value mismatch", {
          accountId,
          endpoint: result.endpoint,
          lossAmountToSet,
          readbackValue: result.readbackValue,
        });
        return {
          status: "broker_lock_failed",
          message:
            `${flattenResult.flattenMessage} ` +
            `Broker lock via ${result.endpoint} accepted by API but value not confirmed. ` +
            `Sent dailyLossAutoLiq=$${lossAmountToSet.toFixed(2)}, ` +
            `read-back returned ${result.readbackValue != null ? `$${result.readbackValue.toFixed(2)}` : "null"}. ` +
            `Guardrail is monitoring and alerting only.`,
          brokerEndpoint: result.endpoint,
          brokerPayload: result.payload,
          brokerResponse: result.response,
          ...flattenResult,
        };
      }

      case "profit_target": {
        // Step 1: flatten open positions (fail-safe — failure does not block lockout)
        let flattenResult: BrokerFlattenResult;
        try {
          flattenResult = await brokerClient.applyFlattenOpenPositions();
        } catch (flattenErr) {
          flattenResult = classifyFlattenError(flattenErr);
          console.warn("[enforcement] position flatten failed — proceeding to day lockout", {
            accountId,
            flattenStatus: flattenResult.flattenStatus,
          });
        }

        // Step 2: apply broker-side day lockout
        const profitAmountToSet = computeProfitAmountToSet(ctx.currentDailyPnl);
        const result = await brokerClient.applyProfitTargetLock({ profitAmountToSet });

        if (result.confirmed) {
          console.info("[enforcement] profit target broker lock confirmed", {
            accountId,
            endpoint: result.endpoint,
            profitAmountToSet,
            readbackValue: result.readbackValue,
            flattenStatus: flattenResult.flattenStatus,
          });
          return {
            status: "broker_locked",
            message:
              `${flattenResult.flattenMessage} ` +
              `Broker-side lock applied via ${result.endpoint}. ` +
              `dailyProfitAutoLiq=$${profitAmountToSet.toFixed(2)}, changesLocked=true. ` +
              `Tradovate confirmed the stored value (readback: $${(result.readbackValue ?? profitAmountToSet).toFixed(2)}). ` +
              `Tradovate will halt new opening orders for the rest of the trading session.`,
            brokerEndpoint: result.endpoint,
            brokerPayload: result.payload,
            brokerResponse: result.response,
            ...flattenResult,
          };
        }
        console.warn("[enforcement] profit target broker lock unconfirmed — value mismatch", {
          accountId,
          endpoint: result.endpoint,
          profitAmountToSet,
          readbackValue: result.readbackValue,
        });
        return {
          status: "broker_lock_failed",
          message:
            `${flattenResult.flattenMessage} ` +
            `Broker lock via ${result.endpoint} accepted by API but value not confirmed. ` +
            `Sent dailyProfitAutoLiq=$${profitAmountToSet.toFixed(2)}, ` +
            `read-back returned ${result.readbackValue != null ? `$${result.readbackValue.toFixed(2)}` : "null"}. ` +
            `Guardrail is monitoring and alerting only.`,
          brokerEndpoint: result.endpoint,
          brokerPayload: result.payload,
          brokerResponse: result.response,
          ...flattenResult,
        };
      }

      default: {
        // shouldSkipBrokerEnforcement should have caught any trigger not listed
        // above before we ever reached this code. This branch is a defense-in-depth
        // guard: if it fires, it means a new trigger was added to EnforcementTrigger
        // and wired through shouldSkipBrokerEnforcement without adding a case here.
        // Return monitoring_only without calling any broker write endpoint.
        console.error("[enforcement] unexpected trigger reached broker path — this is a code defect", {
          accountId,
          trigger,
        });
        return {
          status: "monitoring_only",
          message:
            `Trigger '${trigger as string}' has no mapped broker endpoint. ` +
            "shouldSkipBrokerEnforcement should have returned skip=true for this trigger. " +
            "No broker write endpoint was called. Guardrail is monitoring and alerting only.",
          brokerEndpoint: null,
          brokerPayload: null,
          brokerResponse: null,
          flattenStatus: "not_needed",
          flattenMessage: "Position exit not applicable for this trigger.",
          flattenPayload: null,
          flattenResponse: null,
        };
      }
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
      flattenStatus: "not_needed",
      flattenMessage: "Position exit not attempted due to broker lock failure.",
      flattenPayload: null,
      flattenResponse: null,
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
      flattenStatus: result.flattenStatus,
      flattenMessage: result.flattenMessage,
      ...(result.flattenPayload != null && { flattenPayloadJson: result.flattenPayload as Prisma.InputJsonValue }),
      ...(result.flattenResponse != null && { flattenResponseJson: result.flattenResponse as Prisma.InputJsonValue }),
    },
  });
}
