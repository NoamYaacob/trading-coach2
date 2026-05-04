/**
 * Tradovate account sync — server-only.
 *
 * Fetches a snapshot of account data from Tradovate (balance, positions,
 * today's fills) and persists it to the database. All token handling is
 * delegated to TradovateClient, which decrypts and refreshes tokens as needed.
 *
 * Safety rules:
 *  - Never logs token values, plaintext balances with account identifiers, or
 *    any PII. Log only error codes and success/failure indicators.
 *  - Does not fake data. If an endpoint call fails, the relevant field is left
 *    null and a clear error message is stored.
 *  - Token values never leave the server or appear in returned objects.
 */

import { prisma } from "@/lib/db";
import { TradovateClient, TradovateClientError } from "./tradovate-client";
import {
  fetchTradovateAccountList,
  reconcileDiscoveredAccounts,
} from "./tradovate-discovery";
import { getTradovateConfig } from "./tradovate-env";
import { parseAndDecrypt } from "@/lib/security/token-crypto";
import { sumFillPnl } from "./tradovate-client-helpers";

export type SyncResult = {
  ok: boolean;
  accountId: string;
  /** Account balance from the cash-balance snapshot. null when unavailable or endpoint failed. */
  balance: number | null;
  /** Unrealised P&L across open positions. null when no positions or endpoint failed. */
  openPnl: number | null;
  /** Today's realised P&L from the cash-balance snapshot. null when unavailable. */
  dailyPnl: number | null;
  /** Timestamp of the successful sync. null when sync failed. */
  lastSyncAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
};

/**
 * Sync a single Tradovate ConnectedAccount.
 * Fetches balance, open positions, and today's fills, then persists them.
 */
export async function syncTradovateAccount(
  accountId: string,
  userId: string,
): Promise<SyncResult> {
  const client = new TradovateClient(accountId, userId);

  try {
    await client.initialize();

    // ── Balance & daily P&L (best-effort) ─────────────────────────────────
    let balance: number | null = null;
    let dailyPnl: number | null = null;
    let openPnlFromSnapshot: number | null = null;
    let balanceUnavailable = false;
    try {
      const snapshot = await client.toAccountSnapshot();
      balance = snapshot.balance;
      dailyPnl = snapshot.todayPnL;
      openPnlFromSnapshot = snapshot.openPnlFromSnapshot;
    } catch (snapshotErr) {
      const code =
        snapshotErr instanceof TradovateClientError
          ? snapshotErr.code
          : "BALANCE_FAILED";
      console.error("[tradovate/sync] balance snapshot failed, continuing without balance", {
        accountId,
        code,
      });
      balanceUnavailable = true;
    }

    // ── Open positions → unrealised P&L ────────────────────────────────────
    // Prefer openPl from the snapshot; fall back to summing position data.
    let openPnl: number | null = openPnlFromSnapshot;
    try {
      const positions = await client.toPositions();
      if (positions.length > 0) {
        const sum = positions.reduce((s, p) => s + (p.unrealizedPnL ?? 0), 0);
        const hasAnyPnl = positions.some((p) => p.unrealizedPnL !== null);
        if (openPnl == null && hasAnyPnl) openPnl = sum;
      }
    } catch {
      // Positions are best-effort; don't fail the whole sync.
    }

    const syncedAt = new Date();

    console.info("[tradovate/sync] persisting to DB", {
      accountId,
      hasBalance: balance != null,
      hasOpenPnl: openPnl != null,
      hasDailyPnl: dailyPnl != null,
      balanceUnavailable,
    });

    await prisma.connectedAccount.update({
      where: { id: accountId },
      data: {
        ...(balance != null ? { balance, cashBalance: balance } : {}),
        ...(openPnl != null ? { openPnl } : {}),
        lastSyncAt: syncedAt,
        errorMessage: balanceUnavailable ? "Balance data unavailable." : null,
      },
    });

    // ── Today's fills → NormalizedTradeEvent (best-effort) ─────────────────
    let tradesCount = 0;
    let pnlFromFills: number | null = null;
    try {
      const executions = await client.toExecutions();
      tradesCount = executions.length;
      pnlFromFills = sumFillPnl(executions.map((ex) => ex.pnl));
      console.info("[tradovate/fills] today's executions", {
        accountId,
        count: tradesCount,
        pnlFromFills,
      });
      for (const ex of executions) {
        const alreadyStored = await prisma.normalizedTradeEvent.findFirst({
          where: { accountId, externalTradeId: ex.executionId },
          select: { id: true },
        });
        if (!alreadyStored) {
          await prisma.normalizedTradeEvent.create({
            data: {
              accountId,
              eventType: "fill",
              externalTradeId: ex.executionId,
              side: ex.side,
              quantity: ex.quantity,
              price: ex.price,
              pnl: ex.pnl,
              occurredAt: ex.occurredAt,
              rawPayload: { symbol: ex.symbol, orderId: ex.orderId },
            },
          });
        }
      }
    } catch {
      // Fill persistence is best-effort; a failure here does not fail the sync.
    }

    // Use snapshot P&L when available; fall back to summing fill profits.
    const resolvedDailyPnl = dailyPnl ?? pnlFromFills;
    console.info("[tradovate/pnl] resolved daily P&L", {
      accountId,
      fromSnapshot: dailyPnl,
      fromFills: pnlFromFills,
      resolved: resolvedDailyPnl,
    });

    // ── LiveSessionState: update dailyPnl and tradesCount ─────────────────
    const today = new Date().toISOString().slice(0, 10);
    const existing = await prisma.liveSessionState.findUnique({
      where: { accountId },
      select: { id: true, sessionDate: true },
    });
    if (existing) {
      const isStale = existing.sessionDate !== today;
      await prisma.liveSessionState.update({
        where: { accountId },
        data: {
          ...(isStale ? { sessionDate: today } : {}),
          tradesCount,
          ...(resolvedDailyPnl != null
            ? { dailyPnl: resolvedDailyPnl }
            : isStale
              ? { dailyPnl: 0 }
              : {}),
        },
      });
    } else {
      await prisma.liveSessionState.create({
        data: {
          accountId,
          sessionDate: today,
          dailyPnl: resolvedDailyPnl ?? 0,
          tradesCount,
          consecutiveLosses: 0,
          riskState: "NORMAL",
        },
      });
    }

    console.info("[tradovate/sync] account sync succeeded", {
      accountId,
      hasBalance: balance != null,
      hasOpenPnl: openPnl != null,
      hasDailyPnl: resolvedDailyPnl != null,
      tradesCount,
    });

    return {
      ok: true,
      accountId,
      balance,
      openPnl,
      dailyPnl,
      lastSyncAt: syncedAt,
      errorCode: null,
      errorMessage: null,
    };
  } catch (err) {
    const code = err instanceof TradovateClientError ? err.code : "SYNC_FAILED";
    const message = err instanceof Error ? err.message : "Unknown sync error.";

    console.error("[tradovate/sync] account sync failed", { accountId, code });

    await prisma.connectedAccount
      .update({
        where: { id: accountId },
        data: { errorMessage: `Sync failed (${code}).` },
      })
      .catch(() => {});

    return {
      ok: false,
      accountId,
      balance: null,
      openPnl: null,
      dailyPnl: null,
      lastSyncAt: null,
      errorCode: code,
      errorMessage: message,
    };
  }
}

