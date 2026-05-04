/**
 * Broker-side enforcement stubs.
 *
 * Real order-cancellation and position-flattening are not yet active.
 * Calling triggerEnforcement logs a GuardianIntervention and emits a
 * "not active" message so the timeline stays coherent when enforcement
 * is eventually wired to the Tradovate write API.
 */

import { prisma } from "@/lib/db";

export type EnforcementTrigger =
  | "daily_loss_limit"
  | "trade_limit"
  | "consecutive_losses"
  | "manual";

export type EnforcementContext = {
  accountId: string;
  userId: string;
  trigger: EnforcementTrigger;
  /** Short human-readable description of why enforcement fired */
  reason: string;
};

/** Stub — will cancel all open orders via broker API when implemented */
async function cancelAllOrders(_accountId: string): Promise<void> {
  // Not active yet
}

/** Stub — will flatten all open positions via broker API when implemented */
async function flattenPosition(_accountId: string): Promise<void> {
  // Not active yet
}

/**
 * Log a GuardianIntervention record and attempt enforcement actions.
 * Currently monitoring-only: actions are stubbed and the outcome is always
 * "monitoring_only" until broker write access is wired.
 */
export async function triggerEnforcement(ctx: EnforcementContext): Promise<void> {
  const message = "Broker blocking is not active yet. This event was logged for monitoring.";

  console.info("[enforcement] trigger fired", {
    accountId: ctx.accountId,
    trigger: ctx.trigger,
    reason: ctx.reason,
  });

  await prisma.guardianIntervention.create({
    data: {
      accountId: ctx.accountId,
      userId: ctx.userId,
      triggerType: ctx.trigger,
      outcome: "monitoring_only",
      message,
      sentAt: new Date(),
    },
  });

  // Stubs — no-ops until broker write API is connected
  await cancelAllOrders(ctx.accountId);
  await flattenPosition(ctx.accountId);
}
