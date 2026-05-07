/**
 * flattenPositionsForAccount — safe backend function for flattening (closing)
 * all open positions on a Tradovate account.
 *
 * Safety model:
 *  - Live flatten requires ENABLE_TRADOVATE_ORDER_ACTIONS=true server env.
 *  - Live flatten requires Orders: Full Access permission (not read_only).
 *  - Dry-run is the default when either gate is not met.
 *  - Account validation (active, connected, not archived/missing) is enforced
 *    identically to cancelOpenOrdersForAccount.
 *  - Delegates to TradovateClient.applyFlattenOpenPositions() which already
 *    handles account-scoped position reads, liquidatepositions payload, and
 *    read-back confirmation.
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
} from "./order-actions-helpers";
import type { BrokerFlattenResult } from "./enforcement-helpers";

// ── Result type ───────────────────────────────────────────────────────────────

export type FlattenPositionsResult = {
  dryRun: boolean;
  /**
   * "not_needed"   — no open positions; no write sent.
   * "flattened"    — read-back confirmed all positions flat.
   * "attempted"    — liquidatepositions accepted; read-back still shows open (order working).
   * "failed"       — request or read-back threw unexpectedly.
   * "dry_run"      — would have acted but dry-run gated the write.
   */
  flattenStatus: BrokerFlattenResult["flattenStatus"] | "dry_run";
  flattenMessage: string;
};

// ── Options ───────────────────────────────────────────────────────────────────

export type FlattenPositionsOptions = {
  /**
   * When true: compute what would be flattened but send no API calls.
   * When false (or omitted): dryRun is determined by isTradovateOrderActionsEnabled().
   * Setting this to true always forces dry-run regardless of the env flag.
   */
  dryRun?: boolean;
  /** Reason label written to the audit log — e.g. "manual_test", "rule_breach". */
  triggerReason?: string;
};

// ── Integration function ──────────────────────────────────────────────────────

/**
 * Flatten all open positions for the given Guardrail connected account.
 *
 * Delegates to TradovateClient.applyFlattenOpenPositions() for the actual
 * broker interaction; this wrapper adds account validation, flag gating,
 * permission checking, and audit logging.
 *
 * Live flatten requires:
 *  1. ENABLE_TRADOVATE_ORDER_ACTIONS=true (server env)
 *  2. Orders: Full Access (not read_only permissionLevel)
 *
 * If either gate fails the function runs dry-run automatically and the
 * caller is informed via result.dryRun === true.
 */
export async function flattenPositionsForAccount(
  connectedAccountId: string,
  options: FlattenPositionsOptions = {},
): Promise<FlattenPositionsResult> {
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
    throw new Error(
      `Account not eligible for order actions: ${validation.reason} [${validation.code}]`,
    );
  }

  // ── 3. Determine effective dry-run ────────────────────────────────────────
  const orderActionsEnabled = isTradovateOrderActionsEnabled();
  const permissionAllowsLive = canSendLiveOrderActions({ permissionLevel });
  const effectiveDryRun =
    options.dryRun === true || !orderActionsEnabled || !permissionAllowsLive;

  // ── 4. Initialize client ──────────────────────────────────────────────────
  const client = new TradovateClient(connectedAccountId, account.userId);
  await client.initialize();

  // ── 5. Dry-run: report what would happen without sending any API writes ───
  if (effectiveDryRun) {
    const result: FlattenPositionsResult = {
      dryRun: true,
      flattenStatus: "dry_run",
      flattenMessage: "Dry-run: flatten would be applied but no API call was made.",
    };
    await writeBrokerOrderActionLog({
      userId: account.userId,
      connectedAccountId,
      externalAccountId: account.externalAccountId,
      actionType: "flatten_positions",
      triggerReason,
      dryRun: true,
      requestSummary: {},
      responseSummary: { flattenStatus: "dry_run" },
      success: true,
      errorMessage: null,
    });
    return result;
  }

  // ── 6. Live: delegate to TradovateClient.applyFlattenOpenPositions() ──────
  const brokerResult = await client.applyFlattenOpenPositions();

  const result: FlattenPositionsResult = {
    dryRun: false,
    flattenStatus: brokerResult.flattenStatus,
    flattenMessage: brokerResult.flattenMessage,
  };

  const success =
    brokerResult.flattenStatus === "not_needed" ||
    brokerResult.flattenStatus === "flattened" ||
    brokerResult.flattenStatus === "attempted";

  await writeBrokerOrderActionLog({
    userId: account.userId,
    connectedAccountId,
    externalAccountId: account.externalAccountId,
    actionType: "flatten_positions",
    triggerReason,
    dryRun: false,
    requestSummary: brokerResult.flattenPayload ?? {},
    responseSummary: {
      flattenStatus: brokerResult.flattenStatus,
      flattenMessage: brokerResult.flattenMessage,
    },
    success,
    errorMessage: success ? null : brokerResult.flattenMessage,
  });

  return result;
}
