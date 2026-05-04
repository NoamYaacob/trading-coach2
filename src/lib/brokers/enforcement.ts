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
import { TradovateClient, TradovateClientError } from "./tradovate-client";
import type { Prisma } from "@prisma/client";

export type EnforcementTrigger =
  | "daily_loss_limit"
  | "trade_limit"
  | "consecutive_losses"
  | "manual";

/** Values stored in GuardianIntervention.brokerLockStatus */
export type BrokerLockStatus =
  | "broker_locked"      // broker API accepted the lock
  | "monitoring_only"    // no applicable broker API for this trigger
  | "broker_lock_failed" // broker API was called but returned an error

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
    select: { platform: true },
  });

  let outcome: string;
  let message: string;
  let brokerLockStatus: BrokerLockStatus;
  let brokerEndpoint: string | null = null;
  let brokerPayloadJson: Prisma.InputJsonValue | null = null;
  let brokerResponseJson: Prisma.InputJsonValue | null = null;

  if (account?.platform === "tradovate" && trigger === "daily_loss_limit") {
    // ── Attempt broker-side lock via userAccountAutoLiq ───────────────────
    // Step 1 (read): GET userAccountAutoLiq/deps?masterid={tvAccountId}
    //   — confirms Account Risk Settings read access and finds existing rule
    // Step 2 (write): POST userAccountAutoLiq/update or /create
    //   — sets dailyLossAutoLiq = lossAmountToSet, changesLocked = true
    const lossAmountToSet = Math.max(0, currentDailyLoss ?? 0);

    try {
      const brokerClient = new TradovateClient(accountId, userId);
      await brokerClient.initialize();

      const result = await brokerClient.applyDailyLossLock({ lossAmountToSet });

      brokerEndpoint = result.endpoint;
      brokerPayloadJson = result.payload as Prisma.InputJsonValue;
      brokerResponseJson = result.response as Prisma.InputJsonValue;
      brokerLockStatus = "broker_locked";
      outcome = "broker_locked";
      message =
        `Broker-side lock applied via ${result.endpoint}. ` +
        `dailyLossAutoLiq=$${lossAmountToSet.toFixed(2)}, changesLocked=true. ` +
        `Tradovate will halt new opening orders for the rest of the trading session.`;

      console.info("[enforcement] broker lock succeeded", {
        accountId,
        endpoint: result.endpoint,
        lossAmountToSet,
      });
    } catch (err) {
      const isClientError = err instanceof TradovateClientError;
      const errCode = isClientError ? err.code : "UNKNOWN";
      const statusCode = isClientError ? (err as TradovateClientError).statusCode : null;
      const errMsg = err instanceof Error ? err.message : "Unknown error";

      // Produce a specific failure reason so logs and UI are actionable.
      let failureReason: string;
      if (statusCode === 403) {
        failureReason =
          "Account Risk Settings permission denied (HTTP 403). " +
          "Verify the OAuth token was issued with 'Account Risk Settings: Full Access'.";
      } else if (statusCode === 401) {
        failureReason = "OAuth token unauthorized (HTTP 401) — re-authorize to reconnect.";
      } else if (errCode === "NO_ACCOUNT_ID") {
        failureReason =
          "Tradovate account ID not resolved. " +
          "Ensure externalAccountId is saved (re-sync to refresh).";
      } else if (errCode === "NETWORK_ERROR") {
        failureReason = "Network error reaching Tradovate API.";
      } else {
        failureReason = `${errCode}: ${errMsg}`;
      }

      brokerLockStatus = "broker_lock_failed";
      outcome = "broker_lock_failed";
      message =
        `Broker lock attempt failed: ${failureReason} ` +
        "Guardrail is monitoring and alerting only.";

      console.error("[enforcement] broker lock failed", {
        accountId,
        trigger,
        errCode,
        statusCode,
        failureReason,
      });
    }
  } else if (account?.platform === "tradovate" && trigger === "trade_limit") {
    // ── Trade limit: no account-wide order block in userAccountAutoLiq ────
    brokerLockStatus = "monitoring_only";
    outcome = "monitoring_only";
    message =
      "Broker-side enforcement not available for trade-count limits. " +
      "Tradovate's userAccountAutoLiq API does not expose a max-trades-per-day field. " +
      "Order cancellation (Orders Full Access) would be required for hard enforcement. " +
      "Broker blocking is not active yet. Guardrail is monitoring and alerting only.";
  } else {
    // ── Non-Tradovate platform or unsupported trigger ─────────────────────
    brokerLockStatus = "monitoring_only";
    outcome = "monitoring_only";
    message =
      "Broker blocking is not active yet. Guardrail is monitoring and alerting only.";
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
