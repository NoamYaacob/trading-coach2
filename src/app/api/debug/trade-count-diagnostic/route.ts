import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { TradovateClient } from "@/lib/brokers/tradovate-client";
import { deriveCanonicalEntryCount } from "@/lib/guardian-engine/canonical-trade-count";
import { classifyFill, normalizeSide } from "@/lib/guardian-engine/fill-classifier";
import { parsePerformanceReportTradeCount } from "@/lib/brokers/tradovate-reports-parser";
import { deriveCmeTradingDayKey } from "@/lib/trading-day";

/**
 * Diagnostic endpoint for investigating trade-count discrepancies.
 *
 * Usage:
 *   GET /api/debug/trade-count-diagnostic?accountId=DEMO7433035
 *   GET /api/debug/trade-count-diagnostic?accountId=7433035
 *   GET /api/debug/trade-count-diagnostic?accountId=<internal-cuid>
 *
 * Accepts: account label (e.g. DEMO7433035), externalAccountId (numeric
 * Tradovate ID with or without DEMO/LIVE prefix), or internal ConnectedAccount.id.
 *
 * Returns a comprehensive trace including Performance Report count, canonical
 * DB count, per-fill position trace, and current LiveSessionState values.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const accountParam = searchParams.get("accountId");
  if (!accountParam) {
    return NextResponse.json({ error: "accountId query parameter required" }, { status: 400 });
  }

  // Multi-field lookup:
  // 1. label — the user-visible account name (e.g. "DEMO7433035")
  // 2. externalAccountId — exact match (numeric Tradovate ID, e.g. "7433035")
  // 3. externalAccountId — DEMO/LIVE prefix stripped (e.g. "7433035" from "DEMO7433035")
  // 4. id — internal ConnectedAccount cuid
  const stripped = accountParam.replace(/^(DEMO|LIVE)/i, "");
  const orConditions = [
    { label: accountParam },
    { externalAccountId: accountParam },
    { id: accountParam },
    ...(stripped !== accountParam ? [{ externalAccountId: stripped }] : []),
  ];

  const account = await prisma.connectedAccount.findFirst({
    where: { isActive: true, OR: orConditions },
    select: { id: true, userId: true, externalAccountId: true, label: true },
  });

  if (!account) {
    const available = await prisma.connectedAccount.findMany({
      where: { isActive: true },
      select: { id: true, label: true, externalAccountId: true, platform: true },
      orderBy: [{ platform: "asc" }, { label: "asc" }],
    });
    return NextResponse.json(
      {
        error: "account not found",
        received: accountParam,
        searchedFields: ["label", "externalAccountId", "id"],
        availableAccounts: available,
      },
      { status: 404 },
    );
  }

  const sessionDate = deriveCmeTradingDayKey(new Date());
  const dayStart = new Date(`${sessionDate}T00:00:00.000Z`);
  const dateRange = { tradingDayKey: sessionDate, start: dayStart.toISOString() };

  // ── Performance Report (same path as Phase C in sync) ──────────────────────
  let performanceReportTradeCount: number | null = null;
  let performanceReportStatus = "not_attempted";
  let performanceReportAccountName: string | null = null;
  let performanceReportDebug: Record<string, unknown> = {};
  try {
    const tvClient = new TradovateClient(account.id, account.userId);
    await tvClient.initialize();
    performanceReportAccountName = await tvClient.getAccountName();
    if (performanceReportAccountName) {
      // Capture what would be sent to Tradovate for debugging the 400
      const [y, m, d] = sessionDate.split("-");
      const dateFormatted = `${m}/${d}/${y}`;
      performanceReportDebug = {
        endpoint: "POST /reports/requestreport",
        accountNameUsed: performanceReportAccountName,
        tvAccountId: account.externalAccountId,
        dateFormatted,
        tradingDayKey: sessionDate,
        requestBodyShape: {
          name: "Performance",
          params: ["startDate", "endDate", "startTime", "endTime", "account"],
          representationType: "html",
          template: "Flex.html",
        },
      };
      const report = await tvClient.fetchPerformanceReport({
        accountName: performanceReportAccountName,
        tradingDayKey: sessionDate,
      });
      if (report == null) {
        performanceReportStatus = "null_response";
        performanceReportDebug.note = "fetchPerformanceReport returned null — reports URL not configured or network error";
      } else {
        performanceReportDebug.httpStatus = report.status;
        performanceReportDebug.contentType = report.contentType;
        // Always expose the raw body (up to 500 chars) to debug 4xx/5xx errors
        performanceReportDebug.responseBodyPreview = report.body.slice(0, 500);
        if (report.status < 200 || report.status >= 300) {
          performanceReportStatus = `http_${report.status}`;
        } else {
          const parsed = parsePerformanceReportTradeCount({
            body: report.body,
            contentType: report.contentType,
          });
          performanceReportTradeCount = parsed;
          performanceReportStatus = parsed != null ? "parsed" : "unparseable";
        }
      }
    } else {
      performanceReportStatus = "no_account_name";
      performanceReportDebug.note = "getAccountName() returned null — check /account/list API response and tvAccountId";
      performanceReportDebug.tvAccountId = account.externalAccountId;
    }
  } catch (err) {
    performanceReportStatus = `error:${err instanceof Error ? err.message : "unknown"}`;
    performanceReportDebug.errorMessage = err instanceof Error ? err.message : String(err);
  }

  // ── DB fills ───────────────────────────────────────────────────────────────
  const allFills = await prisma.normalizedTradeEvent.findMany({
    where: {
      accountId: account.id,
      occurredAt: { gte: dayStart },
      eventType: { in: ["fill", "trade_closed", "trade_closed_win", "trade_closed_loss"] },
    },
    select: {
      externalTradeId: true,
      contractId: true,
      eventType: true,
      side: true,
      quantity: true,
      price: true,
      occurredAt: true,
      rawPayload: true,
    },
    orderBy: { occurredAt: "asc" },
  });

  const rawFillCount = allFills.length;

  const canonicalFills = allFills.map((f) => ({
    externalTradeId: f.externalTradeId,
    contractId: f.contractId,
    side: f.side,
    quantity: f.quantity != null ? String(f.quantity) : null,
    price: f.price != null ? String(f.price) : null,
    occurredAt: f.occurredAt,
    rawPayload: f.rawPayload,
  }));

  const canonicalEntryCount = deriveCanonicalEntryCount(canonicalFills);

  // ── Per-fill position trace (mirrors deriveCanonicalEntryCount exactly) ────
  function compositeKey(f: (typeof canonicalFills)[number]): string {
    return [
      String(f.contractId ?? ""),
      f.occurredAt.toISOString(),
      f.side ?? "",
      f.quantity ?? "",
      f.price ?? "",
    ].join("|");
  }

  const byExtId = new Map<string, (typeof canonicalFills)[number]>();
  const noIdSeen = new Set<string>();
  const noIdFills: Array<(typeof canonicalFills)[number]> = [];

  for (const fill of canonicalFills) {
    if (!fill.externalTradeId) {
      const key = compositeKey(fill);
      if (!noIdSeen.has(key)) {
        noIdSeen.add(key);
        noIdFills.push(fill);
      }
      continue;
    }
    const existing = byExtId.get(fill.externalTradeId);
    if (!existing || (fill.contractId != null && existing.contractId == null)) {
      byExtId.set(fill.externalTradeId, fill);
    }
  }

  const deduped = [...byExtId.values(), ...noIdFills].sort((a, b) => {
    const timeDiff = a.occurredAt.getTime() - b.occurredAt.getTime();
    if (timeDiff !== 0) return timeDiff;
    const aId = a.externalTradeId != null ? Number(a.externalTradeId) : Infinity;
    const bId = b.externalTradeId != null ? Number(b.externalTradeId) : Infinity;
    if (aId !== bId) return aId - bId;
    return (Number(a.price) || 0) - (Number(b.price) || 0);
  });

  const dedupedFillCount = deduped.length;

  const contractPositions = new Map<string, number>();
  const fillTrace = deduped.map((fill) => {
    let contractKey: string;
    if (fill.contractId != null) {
      contractKey = `cid:${fill.contractId}`;
    } else {
      const payload = fill.rawPayload as { symbol?: string } | null;
      contractKey = `sym:${payload?.symbol ?? "unknown"}`;
    }

    const positionBefore = contractPositions.get(contractKey) ?? 0;
    const side = normalizeSide(fill.side);
    const qty = Number(fill.quantity ?? 0);
    const classification = classifyFill(positionBefore, side, qty);
    const counted = classification === "entry" || classification === "reversal";
    const positionAfter = positionBefore + (side === "BUY" ? qty : -qty);
    contractPositions.set(contractKey, positionAfter);

    const dedupKey = fill.externalTradeId
      ? `id:${fill.externalTradeId}`
      : `composite:${compositeKey(fill)}`;

    return {
      externalTradeId: fill.externalTradeId,
      contractKey,
      sideRaw: fill.side,
      sideNormalized: side,
      quantity: fill.quantity,
      price: fill.price,
      occurredAt: fill.occurredAt.toISOString(),
      dedupKey,
      positionBefore,
      positionAfter,
      classification,
      counted,
    };
  });

  // ── LiveSessionState ───────────────────────────────────────────────────────
  const liveState = await prisma.liveSessionState.findUnique({
    where: { accountId: account.id },
    select: { tradesCount: true, tradeCountSource: true, sessionDate: true, riskState: true },
  });

  return NextResponse.json({
    accountId: account.label,
    internalAccountId: account.id,
    tvAccountId: account.externalAccountId,
    sessionDate,
    dateRange,
    performanceReport: {
      status: performanceReportStatus,
      tradeCount: performanceReportTradeCount,
      debug: performanceReportDebug,
    },
    rawFillCount,
    dedupedFillCount,
    canonicalEntryCount,
    liveState: liveState ?? null,
    fillTrace,
  });
}
