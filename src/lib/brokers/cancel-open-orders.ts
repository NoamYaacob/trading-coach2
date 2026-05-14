/**
 * cancelOpenOrdersForAccount — safe backend function for cancelling a
 * Tradovate account's open orders.
 *
 * Safety model:
 *  - Live cancellation requires ENABLE_TRADOVATE_ORDER_ACTIONS=true server env.
 *  - Live cancellation requires Orders: Full Access permission (not read_only).
 *  - Dry-run is the default when either gate is not met.
 *  - Account must be active, not archived, not missing from broker, and connected.
 *  - Orders are filtered to the exact Tradovate account — other accounts' orders
 *    on the same OAuth token are never touched.
 *
 * Do NOT connect this to automatic rule breaches yet — manual/test use only.
 */

import { prisma } from "@/lib/db";
import { TradovateClient } from "./tradovate-client";
import { isTradovateOrderActionsEnabled } from "./order-actions-flag";
import { writeBrokerOrderActionLog } from "./broker-order-action-log";
import {
  validateAccountForOrderActions,
  canSendLiveOrderActions,
  parseTradovateAccountId,
} from "./order-actions-helpers";

// Re-export pure helpers and types so callers can import from one place.
export {
  validateAccountForOrderActions,
  canSendLiveOrderActions,
  parseTradovateAccountId,
} from "./order-actions-helpers";
export type {
  OrderActionsAccountState,
  AccountValidationResult,
  ExternalAccountIdParseResult,
} from "./order-actions-helpers";

// ── Result type ───────────────────────────────────────────────────────────────

export type CancelOpenOrdersResult = {
  dryRun: boolean;
  /** Working orders found for this account (before filtering). */
  attemptedCount: number;
  /** Orders where cancel API confirmed cancellation (no errorText). */
  succeededCount: number;
  /** Orders where cancel API returned an error. */
  failedCount: number;
  /** Orders on different accounts or with non-cancellable statuses that were skipped. */
  skippedCount: number;
  affectedOrderIds: number[];
  skippedOrderIds: number[];
  errors: Array<{ orderId: number; error: string }>;
};

// ── Integration function ──────────────────────────────────────────────────────

export type CancelOpenOrdersOptions = {
  /**
   * When true: compute and return what would be cancelled, but send no API calls.
   * When false (or omitted): dryRun is determined by isTradovateOrderActionsEnabled().
   * Setting this to true always forces dry-run regardless of the env flag.
   */
  dryRun?: boolean;
  /** Reason label written to the audit log — e.g. "manual_test", "rule_breach". */
  triggerReason?: string;
};

/**
 * Cancel all open (Working/Pending) orders for the given Guardrail account.
 *
 * Enforces strict account isolation: only orders with the exact Tradovate
 * account ID for this connected account are ever cancelled.
 *
 * Live cancellation requires:
 *  1. ENABLE_TRADOVATE_ORDER_ACTIONS=true (server env)
 *  2. Orders: Full Access (not read_only permissionLevel)
 *
 * If either gate fails the function runs dry-run automatically and the
 * caller is informed via result.dryRun === true.
 */