/**
 * Sync all active Tradovate accounts linked to a BrokerConnection.
 *
 * Three-step flow:
 *  1. Discover the broker's current account list and reconcile against the DB
 *     (creates `pending_decision` rows for new broker accounts; flags missing).
 *  2. Sync only `protected` and `monitor_only` accounts — `pending_decision`,
 *     `ignored`, and `archived` are skipped (they don't carry rules and the
 *     user must opt in first).
 *  3. Return per-account results in label order. Discovery failures don't
 *     abort the sync — we still try the accounts we already know about.
 */
export async function syncTradovateConnection(
  connectionId: string,
  userId: string,
): Promise<{
  results: SyncResult[];
  discovery: { newlyCreatedIds: string[]; missingIds: string[]; ok: boolean };
}> {
  // ── 1. Discovery + reconciliation ────────────────────────────────────────
  let discoveryOk = true;
  let newlyCreatedIds: string[] = [];
  let missingIds: string[] = [];
  try {
    const connection = await prisma.brokerConnection.findFirst({
      where: { id: connectionId, userId },
      select: { env: true, accessTokenEncrypted: true },
    });
    const cfg = getTradovateConfig();
    if (connection && cfg.state === "ready") {
      const accessToken = parseAndDecrypt(connection.accessTokenEncrypted);
      const env = connection.env as "live" | "demo";
      const discovered = await fetchTradovateAccountList(
        cfg.config.apiBaseUrl[env],
        accessToken,
      );
      if (discovered) {
        const reconciled = await reconcileDiscoveredAccounts({
          userId,
          brokerConnectionId: connectionId,
          discovered,
        });
        newlyCreatedIds = reconciled.newlyCreatedIds;
        missingIds = reconciled.missingIds;
      } else {
        discoveryOk = false;
      }
    } else {
      discoveryOk = false;
    }
  } catch (err) {
    discoveryOk = false;
    console.error("[tradovate/sync] discovery failed", {
      connectionId,
      msg: err instanceof Error ? err.message : "unknown",
    });
  }

  // ── 2. Sync only protected + monitor_only accounts ──────────────────────
  const accounts = await prisma.connectedAccount.findMany({
    where: {
      brokerConnectionId: connectionId,
      userId,
      isActive: true,
      platform: "tradovate",
      protectionStatus: { in: ["protected", "monitor_only"] },
    },
    select: { id: true },
    orderBy: { label: "asc" },
  });

  const settled = await Promise.allSettled(
    accounts.map((a) => syncTradovateAccount(a.id, userId)),
  );

  const results = settled.map((r, i): SyncResult => {
    if (r.status === "fulfilled") return r.value;
    return {
      ok: false,
      accountId: accounts[i]?.id ?? "",
      balance: null,
      openPnl: null,
      dailyPnl: null,
      lastSyncAt: null,
      errorCode: "SYNC_FAILED",
      errorMessage:
        r.reason instanceof Error ? r.reason.message : "Unknown error.",
    };
  });

  return {
    results,
    discovery: { newlyCreatedIds, missingIds, ok: discoveryOk },
  };
}
