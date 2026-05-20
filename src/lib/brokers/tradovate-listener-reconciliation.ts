/**
 * Reconnect reconciliation for the Tradovate listener-worker.
 *
 * When the WebSocket listener reconnects after a close (1000 Bye, 1006
 * abnormal, auth refresh, or worker restart), there is a window during which
 * fills/trades may have occurred that were not observed by the listener.
 *
 * This module runs a safe REST reconciliation for all active Tradovate
 * accounts on a connection. It calls `syncTradovateAccount`, which is
 * idempotent — it checks the DB before inserting NormalizedTradeEvent rows,
 * so duplicate fills cannot be created.
 *
 * Safety constraints (hard):
 *   - No broker writes.
 *   - No Tradovate order/flatten/cancel actions.
 *   - No enforcement behaviour changes.
 *   - No calls to maybeAttemptBrokerDailyLossLockoutForInternalLock.
 *   - No live accounts touched beyond read-only balance/fill REST calls.
 */

import { prisma } from "../db.ts";
import { syncTradovateAccount } from "./tradovate-sync.ts";

// ── Types ────────────────────────────────────────────────────────────────────

export type ReconciliationTrigger = "initial_connect" | "reconnect";
export type ReconciliationStatus = "success" | "skipped" | "failed";

export type ReconciliationResult = {
  status: ReconciliationStatus;
  accountCount: number;
  /** Set when status is "failed". Truncated to first 3 errors. */
  error?: string;
};

// ── Core ─────────────────────────────────────────────────────────────────────

/**
 * Run fill/trade reconciliation for all active Tradovate accounts on a
 * broker connection. Called after a listener reconnects or on initial connect
 * (covers worker restarts, which are equivalent to "gap since last run").
 *
 * Returns "skipped" when the connection has no active accounts.
 * Returns "failed" only when ALL accounts fail; partial success → "success".
 */
export async function reconcileConnectionAccounts(
  connectionId: string,
  userId: string,
): Promise<ReconciliationResult> {
  const accounts = await prisma.connectedAccount.findMany({
    where: {
      brokerConnectionId: connectionId,
      platform: "tradovate",
      isActive: true,
    },
    select: { id: true },
  });

  if (accounts.length === 0) {
    return { status: "skipped", accountCount: 0 };
  }

  const errors: string[] = [];
  for (const account of accounts) {
    try {
      await syncTradovateAccount(account.id, userId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(msg);
      console.error("[reconciliation] syncTradovateAccount failed", {
        connectionId,
        accountId: account.id,
        error: msg,
      });
    }
  }

  if (errors.length > 0 && errors.length === accounts.length) {
    return {
      status: "failed",
      accountCount: accounts.length,
      error: errors.slice(0, 3).join("; "),
    };
  }
  return { status: "success", accountCount: accounts.length };
}

/**
 * Persist reconciliation result fields onto the BrokerConnection row.
 * Diagnostics only — no broker enforcement behaviour reads these fields.
 */
export async function writeReconciliationResult(
  connectionId: string,
  trigger: ReconciliationTrigger,
  result: ReconciliationResult,
): Promise<void> {
  await prisma.brokerConnection.update({
    where: { id: connectionId },
    data: {
      lastReconciliationAt: new Date(),
      lastReconciliationTrigger: trigger,
      lastReconciliationStatus: result.status,
      lastReconciliationError: result.error ?? null,
      lastReconciledAccountCount: result.accountCount,
    },
  });
}
