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

export type SyncResult = {
  ok: boolean;
  accountId: string;
  /** Account balance (Tradovate cash-balance "amount"). null when unavailable. */
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

    // ── Balance & daily P&L ────────────────────────────────────────────────
    const snapshot = await client.toAccountSnapshot();
    const balance = snapshot.balance;
    const dailyPnl = snapshot.todayPnL;

    // ── Open positions → unrealised P&L ────────────────────────────────────
    let openPnl: number | null = null;
    try {
      const positions = await client.toPositions();
      if (positions.length > 0) {
        const sum = positions.reduce((s, p) => s + (p.unrealizedPnL ?? 0), 0);
        // Only set openPnl when at least one position has a value.
        const hasAnyPnl = positions.some((p) => p.unrealizedPnL !== null);
        openPnl = hasAnyPnl ? sum : null;
      }
    } catch {
      // Positions are best-effort; don't fail the whole sync.
    }

    const syncedAt = new Date();

    await prisma.connectedAccount.update({
      where: { id: accountId },
      data: {
        ...(balance != null ? { balance, cashBalance: balance } : {}),
        ...(openPnl != null ? { openPnl } : {}),
        lastSyncAt: syncedAt,
        errorMessage: null,
      },
    });

    // ── LiveSessionState: update dailyPnl if we have broker data ──────────
    if (dailyPnl != null) {
      const today = new Date().toISOString().slice(0, 10);
      const existing = await prisma.liveSessionState.findUnique({
        where: { accountId },
        select: { id: true, sessionDate: true },
      });
      if (existing && existing.sessionDate === today) {
        await prisma.liveSessionState.update({
          where: { accountId },
          data: { dailyPnl },
        });
      } else if (!existing) {
        await prisma.liveSessionState.create({
          data: {
            accountId,
            sessionDate: today,
            dailyPnl,
            tradesCount: 0,
            consecutiveLosses: 0,
            riskState: "NORMAL",
          },
        });
        // If the existing session is from a previous day, leave it alone — the
        // guardian will reset it on the next event.
      }
    }

    // ── Today's fills → NormalizedTradeEvent (best-effort) ─────────────────
    try {
      const executions = await client.toExecutions();
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

    console.info("[tradovate/sync] account sync succeeded", {
      accountId,
      hasBalance: balance != null,
      hasOpenPnl: openPnl != null,
      hasDailyPnl: dailyPnl != null,
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
 * Results are returned in the same order as the DB query — accounts that
 * fail individually return ok=false entries rather than throwing.
 */
export async function syncTradovateConnection(
  connectionId: string,
  userId: string,
): Promise<SyncResult[]> {
  const accounts = await prisma.connectedAccount.findMany({
    where: {
      brokerConnectionId: connectionId,
      userId,
      isActive: true,
      platform: "tradovate",
    },
    select: { id: true },
    orderBy: { label: "asc" },
  });

  const settled = await Promise.allSettled(
    accounts.map((a) => syncTradovateAccount(a.id, userId)),
  );

  return settled.map((r, i): SyncResult => {
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
}
