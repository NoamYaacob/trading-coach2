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
import { deriveCmeTradingDayKey, deriveCmeTradingDaySessionStart } from "@/lib/trading-day";
import { sumFillPnl, traceEntryTrades } from "./tradovate-client-helpers";
import { resolveTradeCount, type TradeCountAdapter } from "./tradovate-trade-count";
import { triggerEnforcement, type EnforcementTrigger } from "./enforcement";

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

    // ── CME trading day key ───────────────────────────────────────────────
    // CME Globex daily sessions start at 17:00 America/Chicago (5PM CT).
    // Using the CT session date (not UTC or Israel local date) ensures that
    // isStale correctly detects the session rollover at 5PM CT regardless of
    // what timezone the server or user is in.
    const now = new Date();
    const tradingDayKey = deriveCmeTradingDayKey(now);
    const sessionStartMs = deriveCmeTradingDaySessionStart(now).getTime();
    console.info("[tradovate/sync] CME trading day", {
      accountId,
      tradingDayKey,
      sessionStartUtc: new Date(sessionStartMs).toISOString(),
    });

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

    // ── Today's trades and fills ──────────────────────────────────────────────
    let tradesCount = 0;
    let pnlFromFills: number | null = null;
    let fillsSyncedAt: Date | null = null;
    // Defaults to "unavailable" so a fills-fetch failure correctly downgrades
    // tradesCount; flipped to "verified"/"estimated" once fills are processed.
    let tradeCountSource: "verified" | "estimated" | "unavailable" = "unavailable";

    // Phase A: count completed orders (best-effort).
    // NOTE: order/list on many Tradovate environments only returns active/working orders,
    // not completed ones. Phase B fills are the authoritative count source. Phase A is kept
    // as a secondary signal — its count is only used when fills return fewer (which shouldn't
    // happen in practice, but avoids accidentally reducing the count on API inconsistencies).
    try {
      const completedOrders = await client.getCompletedOrdersToday(sessionStartMs);
      tradesCount = completedOrders.length;
      console.info("[tradovate/trades] count from completed orders", {
        accountId,
        tradesCount,
        orderIds: completedOrders.map((o) => o.id),
      });
    } catch (ordErr) {
      console.warn("[tradovate/trades] completed orders failed, will try fills", {
        accountId,
        error: ordErr instanceof Error ? ordErr.message : "unknown",
      });
    }

    // Phase B: fills — used for P&L sum + NormalizedTradeEvent storage. The
    // tradesCount itself is resolved separately in Phase C below via the
    // multi-source resolver, which can prefer Tradovate's Performance Report
    // or an account-scoped endpoint over the unscoped fill/list dump.
    type CachedFills = {
      executions: Awaited<ReturnType<typeof client.toExecutions>>;
      derivedCount: number;
    } | null;
    let cachedFills: CachedFills = null;
    try {
      const executions = await client.toExecutions(sessionStartMs);
      pnlFromFills = sumFillPnl(executions.map((ex) => ex.pnl));
      fillsSyncedAt = new Date();

      const trace = traceEntryTrades(executions);
      cachedFills = { executions, derivedCount: trace.count };

      console.info("[tradovate/trades] fills phase diagnostic", {
        accountId,
        rawFillCount: executions.length,
        uniqueOrderIds: trace.uniqueOrderIds,
        groupedOrderCount: trace.groupedCount,
        derivedEntryTradeCount: trace.count,
        fillsScopingVerdict: client.getLastFillsScopingVerdict(),
        pnlFromFills,
      });
      for (const row of trace.rows) {
        console.info("[tradovate/trades] order row", {
          accountId,
          orderId: row.orderId,
          symbol: row.symbol,
          side: row.side,
          qty: row.qty,
          positionBefore: row.positionBefore,
          positionAfter: row.positionAfter,
          entry: row.entry,
          reason: row.reason,
        });
      }
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
      // Fill storage is best-effort. If Phase A also failed, fillsSyncedAt
      // remains null — the UI will show "Trades unavailable" instead of 0.
    }

    // Phase C: resolve the authoritative per-account trade count by trying
    // multiple sources in order of trustworthiness:
    //   1. Tradovate Performance Report (broker_report)
    //   2. order/deps?masterid={tvAccountId} (account-scoped at API; spec confirmed)
    //   3. Cached fill/list count → marked "estimated" (no account-scoped fills endpoint)
    // See tradovate-trade-count.ts for the orchestration logic.
    const adapter: TradeCountAdapter = {
      getAccountName: () => client.getAccountName(),
      fetchPerformanceReport: (input) =>
        client.fetchPerformanceReport({ accountName: input.accountName, tradingDayKey }),
      fetchAccountScopedOrders: () => client.fetchAccountScopedOrders(sessionStartMs),
      fetchUnscopedFillsFallback: async () => {
        if (cachedFills == null) return null;
        const verdict = client.getLastFillsScopingVerdict();
        return {
          count: cachedFills.derivedCount,
          endpoint: `fill/list (cached, verdict=${verdict})`,
        };
      },
    };
    const resolved = await resolveTradeCount(adapter, { tradingDayKey });
    tradesCount = resolved.count ?? 0;
    tradeCountSource = resolved.trustLevel;

    console.info("[tradovate/trades] resolver result", {
      accountId,
      count: resolved.count,
      source: resolved.source,
      trustLevel: resolved.trustLevel,
      finalTradeCountSource: tradeCountSource,
      attempts: resolved.attempts,
    });

    // Persist fillsSyncedAt separately (it's set inside the try block above).
    if (fillsSyncedAt != null) {
      await prisma.connectedAccount
        .update({ where: { id: accountId }, data: { fillsSyncedAt } })
        .catch(() => {});
    }

    // Use snapshot P&L when available; fall back to summing fill profits.
    const resolvedDailyPnl = dailyPnl ?? pnlFromFills;
    console.info("[tradovate/pnl] resolved daily P&L", {
      accountId,
      fromSnapshot: dailyPnl,
      fromFills: pnlFromFills,
      resolved: resolvedDailyPnl,
    });

    // ── Load risk rules for riskState computation ─────────────────────────
    const [accountRules, defaultRules] = await Promise.all([
      prisma.accountRiskRules.findUnique({
        where: { accountId },
        select: { maxDailyLoss: true, maxTradesPerDay: true },
      }),
      prisma.riskRules.findUnique({
        where: { userId },
        select: {
          maxDailyLoss: true,
          maxTradesPerDay: true,
          dailyProfitTarget: true,
          tradingDays: true,
        },
      }),
    ]);
    const effectiveMaxDailyLoss =
      accountRules?.maxDailyLoss != null
        ? Number(accountRules.maxDailyLoss)
        : defaultRules?.maxDailyLoss != null
          ? Number(defaultRules.maxDailyLoss)
          : null;
    const effectiveMaxTrades =
      accountRules?.maxTradesPerDay ?? defaultRules?.maxTradesPerDay ?? null;
    // Profit target and trading days are user-level settings only (no per-account override yet).
    const effectiveProfitTarget =
      defaultRules?.dailyProfitTarget != null
        ? Number(defaultRules.dailyProfitTarget)
        : null;

    // Determine whether today (in CME/Chicago time) is a configured trading day.
    // tradingDays is stored as a comma-separated string of 3-letter codes: "MON,TUE,WED,THU,FRI".
    // null or empty string means no restriction — any day is allowed.
    const selectedTradingDays = defaultRules?.tradingDays
      ? defaultRules.tradingDays.split(",").map((d) => d.trim()).filter(Boolean)
      : null;
    const cmeDayCode = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      weekday: "long",
    })
      .format(now)
      .toUpperCase()
      .slice(0, 3); // "MON"|"TUE"|"WED"|"THU"|"FRI"|"SAT"|"SUN"
    const isTradingDayDisabled =
      selectedTradingDays !== null &&
      selectedTradingDays.length > 0 &&
      !selectedTradingDays.includes(cmeDayCode);

    const lossUsed =
      resolvedDailyPnl != null ? Math.abs(Math.min(resolvedDailyPnl, 0)) : null;
    const lossPct =
      effectiveMaxDailyLoss != null && effectiveMaxDailyLoss > 0 && lossUsed != null
        ? Math.min(1, lossUsed / effectiveMaxDailyLoss)
        : null;

    // Trade-limit checks are only authoritative when tradeCountSource is
    // "verified" — an estimated/unavailable count must NOT trigger a broker
    // lock or a "locked" status, since it may include fills from other
    // accounts on the same OAuth token.
    const tradeCountIsAuthoritative = tradeCountSource === "verified";

    let newRiskState: "NORMAL" | "WARNING" | "STOPPED" = "NORMAL";
    let enforcementTrigger: EnforcementTrigger | null = null;
    if (isTradingDayDisabled) {
      // Today is not a selected trading day — lock immediately.
      newRiskState = "STOPPED";
      enforcementTrigger = "trading_day_disabled";
    } else if (lossPct != null && lossPct >= 1.0) {
      newRiskState = "STOPPED";
      enforcementTrigger = "daily_loss_limit";
    } else if (
      effectiveProfitTarget != null &&
      effectiveProfitTarget > 0 &&
      resolvedDailyPnl != null &&
      resolvedDailyPnl >= effectiveProfitTarget
    ) {
      // Profit target reached — lock for the day (internal lock only; no Tradovate API).
      newRiskState = "STOPPED";
      enforcementTrigger = "profit_target";
    } else if (
      tradeCountIsAuthoritative &&
      effectiveMaxTrades != null &&
      tradesCount >= effectiveMaxTrades
    ) {
      newRiskState = "STOPPED";
      enforcementTrigger = "trade_limit";
    } else if (
      (lossPct != null && lossPct >= 0.8) ||
      (tradeCountIsAuthoritative &&
        effectiveMaxTrades != null &&
        effectiveMaxTrades > 1 &&
        tradesCount === effectiveMaxTrades - 1)
    ) {
      newRiskState = "WARNING";
    }

    // ── LiveSessionState: update dailyPnl, tradesCount, and riskState ─────
    // tradingDayKey uses the CME Globex session date (rolls at 5PM America/Chicago),
    // not the UTC or server calendar date. This ensures the session is correctly
    // reset at the futures market session boundary rather than at UTC midnight.
    const existing = await prisma.liveSessionState.findUnique({
      where: { accountId },
      select: { id: true, sessionDate: true, riskState: true },
    });
    const prevRiskState = existing?.riskState ?? "NORMAL";
    const isStale = existing ? existing.sessionDate !== tradingDayKey : false;

    if (existing) {
      await prisma.liveSessionState.update({
        where: { accountId },
        data: {
          ...(isStale ? { sessionDate: tradingDayKey } : {}),
          tradesCount,
          tradeCountSource,
          riskState: newRiskState,
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
          sessionDate: tradingDayKey,
          dailyPnl: resolvedDailyPnl ?? 0,
          tradesCount,
          tradeCountSource,
          consecutiveLosses: 0,
          riskState: newRiskState,
        },
      });
    }

    // ── Trigger enforcement on STOPPED transition ──────────────────────────
    if (enforcementTrigger != null && prevRiskState !== "STOPPED" && newRiskState === "STOPPED") {
      const reason =
        enforcementTrigger === "daily_loss_limit"
          ? "Daily loss limit reached"
          : enforcementTrigger === "profit_target"
            ? `Daily profit target reached: $${resolvedDailyPnl?.toFixed(2) ?? "unknown"}`
            : enforcementTrigger === "trading_day_disabled"
              ? `Today (${cmeDayCode}) is not a selected trading day`
              : `Trade limit reached: ${tradesCount}${effectiveMaxTrades != null ? `/${effectiveMaxTrades}` : ""}`;
      triggerEnforcement({
        accountId,
        userId,
        trigger: enforcementTrigger,
        reason,
        // Pass current loss so the broker threshold is set exactly at the amount
        // already lost — ensuring the account is immediately past the limit.
        currentDailyLoss: lossUsed,
      }).catch((err) => {
        console.error("[enforcement] trigger failed", { accountId, error: err });
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
        console.info("[tradovate/sync] discovery + reconciliation succeeded", {
          connectionId,
          discoveredCount: discovered.length,
          newlyCreatedCount: newlyCreatedIds.length,
          missingCount: missingIds.length,
        });
      } else {
        discoveryOk = false;
        console.warn("[tradovate/sync] discovery returned null — skipping reconciliation", {
          connectionId,
          note: "Local missingFromBrokerSince flags are preserved from the previous successful sync.",
        });
      }
    } else {
      discoveryOk = false;
      console.warn("[tradovate/sync] discovery preconditions not met", {
        connectionId,
        hasConnection: connection != null,
        configReady: cfg.state === "ready",
      });
    }
  } catch (err) {
    discoveryOk = false;
    console.error("[tradovate/sync] discovery failed", {
      connectionId,
      msg: err instanceof Error ? err.message : "unknown",
    });
  }

  // ── 2. Sync only protected + monitor_only accounts ──────────────────────
  // Accounts the broker no longer returns are excluded — their cached state
  // is stale and re-fetching would just emit warnings against missing accounts.
  // They will be re-included automatically the next time discovery returns
  // them (reconcileDiscoveredAccounts clears missingFromBrokerSince).
  const accounts = await prisma.connectedAccount.findMany({
    where: {
      brokerConnectionId: connectionId,
      userId,
      isActive: true,
      platform: "tradovate",
      protectionStatus: { in: ["protected", "monitor_only"] },
      missingFromBrokerSince: null,
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
