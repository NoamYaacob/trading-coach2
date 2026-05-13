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
import { ensureTradovateAccessToken } from "./tradovate-ensure-token";
import { runDiscoveryForConnection } from "./tradovate-discovery";
import { deriveCmeTradingDayKey, deriveCmeTradingDaySessionStart } from "@/lib/trading-day";
import { sumFillPnl, traceEntryTrades } from "./tradovate-client-helpers";
import { resolveTradeCount, selectPhaseCTradeCount, type TradeCountAdapter } from "./tradovate-trade-count";
import { parsePerformanceReportTradeCount } from "./tradovate-reports-parser";
import { countCanonicalEntries } from "@/lib/guardian-engine/session-state";
import { triggerEnforcement, type EnforcementTrigger } from "./enforcement";
import {
  computeEffectiveDailyPnl,
  getCmeHour,
  deriveSessionEndAction,
  isEnforcementDryRun,
  classifyFlattenError,
  type SessionEndBehavior,
  type BrokerFlattenResult,
} from "./enforcement-helpers";
import {
  deriveMaxPositionSizeBreach,
  type PositionExposureInput,
} from "./position-exposure";

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
    // toPositions() returns only non-zero netPos positions (already filtered).
    // Hoisted here (not scoped to the try block) so the same data feeds the
    // max-position-size enforcement check below.
    let openPnl: number | null = openPnlFromSnapshot;
    let hasOpenPositions = false;
    let openPositions: Awaited<ReturnType<typeof client.toPositions>> = [];
    try {
      openPositions = await client.toPositions();
      hasOpenPositions = openPositions.length > 0;
      if (hasOpenPositions) {
        const sum = openPositions.reduce((s, p) => s + (p.unrealizedPnL ?? 0), 0);
        const hasAnyPnl = openPositions.some((p) => p.unrealizedPnL !== null);
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
              contractId: ex.contractId ?? null,
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

    // Phase C: authoritative trade count.
    //
    // Priority 1 — Tradovate Performance Report (broker_report):
    //   POST /v1/reports/requestreport returns the same "# of Trades" shown in
    //   Tradovate's own UI. It is account-scoped, position-lifecycle-based, and
    //   matches the product definition exactly. Used when available.
    //
    // Priority 2 — Canonical DB count (fallback):
    //   Queries all fill-like events in the DB (both "fill" from sync and
    //   "trade_closed*" from the webhook), deduplicates by externalTradeId,
    //   sorts by (occurredAt, fillId) for stability, and counts only flat→nonflat
    //   position openings. Does NOT count scale-ins, matching Tradovate's report.
    //
    // Intentionally skipped: fetchAccountScopedOrders / order/deps — it counts
    // completed orders, not position lifecycle entries, inflating bracket-order
    // round trips to 4 instead of 1.
    let reportCount: number | null = null;
    try {
      const accountName = await client.getAccountName();
      if (accountName) {
        const report = await client.fetchPerformanceReport({ accountName, tradingDayKey });
        if (report && report.status >= 200 && report.status < 300) {
          const parsed = parsePerformanceReportTradeCount({
            body: report.body,
            contentType: report.contentType,
          });
          if (parsed != null) {
            reportCount = parsed;
            console.info("[tradovate/trades] Performance Report count (authoritative)", {
              accountId,
              count: parsed,
              source: "broker_report",
            });
          } else {
            console.warn("[tradovate/trades] Performance Report returned no parseable trade count", {
              accountId,
              httpStatus: report.status,
              bodyLength: report.body.length,
            });
          }
        }
      }
    } catch {
      // Performance Report is best-effort; fall through to DB canonical count.
    }

    {
      const canonical = reportCount == null
        ? await countCanonicalEntries(accountId, tradingDayKey, new Date(sessionStartMs))
        : null;
      if (canonical != null) {
        console.info("[tradovate/trades] canonical DB count (Performance Report unavailable)", {
          accountId,
          count: canonical.count,
          rawFillCount: cachedFills?.executions.length ?? null,
        });
      }
      const phaseC = selectPhaseCTradeCount(reportCount, canonical?.count ?? 0);
      tradesCount = phaseC.count;
      tradeCountSource = "verified";
      console.info("[tradovate/trades] Phase C resolved", {
        accountId,
        count: phaseC.count,
        source: phaseC.source,
      });
    }

    // Diagnostic: compare the API-based resolver (broker_report → order/deps fallback)
    // against the winning count above, for production log analysis only.
    try {
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
      console.info("[tradovate/trades] resolver result (diagnostic only)", {
        accountId,
        count: resolved.count,
        source: resolved.source,
        trustLevel: resolved.trustLevel,
        finalUsedCount: tradesCount,
        attempts: resolved.attempts,
      });
    } catch {
      // Diagnostic failure must not abort the sync.
    }

    // Persist fillsSyncedAt separately (it's set inside the try block above).
    if (fillsSyncedAt != null) {
      await prisma.connectedAccount
        .update({ where: { id: accountId }, data: { fillsSyncedAt } })
        .catch(() => {});
    }

    // Use snapshot P&L when available; fall back to summing fill profits.
    const resolvedDailyPnl = dailyPnl ?? pnlFromFills;
    // Effective P&L for threshold enforcement = realized + open/unrealized.
    // openPnl is account-scoped (cashBalance snapshot openPl or position/deps).
    const effectiveDailyPnl = computeEffectiveDailyPnl(resolvedDailyPnl, openPnl);
    console.info("[tradovate/pnl] resolved daily P&L", {
      accountId,
      fromSnapshot: dailyPnl,
      fromFills: pnlFromFills,
      resolved: resolvedDailyPnl,
      unrealized: openPnl,
      effective: effectiveDailyPnl,
    });

    // ── Load risk rules for riskState computation ─────────────────────────
    const [accountRules, defaultRules, accountConnInfo] = await Promise.all([
      prisma.accountRiskRules.findUnique({
        where: { accountId },
        select: {
          maxDailyLoss: true,
          maxTradesPerDay: true,
          stopAfterLosses: true,
          allowedEndHour: true,
          sessionEndBehavior: true,
          maxContracts: true,
        },
      }),
      prisma.riskRules.findUnique({
        where: { userId },
        select: {
          maxDailyLoss: true,
          maxTradesPerDay: true,
          dailyProfitTarget: true,
          stopAfterLosses: true,
          sessionEndHour: true,
          sessionEndBehavior: true,
          maxContracts: true,
        },
      }),
      prisma.connectedAccount.findUnique({
        where: { id: accountId },
        select: { brokerConnection: { select: { connectionStatus: true } } },
      }),
    ]);
    const isReadOnlyConnection =
      accountConnInfo?.brokerConnection?.connectionStatus === "connected_readonly";
    const effectiveMaxDailyLoss =
      accountRules?.maxDailyLoss != null
        ? Number(accountRules.maxDailyLoss)
        : defaultRules?.maxDailyLoss != null
          ? Number(defaultRules.maxDailyLoss)
          : null;
    const effectiveMaxTrades =
      accountRules?.maxTradesPerDay ?? defaultRules?.maxTradesPerDay ?? null;
    const effectiveStopAfterLosses =
      accountRules?.stopAfterLosses ?? defaultRules?.stopAfterLosses ?? null;
    // Profit target is a user-level setting only (no per-account override yet).
    const effectiveProfitTarget =
      defaultRules?.dailyProfitTarget != null
        ? Number(defaultRules.dailyProfitTarget)
        : null;

    const lossUsed =
      effectiveDailyPnl != null ? Math.abs(Math.min(effectiveDailyPnl, 0)) : null;
    const lossPct =
      effectiveMaxDailyLoss != null && effectiveMaxDailyLoss > 0 && lossUsed != null
        ? Math.min(1, lossUsed / effectiveMaxDailyLoss)
        : null;

    // Trade-limit checks are only authoritative when tradeCountSource is
    // "verified" — an estimated/unavailable count must NOT trigger a broker
    // lock or a "locked" status, since it may include fills from other
    // accounts on the same OAuth token.
    const tradeCountIsAuthoritative = tradeCountSource === "verified";

    // ── LiveSessionState: read before riskState computation ──────────────────
    // Load first so consecutiveLosses and pendingSessionEndLock are available
    // for enforcement checks below. tradingDayKey uses the CME Globex session
    // date (rolls at 5PM America/Chicago), not UTC or server calendar date.
    const existing = await prisma.liveSessionState.findUnique({
      where: { accountId },
      select: { id: true, sessionDate: true, riskState: true, consecutiveLosses: true, pendingSessionEndLock: true },
    });
    const prevRiskState = existing?.riskState ?? "NORMAL";
    const consecutiveLossesFromState = existing?.consecutiveLosses ?? 0;
    const isStale = existing ? existing.sessionDate !== tradingDayKey : false;
    const isPendingSessionEndLock = !isStale && (existing?.pendingSessionEndLock ?? false);

    // ── Session-end behavior ──────────────────────────────────────────────
    // Account-specific hour/behavior take precedence over user-level defaults.
    const effectiveSessionEndHour: number | null =
      accountRules?.allowedEndHour ?? defaultRules?.sessionEndHour ?? null;
    const effectiveSessionEndBehavior: SessionEndBehavior =
      ((accountRules?.sessionEndBehavior ?? defaultRules?.sessionEndBehavior ?? null) as SessionEndBehavior | null) ??
      "wait_for_exit_then_lock";
    const cmeHour = getCmeHour(now);
    const sessionEndAction = deriveSessionEndAction({
      sessionEndHour: effectiveSessionEndHour,
      behavior: effectiveSessionEndBehavior,
      cmeHour,
      hasOpenPositions,
      isAlreadyStopped: prevRiskState === "STOPPED",
      isPendingSessionEndLock,
    });

    // ── Max position size (standard-equivalent exposure) ─────────────────
    // Account-specific maxContracts overrides the user-level default.
    // Tradovate cannot express the cross-product equivalence (1 NQ = 10 MNQ),
    // so this is Guardrail-side monitoring only. UserAccountPositionLimit
    // writes are intentionally NOT performed here — see ENFORCEMENT_CAPABILITIES
    // for max_position_size capability classification.
    const effectiveMaxContracts: number | null =
      accountRules?.maxContracts ?? defaultRules?.maxContracts ?? null;
    const exposureInputs: PositionExposureInput[] = openPositions.map((p) => ({
      symbol: p.symbol,
      netPos: p.side === "SHORT" ? -p.quantity : p.quantity,
    }));
    const maxPositionSizeDecision = deriveMaxPositionSizeBreach({
      positions: exposureInputs,
      maxContracts: effectiveMaxContracts,
    });

    let newRiskState: "NORMAL" | "WARNING" | "STOPPED" = "NORMAL";
    let enforcementTrigger: EnforcementTrigger | null = null;
    if (lossPct != null && lossPct >= 1.0) {
      newRiskState = "STOPPED";
      enforcementTrigger = "daily_loss_limit";
    } else if (
      effectiveProfitTarget != null &&
      effectiveProfitTarget > 0 &&
      effectiveDailyPnl != null &&
      effectiveDailyPnl >= effectiveProfitTarget
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
      // Only enforce when trade count is authoritative — the same guard used for
      // trade_limit. consecutiveLossesFromState is sourced from LiveSessionState,
      // which is updated by guardian-engine on each trade_closed event. When the
      // trade count source is "verified" (Performance Report or account-scoped
      // orders), we can trust that the session state reflects real closed trades.
      tradeCountIsAuthoritative &&
      effectiveStopAfterLosses != null &&
      effectiveStopAfterLosses > 0 &&
      consecutiveLossesFromState >= effectiveStopAfterLosses
    ) {
      newRiskState = "STOPPED";
      enforcementTrigger = "consecutive_losses";
    } else if (maxPositionSizeDecision.shouldTrigger) {
      // Standard-equivalent exposure exceeds the configured max, OR an open
      // position is in a symbol Guardrail can't classify (safer policy:
      // lock when verification is impossible).
      newRiskState = "STOPPED";
      enforcementTrigger = "max_position_size";
    } else if (
      sessionEndAction === "lock_immediately" ||
      sessionEndAction === "flatten_then_lock" ||
      sessionEndAction === "lock_pending"
    ) {
      newRiskState = "STOPPED";
      enforcementTrigger = "session_end";
    } else if (
      (lossPct != null && lossPct >= 0.8) ||
      (tradeCountIsAuthoritative &&
        effectiveMaxTrades != null &&
        effectiveMaxTrades > 1 &&
        tradesCount === effectiveMaxTrades - 1)
    ) {
      newRiskState = "WARNING";
    }

    // ── Pre-flatten step ──────────────────────────────────────────────────
    // Run BEFORE triggerEnforcement so the flatten outcome is recorded on
    // GuardianIntervention atomically. Two triggers want flatten:
    //   - session_end with behavior=flatten_at_session_end
    //   - max_position_size with at least one open position
    // Read-only connections skip the broker write but still record the
    // intended action. Dry-run mode records a simulated payload without
    // calling Tradovate.
    let preFlattened: BrokerFlattenResult | undefined;
    const wantsFlatten =
      (enforcementTrigger === "session_end" && sessionEndAction === "flatten_then_lock") ||
      (enforcementTrigger === "max_position_size" && hasOpenPositions);
    if (wantsFlatten) {
      const flattenContext =
        enforcementTrigger === "max_position_size" ? "max-position-size" : "session-end";
      if (isEnforcementDryRun()) {
        preFlattened = {
          flattenStatus: "dry_run",
          flattenMessage: `Test mode · ${flattenContext} position exit simulated. No Tradovate write was sent.`,
          flattenPayload: { positions: ["(position IDs from position/deps)"], admin: false },
          flattenResponse: null,
        };
      } else if (isReadOnlyConnection) {
        preFlattened = {
          flattenStatus: "unavailable_read_only",
          flattenMessage:
            `Connection is read-only — ${flattenContext} flatten skipped. ` +
            "Guardrail's internal lock still applies.",
          flattenPayload: null,
          flattenResponse: null,
        };
      } else {
        try {
          preFlattened = await client.applyFlattenOpenPositions();
        } catch (flattenErr) {
          preFlattened = classifyFlattenError(flattenErr);
          console.warn(`[tradovate/sync] ${flattenContext} flatten failed — proceeding to lock`, {
            accountId,
            flattenStatus: preFlattened.flattenStatus,
          });
        }
      }
    }

    // ── LiveSessionState: persist updated dailyPnl, tradesCount, riskState ──

    const nextPendingSessionEndLock =
      sessionEndAction === "await_flat"
        ? true
        : sessionEndAction === "lock_pending"
          ? false // resolved — lock fires this sync
          : isPendingSessionEndLock; // no change

    if (existing) {
      await prisma.liveSessionState.update({
        where: { accountId },
        data: {
          ...(isStale ? { sessionDate: tradingDayKey } : {}),
          tradesCount,
          tradeCountSource,
          riskState: newRiskState,
          pendingSessionEndLock: isStale ? false : nextPendingSessionEndLock,
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
          pendingSessionEndLock: false,
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
            : enforcementTrigger === "consecutive_losses"
              ? `Consecutive loss limit reached: ${consecutiveLossesFromState} consecutive losses`
              : enforcementTrigger === "max_position_size"
                ? maxPositionSizeDecision.reason ?? "Max position size exceeded"
                : enforcementTrigger === "session_end"
                  ? `Session end reached (configured end hour: ${effectiveSessionEndHour ?? "unknown"} CT)`
                  : `Trade limit reached: ${tradesCount}${effectiveMaxTrades != null ? `/${effectiveMaxTrades}` : ""}`;
      triggerEnforcement({
        accountId,
        userId,
        trigger: enforcementTrigger,
        reason,
        // Pass current loss/profit so the broker threshold is set exactly at the
        // amount already earned/lost, ensuring the account is immediately past the limit.
        currentDailyLoss: lossUsed,
        currentDailyPnl: resolvedDailyPnl,
        // For session_end flatten_then_lock: pass the flatten result so it is
        // stored in GuardianIntervention without re-running the flatten step.
        ...(preFlattened !== undefined && { preFlattened }),
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
  // ── 0. Connection-level token renewal ────────────────────────────────────
  // Renew once before discovery and parallel account syncs to avoid N
  // concurrent renewal attempts from N TradovateClient.initialize() calls.
  // Throws on auth_invalid (connection/accounts already marked expired) or
  // transient errors — either way the caller records the failure and skips
  // this connection for this cron cycle.
  await ensureTradovateAccessToken({ brokerConnectionId: connectionId, userId });

  // ── 1. Discovery + reconciliation ────────────────────────────────────────
  const discovery = await runDiscoveryForConnection(connectionId, userId);
  const discoveryOk = discovery.ok;
  const newlyCreatedIds = discovery.newlyCreatedIds;
  const missingIds = discovery.missingIds;

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