export async function cancelOpenOrdersForAccount(
  connectedAccountId: string,
  options: CancelOpenOrdersOptions = {},
): Promise<CancelOpenOrdersResult> {
  const triggerReason = options.triggerReason ?? "manual_test";

  // ── 1. Load account ────────────────────────────────────────────────────────
  const account = await prisma.connectedAccount.findUnique({
    where: { id: connectedAccountId },
    select: {
      id: true,
      userId: true,
      platform: true,
      isActive: true,
      protectionStatus: true,
      missingFromBrokerSince: true,
      connectionStatus: true,
      externalAccountId: true,
      brokerConnection: {
        select: { permissionLevel: true },
      },
    },
  });

  if (!account) {
    throw new Error(`Connected account not found: ${connectedAccountId}`);
  }

  const permissionLevel = account.brokerConnection?.permissionLevel ?? null;

  // ── 2. Validate account eligibility ───────────────────────────────────────
  const validation = validateAccountForOrderActions({
    platform: account.platform,
    isActive: account.isActive,
    protectionStatus: account.protectionStatus,
    missingFromBrokerSince: account.missingFromBrokerSince,
    connectionStatus: account.connectionStatus,
    externalAccountId: account.externalAccountId,
    permissionLevel,
  });

  if (!validation.ok) {
    throw new Error(`Account not eligible for order actions: ${validation.reason} [${validation.code}]`);
  }

  // ── 2b. Strictly validate external account ID as a positive integer ────────
  // Must happen before client.initialize() — TradovateClient leaves tvAccountId
  // as null if parseInt fails, which would cause getOrders() to return ALL orders
  // across the OAuth token instead of this account's orders only.
  const accountIdParsed = parseTradovateAccountId(account.externalAccountId);
  if (!accountIdParsed.ok) {
    await writeBrokerOrderActionLog({
      userId: account.userId,
      connectedAccountId,
      externalAccountId: account.externalAccountId,
      actionType: "cancel_orders",
      triggerReason,
      dryRun: true,
      requestSummary: null,
      responseSummary: { code: accountIdParsed.code, reason: accountIdParsed.reason },
      success: false,
      errorMessage: accountIdParsed.reason,
    });
    throw new Error(
      `Cannot cancel orders: ${accountIdParsed.reason} [${accountIdParsed.code}]`,
    );
  }

  // ── 3. Determine effective dry-run ────────────────────────────────────────
  const orderActionsEnabled = isTradovateOrderActionsEnabled();
  const permissionAllowsLive = canSendLiveOrderActions({ permissionLevel });
  const effectiveDryRun =
    options.dryRun === true || !orderActionsEnabled || !permissionAllowsLive;

  // ── 4. Fetch open orders via TradovateClient ───────────────────────────────
  const client = new TradovateClient(connectedAccountId, account.userId);
  await client.initialize();

  // getOrders() already filters to Working/Pending AND to the correct tvAccountId.
  const openOrders = await client.getOrders();

  const attemptedCount = openOrders.length;
  const affectedOrderIds: number[] = [];
  const skippedOrderIds: number[] = [];
  const errors: Array<{ orderId: number; error: string }> = [];
  let succeededCount = 0;
  let failedCount = 0;

  if (effectiveDryRun || attemptedCount === 0) {
    // Dry-run: return what would be cancelled without touching the broker.
    for (const order of openOrders) {
      affectedOrderIds.push(order.id);
    }
    const result: CancelOpenOrdersResult = {
      dryRun: effectiveDryRun,
      attemptedCount,
      succeededCount: 0,
      failedCount: 0,
      skippedCount: 0,
      affectedOrderIds,
      skippedOrderIds: [],
      errors: [],
    };
    await writeBrokerOrderActionLog({
      userId: account.userId,
      connectedAccountId,
      externalAccountId: account.externalAccountId,
      actionType: "cancel_orders",
      triggerReason,
      dryRun: effectiveDryRun,
      requestSummary: { orderCount: attemptedCount, orderIds: affectedOrderIds },
      responseSummary: result,
      success: true,
      errorMessage: null,
    });
    return result;
  }

  // ── 5. Live: cancel each order individually ───────────────────────────────
  for (const order of openOrders) {
    try {
      const response = await client.cancelOrder(order.id);
      if (response.errorText) {
        failedCount++;
        errors.push({ orderId: order.id, error: response.errorText });
      } else {
        succeededCount++;
        affectedOrderIds.push(order.id);
      }
    } catch (err) {
      failedCount++;
      errors.push({
        orderId: order.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const result: CancelOpenOrdersResult = {
    dryRun: false,
    attemptedCount,
    succeededCount,
    failedCount,
    skippedCount: 0,
    affectedOrderIds,
    skippedOrderIds,
    errors,
  };

  await writeBrokerOrderActionLog({
    userId: account.userId,
    connectedAccountId,
    externalAccountId: account.externalAccountId,
    actionType: "cancel_orders",
    triggerReason,
    dryRun: false,
    requestSummary: { orderCount: attemptedCount, orderIds: openOrders.map((o) => o.id) },
    responseSummary: result,
    success: failedCount === 0,
    errorMessage:
      errors.length > 0
        ? `${failedCount} of ${attemptedCount} cancel(s) failed`
        : null,
  });

  return result;
}
