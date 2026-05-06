/**
 * Broker-side enforcement.
 *
 * When Guardrail locks an account it attempts to apply a matching server-side
 * risk rule via Tradovate's userAccountAutoLiq API so the broker's own risk
 * engine enforces the halt — not just our internal flag.
 *
 * Enforcement capability by trigger type:
 *
 *   daily_loss_limit  → POST userAccountAutoLiq/update (or /create)
 *                        Sets dailyLossAutoLiq = current daily loss amount.
 *                        Tradovate's risk engine immediately places the account
 *                        into liquidation-only mode and blocks new opening orders.
 *                        Sets changesLocked=true so the setting cannot be removed
 *                        during the trading session.
 *
 *   trade_limit       → Monitoring only.
 *                        Tradovate's userAccountAutoLiq has no max-trades-per-day
 *                        field. userAccountRiskParameter has per-contract order
 *                        qty limits but not an account-wide trade count.
 *                        Orders/Positions Full Access would be required to cancel
 *                        orders or flatten positions as an alternative enforcement
 *                        path — that permission is currently Read Only.
 *
 *   consecutive_losses → Monitoring only (same limitation as trade_limit).
 *
 *   manual            → Monitoring only unless caller upgrades to full access.
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
 * "broker_enforced" means the trigger CAN be enforced server-side via
 * Tradovate's Account Risk Settings API (if the call succeeds).
 * "internal_only" means Guardrail locks the account internally but has
 * no proven Tradovate endpoint to enforce it at the broker level with
 * the current permission set (Account Risk Settings Full Access,
 * Orders/Positions Read Only).
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
      "Tradovate's userAccountAutoLiq has no profit-target field. " +
      "Internal Guardrail lock only. Broker-side profit-target blocking is not available.",
  },
  trading_day_disabled: {
    capability: "internal_only" as const,
    notes:
      "Session-day gate: today is not a selected trading day. " +
      "Internal Guardrail lock only. No Tradovate API field maps to trading-day restrictions.",
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

export async function triggerEnforcement(ctx: EnforcementContext): Promise<void> {
  const { accountId, userId, trigger, reason, currentDailyLoss } = ctx;

  console.info("[enforcement] trigger fired", { accountId, trigger, reason, currentDailyLoss });

  const account = await prisma.connectedAccount.findUnique({
    where: { id: accountId },
    select: {
      platform: true,
      brokerConnection: { select: { connectionStatus: true } },
    },
  });

  let outcome: string;
  let message: string;
  let brokerLockStatus: BrokerLockStatus;
  let brokerEndpoint: string | null = null;
  let brokerPayloadJson: Prisma.InputJsonValue | null = null;
  let brokerResponseJson: Prisma.InputJsonValue | null = null;

  const platform = account?.platform ?? "unknown";
  const connStatus = account?.brokerConnection?.connectionStatus ?? "not_connected";

  const skipResult = shouldSkipBrokerEnforcement({ platform, trigger, connectionStatus: connStatus });

  if (skipResult.skip) {
    brokerLockStatus = skipResult.lockStatus;
    outcome = skipResult.lockStatus;
    message = skipResult.reason;

    if (skipResult.lockStatus === "unavailable_read_only") {
      message +=
        " Guardrail is monitoring and alerting only for this account.";
    }
  } else {
    // ── Attempt broker-side lock via userAccountAutoLiq ───────────────────
    // Step 1 (read): GET userAccountAutoLiq/deps?masterid={tvAccountId}
    //   — confirms Account Risk Settings read access and finds existing rule
    // Step 2 (write): POST userAccountAutoLiq/update or /create
    //   — sets dailyLossAutoLiq = lossAmountToSet, changesLocked = true
    //
    // Both calls pass skipMarkExpired=true internally so a 401/403 on the
    // risk endpoint never expires the connection for other endpoints.
    const lossAmountToSet = computeLossAmountToSet(currentDailyLoss);

    try {
      const brokerClient = new TradovateClient(accountId, userId);
      await brokerClient.initialize();

      const result = await brokerClient.applyDailyLossLock({ lossAmountToSet });

      brokerEndpoint = result.endpoint;
      brokerPayloadJson = result.payload as Prisma.InputJsonValue;
      brokerResponseJson = result.response as Prisma.InputJsonValue;

      if (result.confirmed) {
        brokerLockStatus = "broker_locked";
        outcome = "broker_locked";
        message =
          `Broker-side lock applied via ${result.endpoint}. ` +
          `dailyLossAutoLiq=$${lossAmountToSet.toFixed(2)}, changesLocked=true. ` +
          `Tradovate confirmed the stored value (readback: $${(result.readbackValue ?? lossAmountToSet).toFixed(2)}). ` +
          `Tradovate will halt new opening orders for the rest of the trading session.`;

        console.info("[enforcement] broker lock confirmed", {
          accountId,
          endpoint: result.endpoint,
          lossAmountToSet,
          readbackValue: result.readbackValue,
        });
      } else {
        brokerLockStatus = "broker_lock_failed";
        outcome = "broker_lock_failed";
        message =
          `Broker lock via ${result.endpoint} accepted by API but value not confirmed. ` +
          `Sent dailyLossAutoLiq=$${lossAmountToSet.toFixed(2)}, ` +
          `read-back returned ${result.readbackValue != null ? `$${result.readbackValue.toFixed(2)}` : "null"}. ` +
          `Guardrail is monitoring and alerting only.`;

        console.warn("[enforcement] broker lock unconfirmed — value mismatch", {
          accountId,
          endpoint: result.endpoint,
          lossAmountToSet,
          readbackValue: result.readbackValue,
        });
      }
    } catch (err) {
      const { lockStatus, failureReason } = classifyEnforcementError(err);

      brokerLockStatus = lockStatus;
      outcome = lockStatus;
      message =
        `Broker lock attempt failed: ${failureReason} ` +
        "Guardrail is monitoring and alerting only.";

      console.error("[enforcement] broker lock failed", {
        accountId,
        trigger,
        lockStatus,
        failureReason,
      });
    }
  }

  await prisma.guardianIntervention.create({
    data: {
      accountId,
      userId,
      triggerType: trigger,
      outcome,
      message,
      sentAt: new Date(),
      ...(brokerEndpoint != null && { brokerEndpoint }),
      ...(brokerPayloadJson != null && { brokerPayloadJson }),
      ...(brokerResponseJson != null && { brokerResponseJson }),
      brokerLockStatus,
    },
  });
}
