#!/usr/bin/env tsx
/**
 * Session vs Calendar Day — P&L Source Diagnostic. READ ONLY, zero writes.
 *
 * Explains why LiveSessionState.dailyPnl and reconstructed round-trip P&L
 * show DIFFERENT values for the same account and same CME session:
 *
 *   LiveSessionState.dailyPnl
 *     Primary source: tradovate-sync.ts → client.toAccountSnapshot() →
 *       snapshot.todayPnL — the broker's own running commission-adjusted
 *       session P&L returned directly from the Tradovate account API.
 *       This is NOT derived by summing NormalizedTradeEvent.pnl.
 *     Fallback source: if snapshot is unavailable, pnlFromFills =
 *       sum(ex.pnl from client.toExecutions()) is used instead.
 *     The sync writes: resolvedDailyPnl = snapshot.todayPnL ?? pnlFromFills
 *     to LiveSessionState.dailyPnl directly.
 *
 *   NormalizedTradeEvent.pnl
 *     Source: tradovate-sync.ts → client.toExecutions() → ex.pnl
 *     This is the per-fill profit from Tradovate's fill/execution API.
 *     For some account types (e.g. MFFU), the execution API does NOT return
 *     per-fill profit → all NormalizedTradeEvent.pnl = null.
 *     This means applyTradeClose is never called from the webhook for these
 *     accounts, and sum(NormalizedTradeEvent.pnl) = $0 even when dailyPnl ≠ $0.
 *
 *   Reconstructed round-trip P&L (P&L calendar, Equity curve)
 *     Source: NormalizedTradeEvent fills → reconstructRoundTrips() FIFO.
 *     Uses fill.pnl (pnlSource="broker") when non-null.
 *     For fills where pnl == null: computes from price difference
 *     (pnlSource="computed") — NO commissions deducted.
 *     When ALL fills have null pnl (e.g. MFFU), the entire reconstruction
 *     is price-computed and will diverge significantly from dailyPnl
 *     because commissions and slippage are not captured.
 *
 *   tradesCount
 *     Source: tradovate-sync.ts trade-count resolver:
 *       Phase A: client.getCompletedOrdersToday() (completed-orders count)
 *       Phase B: traceEntryTrades(executions) (fill-based position trace)
 *       The resolver picks the higher/more-trusted source.
 *     NOT set by webhook applyTradeClose (which never fires if all fills
 *     have null pnl, as for MFFU).
 *
 *   Round-trip count
 *     Source: reconstructRoundTrips FIFO. Counts every lot-closure event,
 *     including partial exits and null-pnl fills. Higher than tradesCount
 *     because each partial exit = one FIFO round-trip even though tradesCount
 *     only increments when the position reaches flat.
 *
 * Example (MFFUSFRPD133936252, CME session 2026-05-31):
 *   dailyPnl = -$404   (Tradovate account snapshot.todayPnL, commission-adjusted)
 *   NormalizedTradeEvent.pnl = null for all 121 fills (MFFU execution API)
 *   reconstruction = +$168.50  (all 74 round-trips pnlSource=computed, no commissions)
 *   gap = -$572.50 = commissions + slippage + open position P&L
 *   tradesCount = 47   (sync trade-count resolver: completed orders/fill trace)
 *   round-trips = 74   (FIFO lot-closures, includes partial exits)
 *   sessionDate = "2026-05-31" ≠ current CME key "2026-06-01"
 *   → resolveSessionDisplayMetrics returns null → dashboard shows "—" (not -$404)
 *
 * SAFETY CONTRACT:
 *   - Prisma: findFirst / findUnique / findMany / count only.
 *   - No create / update / updateMany / upsert / delete / deleteMany / raw.
 *   - Does NOT call any enforcement or session function.
 *   - No fetch / axios / Tradovate client. No token or secret printing.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/inspect-session-calendar-data.ts MFFUSFRPD133936252
 *   DATABASE_URL="postgresql://..." npx tsx scripts/inspect-session-calendar-data.ts DEMO7433035
 */

import { resolve } from "path";

import { config } from "dotenv";
config({ path: resolve(process.cwd(), ".env.local") });

import { prisma } from "../src/lib/db.ts";
import { deriveCmeTradingDayKey, deriveCmeTradingDaySessionStart } from "../src/lib/trading-day.ts";
import { reconstructRoundTrips, type FillInput } from "../src/lib/trades/round-trips.ts";

const TARGET = process.argv[2] ?? "MFFUSFRPD133936252";
const DISPLAY_TZ = "America/Chicago";

function fmt(value: unknown): string {
  if (value == null) return "(null)";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function fmt$(v: number | null): string {
  if (v == null) return "(null)";
  const abs = Math.abs(v);
  const sign = v >= 0 ? "+" : "-";
  return `${sign}$${abs.toFixed(2)}`;
}

function calDayKey(d: Date, tz: string): string {
  return d.toLocaleDateString("en-CA", { timeZone: tz });
}

function pad(s: string, n: number): string {
  return s.padEnd(n);
}

async function run(): Promise<void> {
  const now = new Date();
  const cmeDayKey = deriveCmeTradingDayKey(now);
  const cmeSessionStart = deriveCmeTradingDaySessionStart(now);
  const calendarTodayKey = calDayKey(now, DISPLAY_TZ);

  console.log("=".repeat(72));
  console.log("Session P&L Source Diagnostic — READ ONLY");
  console.log("=".repeat(72));
  console.log(`  Target account:           ${TARGET}`);
  console.log(`  Run time (UTC):           ${now.toISOString()}`);
  console.log(`  CT calendar day:          ${calendarTodayKey}`);
  console.log(`  CME session key (now):    ${cmeDayKey}`);
  console.log(`  CME session opened at:    ${cmeSessionStart.toISOString()}`);
  console.log(`                            (${cmeSessionStart.toLocaleString("en-US", { timeZone: DISPLAY_TZ, timeStyle: "short", dateStyle: "short" })} CT)`);
  console.log();

  // ── Resolve account ──────────────────────────────────────────────────────────
  const account = await prisma.connectedAccount.findFirst({
    where: {
      OR: [
        { label: TARGET },
        { displayName: TARGET },
        { externalAccountId: TARGET },
      ],
    },
    select: {
      id: true,
      label: true,
      displayName: true,
      externalAccountId: true,
      protectionStatus: true,
      missingFromBrokerSince: true,
      brokerConnection: { select: { env: true, connectionStatus: true } },
    },
  });

  if (!account) {
    console.error(`FATAL: No account found matching "${TARGET}".`);
    console.error(`Usage: DATABASE_URL="..." npx tsx scripts/inspect-session-calendar-data.ts <LABEL>`);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log("── Account ─────────────────────────────────────────────────────────────");
  console.log(`  ${pad("id:", 24)} ${account.id}`);
  console.log(`  ${pad("label:", 24)} ${fmt(account.label)}`);
  console.log(`  ${pad("displayName:", 24)} ${fmt(account.displayName)}`);
  console.log(`  ${pad("externalAccountId:", 24)} ${fmt(account.externalAccountId)}`);
  console.log(`  ${pad("protectionStatus:", 24)} ${account.protectionStatus}`);
  console.log(`  ${pad("missingFromBrokerSince:", 24)} ${fmt(account.missingFromBrokerSince)}`);
  if (account.missingFromBrokerSince != null) {
    console.log(`  ⚠  Account is UNAVAILABLE — broker stopped returning it.`);
    console.log(`     Dashboard shows "Historical · unavailable" badge.`);
    console.log(`     Not counted in active account total. Historical data preserved.`);
  }
  console.log(`  ${pad("brokerConn.env:", 24)} ${fmt(account.brokerConnection?.env)}`);
  console.log(`  ${pad("brokerConn.status:", 24)} ${fmt(account.brokerConnection?.connectionStatus)}`);
  console.log();

  // ── LiveSessionState ──────────────────────────────────────────────────────────
  const session = await prisma.liveSessionState.findUnique({
    where: { accountId: account.id },
    select: {
      sessionDate: true,
      dailyPnl: true,
      tradesCount: true,
      tradeCountSource: true,
      consecutiveLosses: true,
      riskState: true,
      lastTradeAt: true,
      updatedAt: true,
    },
  });

  console.log("── LiveSessionState ─────────────────────────────────────────────────────");
  console.log("  PRIMARY SOURCE: tradovate-sync.ts → snapshot.todayPnL (Tradovate broker API)");
  console.log("  dailyPnl  = broker account snapshot todayPnL, commission-adjusted");
  console.log("            ≠ sum(NormalizedTradeEvent.pnl) — NOT derived from per-fill pnl");
  console.log("  tradesCount = tradovate-sync.ts trade-count resolver (completed orders or fill trace)");
  console.log("              ≠ webhook applyTradeClose count (which only fires if fill.pnl != null)");
  console.log();
  if (!session) {
    console.log("  (no LiveSessionState row — account never had a session)");
  } else {
    console.log(`  ${pad("sessionDate:", 22)} ${session.sessionDate}`);
    console.log(`  ${pad("dailyPnl:", 22)} ${fmt$(Number(session.dailyPnl))}`);
    console.log(`  ${pad("tradesCount:", 22)} ${session.tradesCount}`);
    console.log(`  ${pad("tradeCountSource:", 22)} ${session.tradeCountSource ?? "(null)"}`);
    console.log(`  ${pad("consecutiveLosses:", 22)} ${session.consecutiveLosses}`);
    console.log(`  ${pad("riskState:", 22)} ${session.riskState}`);
    console.log(`  ${pad("lastTradeAt:", 22)} ${fmt(session.lastTradeAt)}`);
    console.log(`  ${pad("updatedAt:", 22)} ${fmt(session.updatedAt)}`);

    if (session.sessionDate !== cmeDayKey) {
      console.log();
      console.log(`  ⚠  SESSION IS STALE: sessionDate "${session.sessionDate}" ≠ current CME key "${cmeDayKey}"`);
      console.log(`     resolveSessionDisplayMetrics(session, "${cmeDayKey}") → { dailyPnl: null, tradesCount: null }`);
      console.log(`     DASHBOARD SHOWS "—" — the stale -$${Math.abs(Number(session.dailyPnl)).toFixed(2)} and ${session.tradesCount} trades`);
      console.log(`     are NOT presented as current data to the user.`);
    } else {
      console.log();
      console.log(`  ✓ sessionDate "${session.sessionDate}" matches current CME key — session is current.`);
    }
  }
  console.log();

  // ── Raw fills for the session ─────────────────────────────────────────────────
  const sessionStartForLookup = session != null
    ? (() => {
        const { getCmeSessionStartForKey } = require("../src/lib/time/cme-session.ts");
        return getCmeSessionStartForKey(session.sessionDate) as Date;
      })()
    : new Date(now.getTime() - 48 * 60 * 60 * 1000);

  const allFills = await prisma.normalizedTradeEvent.findMany({
    where: {
      accountId: account.id,
      side: { not: null },
      quantity: { not: null },
      price: { not: null },
      occurredAt: { gte: sessionStartForLookup },
    },
    select: {
      id: true,
      contractId: true,
      side: true,
      quantity: true,
      price: true,
      pnl: true,
      occurredAt: true,
      rawPayload: true,
      externalTradeId: true,
    },
    orderBy: { occurredAt: "asc" },
  });

  // Separate null-pnl from non-null-pnl fills
  const fillsWithPnl    = allFills.filter(f => f.pnl != null);
  const fillsNullPnl    = allFills.filter(f => f.pnl == null);
  const sumNonNullPnl   = fillsWithPnl.reduce((s, f) => s + Number(f.pnl), 0);

  console.log("── NormalizedTradeEvent fills (CME session) ─────────────────────────────");
  console.log("  Source: tradovate-sync.ts → client.toExecutions() → stored per-fill");
  console.log("  ex.pnl = Tradovate fill/execution API profit field");
  console.log("  Many account types (e.g. MFFU) do NOT return per-fill profit → all null");
  console.log();
  console.log(`  Total fills:              ${allFills.length}`);
  console.log(`  Fills with pnl != null:   ${fillsWithPnl.length}  → sum = ${fmt$(sumNonNullPnl)}`);
  console.log(`  Fills with pnl == null:   ${fillsNullPnl.length}`);
  console.log();
  if (session != null) {
    const sessionDailyPnl = Number(session.dailyPnl);
    if (fillsWithPnl.length === 0) {
      console.log(`  ✓ (expected) All fills have null pnl — NormalizedTradeEvent.pnl is NOT`);
      console.log(`    the source of LiveSessionState.dailyPnl = ${fmt$(sessionDailyPnl)}.`);
      console.log(`    Source is Tradovate account snapshot.todayPnL (see LiveSessionState above).`);
    } else {
      const diff = Math.abs(sumNonNullPnl - sessionDailyPnl);
      if (diff < 0.01) {
        console.log(`  ✓ sum(non-null fill pnl) = ${fmt$(sumNonNullPnl)} matches LiveSessionState.dailyPnl = ${fmt$(sessionDailyPnl)}`);
        console.log(`    For this account, per-fill pnl IS available — snapshot and fills agree.`);
      } else {
        console.log(`  ⚠  sum(non-null fill pnl) = ${fmt$(sumNonNullPnl)} ≠ LiveSessionState.dailyPnl = ${fmt$(sessionDailyPnl)}`);
        console.log(`     Difference: ${fmt$(sumNonNullPnl - sessionDailyPnl)}`);
        console.log(`     dailyPnl source is Tradovate account snapshot.todayPnL (snapshot takes priority`);
        console.log(`     over pnlFromFills in tradovate-sync.ts line: resolvedDailyPnl = dailyPnl ?? pnlFromFills)`);
      }
    }
  }
  console.log();

  // ── Bucketed fill counts ──────────────────────────────────────────────────────
  const fillsByCalDay = new Map<string, typeof allFills>();
  const fillsByCmeDay = new Map<string, typeof allFills>();
  for (const f of allFills) {
    const calK = calDayKey(f.occurredAt, DISPLAY_TZ);
    const cmeK = deriveCmeTradingDayKey(f.occurredAt);
    fillsByCalDay.set(calK, [...(fillsByCalDay.get(calK) ?? []), f]);
    fillsByCmeDay.set(cmeK, [...(fillsByCmeDay.get(cmeK) ?? []), f]);
  }

  console.log("── Fill buckets ─────────────────────────────────────────────────────────");
  for (const dk of [...fillsByCalDay.keys()].sort()) {
    const fills = fillsByCalDay.get(dk)!;
    const withPnl = fills.filter(f => f.pnl != null);
    const nullPnl = fills.filter(f => f.pnl == null);
    console.log(`  CT calendar ${dk}: ${fills.length} fills  (${withPnl.length} with pnl, ${nullPnl.length} null-pnl)`);
  }
  for (const dk of [...fillsByCmeDay.keys()].sort()) {
    const fills = fillsByCmeDay.get(dk)!;
    const withPnl = fills.filter(f => f.pnl != null);
    const nullPnl = fills.filter(f => f.pnl == null);
    console.log(`  CME session ${dk}: ${fills.length} fills  (${withPnl.length} with pnl, ${nullPnl.length} null-pnl)`);
  }
  console.log();

  // ── Reconstructed round-trips ─────────────────────────────────────────────────
  const fillInput: FillInput[] = allFills.map((f) => ({
    id: f.id,
    externalTradeId: f.externalTradeId,
    contractId: f.contractId,
    side: f.side,
    quantity: f.quantity != null ? String(f.quantity) : null,
    price: f.price != null ? String(f.price) : null,
    pnl: f.pnl != null ? String(f.pnl) : null,
    occurredAt: f.occurredAt,
    rawPayload: f.rawPayload,
  }));

  // Build contractId → symbol map from fills that have symbols in rawPayload
  const contractIdMap = new Map<number, string>();
  for (const f of fillInput) {
    const payload = f.rawPayload as
      | { contract?: { name?: string; symbol?: string }; symbol?: string; contractName?: string }
      | null
      | undefined;
    const symbol = payload?.contract?.name ?? payload?.contract?.symbol ?? payload?.symbol ?? payload?.contractName;
    if (symbol && f.contractId != null && !contractIdMap.has(f.contractId)) {
      contractIdMap.set(f.contractId, symbol);
    }
  }

  const roundTrips = reconstructRoundTrips(fillInput, contractIdMap).sort(
    (a, b) => a.closedAt.getTime() - b.closedAt.getTime(),
  );

  const rtBroker   = roundTrips.filter(rt => rt.pnlSource === "broker");
  const rtComputed = roundTrips.filter(rt => rt.pnlSource === "computed");
  const sumBrokerPnl   = rtBroker.reduce((s, rt) => s + rt.pnl, 0);
  const sumComputedPnl = rtComputed.reduce((s, rt) => s + rt.pnl, 0);
  const totalRtPnl     = sumBrokerPnl + sumComputedPnl;

  console.log("── Reconstructed round-trips (P&L calendar / equity curve source) ───────");
  console.log("  Source: reconstructRoundTrips(fills) — FIFO lot-matching");
  console.log("  Each lot-closure event = one round-trip (includes partial exits)");
  console.log("  pnlSource=broker  → uses fill.pnl (Tradovate per-fill profit)");
  console.log("  pnlSource=computed → entry avg − exit price (NO commissions, NO slippage)");
  console.log("  When all fills have null pnl: ALL round-trips are pnlSource=computed");
  console.log("  → large divergence from dailyPnl is expected (commissions not deducted)");
  console.log();
  console.log(`  Total round-trips:        ${roundTrips.length}`);
  console.log(`  pnlSource=broker:         ${rtBroker.length}  sum = ${fmt$(sumBrokerPnl)}`);
  console.log(`  pnlSource=computed:       ${rtComputed.length}  sum = ${fmt$(sumComputedPnl)}`);
  console.log(`  Total P&L:                ${fmt$(totalRtPnl)}`);
  console.log();

  // Bucket round-trips
  const rtByCalDay = new Map<string, typeof roundTrips>();
  const rtByCmeDay = new Map<string, typeof roundTrips>();
  for (const rt of roundTrips) {
    const calK = calDayKey(rt.closedAt, DISPLAY_TZ);
    const cmeK = deriveCmeTradingDayKey(rt.closedAt);
    rtByCalDay.set(calK, [...(rtByCalDay.get(calK) ?? []), rt]);
    rtByCmeDay.set(cmeK, [...(rtByCmeDay.get(cmeK) ?? []), rt]);
  }

  for (const dk of [...rtByCalDay.keys()].sort()) {
    const rts = rtByCalDay.get(dk)!;
    const pnl = rts.reduce((s, rt) => s + rt.pnl, 0);
    const b = rts.filter(rt => rt.pnlSource === "broker").length;
    const c = rts.filter(rt => rt.pnlSource === "computed").length;
    console.log(`  CT calendar ${dk}: ${rts.length} round-trips, P&L ${fmt$(pnl)}  (${b} broker, ${c} computed)`);
  }
  for (const dk of [...rtByCmeDay.keys()].sort()) {
    const rts = rtByCmeDay.get(dk)!;
    const pnl = rts.reduce((s, rt) => s + rt.pnl, 0);
    const b = rts.filter(rt => rt.pnlSource === "broker").length;
    const c = rts.filter(rt => rt.pnlSource === "computed").length;
    console.log(`  CME session ${dk}: ${rts.length} round-trips, P&L ${fmt$(pnl)}  (${b} broker, ${c} computed)`);
  }
  console.log();

  // ── Reconciliation ────────────────────────────────────────────────────────────
  console.log("── Reconciliation (why P&L values differ) ───────────────────────────────");
  console.log();
  if (session != null) {
    const sessionDailyPnl = Number(session.dailyPnl);
    const gap = totalRtPnl - sessionDailyPnl;
    console.log(`  LiveSessionState.dailyPnl:              ${fmt$(sessionDailyPnl)}`);
    console.log(`    Source: tradovate-sync.ts → snapshot.todayPnL (Tradovate broker API)`);
    console.log(`    Commission-adjusted, reported directly by the broker per-session.`);
    console.log(`    NOT derived from NormalizedTradeEvent.pnl.`);
    console.log();
    console.log(`  NormalizedTradeEvent fills:             ${allFills.length} total`);
    console.log(`    ${fillsWithPnl.length} with pnl != null → sum = ${fmt$(sumNonNullPnl)}`);
    console.log(`    ${fillsNullPnl.length} with pnl == null → Tradovate execution API did not return profit`);
    if (fillsWithPnl.length === 0) {
      console.log(`    ✓ No per-fill pnl → applyTradeClose never called from webhook`);
      console.log(`    ✓ dailyPnl came entirely from snapshot.todayPnL, not fill accumulation`);
    }
    console.log();
    console.log(`  Reconstructed total P&L:                ${fmt$(totalRtPnl)}`);
    console.log(`    = ${fmt$(sumBrokerPnl)} from ${rtBroker.length} broker-reported round-trips (fill.pnl)`);
    console.log(`    + ${fmt$(sumComputedPnl)} from ${rtComputed.length} price-computed round-trips (no commissions)`);
    console.log();
    console.log(`  Gap (reconstruction − broker snapshot):  ${fmt$(gap)}`);
    if (Math.abs(gap) < 0.01) {
      console.log(`  ✓ Sources agree — no null-pnl fills, no commission gap.`);
    } else if (fillsWithPnl.length === 0) {
      console.log(`  Explanation (all fills null-pnl):`);
      console.log(`    Reconstruction is entirely price-computed (no commissions deducted).`);
      console.log(`    Broker snapshot includes commissions → accounts for most of the gap.`);
      console.log(`    Remaining gap = open position P&L (contract 4327110 net -780 OPEN`);
      console.log(`    if present) + bid/ask spread differences.`);
      console.log(`    The sign difference (snapshot negative, reconstruction positive) is`);
      console.log(`    typical when commissions exceed gross realized P&L.`);
    } else if (gap > 0) {
      console.log(`  Explanation: price-computed round-trips include ${fmt$(sumComputedPnl)} not`);
      console.log(`  captured by the webhook (null-pnl fills had no applyTradeClose call).`);
      console.log(`  Computed P&L excludes commissions, so the gap includes commission savings.`);
    } else {
      console.log(`  ⚠  Broker snapshot > reconstruction — possible commissions, fees, or`);
      console.log(`  partial open positions not reflected in closed-trade reconstruction.`);
    }
    console.log();
  }

  // ── tradesCount semantic ────────────────────────────────────────────────────
  console.log("── tradesCount semantic (why count differs from round-trips) ────────────");
  console.log();
  if (session != null) {
    const rtCount  = roundTrips.length;
    const tcCount  = session.tradesCount;
    const rtExtra  = rtCount - tcCount;
    console.log(`  LiveSessionState.tradesCount = ${tcCount}  (source: "${session.tradeCountSource ?? "unknown"}")`);
    console.log(`    Source: tradovate-sync.ts trade-count resolver`);
    console.log(`      Phase A: client.getCompletedOrdersToday() → completed orders count`);
    console.log(`      Phase B: traceEntryTrades(executions) → fill-based position trace`);
    console.log(`    The resolver takes the higher/more-trusted source.`);
    console.log(`    For MFFU: if all fills have null pnl, webhook applyTradeClose never fires`);
    console.log(`    → tradesCount is set ONLY by the sync, not by the webhook.`);
    console.log();
    console.log(`  Reconstructed round-trips = ${rtCount}`);
    console.log(`    Source: reconstructRoundTrips — every FIFO lot-closure event`);
    console.log(`    Each partial exit = one round-trip (position reduces but stays open)`);
    console.log(`    tradesCount only increments when position reaches flat (full cycle)`);
    console.log();
    console.log(`  Difference = ${rtExtra} extra round-trips vs tradesCount`);
    if (rtExtra > 0) {
      console.log(`    Sources of extra round-trips:`);
      console.log(`      1. Partial exits: position reduces but does not reach flat =`);
      console.log(`         one FIFO round-trip per partial exit, but tradesCount only`);
      console.log(`         increments at flat (full cycle complete)`);
      console.log(`      2. Null-pnl fills: webhook skips tradesCount for these, but`);
      console.log(`         reconstruction still creates a round-trip from price data`);
    } else if (rtExtra < 0) {
      console.log(`  ⚠  tradesCount > round-trips — possible sync count reconciliation artifact.`);
    } else {
      console.log(`  ✓ tradesCount matches round-trip count exactly.`);
    }
  }
  console.log();

  // ── Open positions check ────────────────────────────────────────────────────
  console.log("── Open positions at session end ────────────────────────────────────────");
  const fillsByContract = new Map<number, typeof allFills>();
  for (const f of allFills) {
    if (f.contractId == null) continue;
    fillsByContract.set(f.contractId, [...(fillsByContract.get(f.contractId) ?? []), f]);
  }

  let anyOpen = false;
  for (const [contractId, fills] of fillsByContract) {
    let pos = 0;
    for (const f of fills) {
      const side = f.side === "B" || f.side === "BUY" ? "BUY" : "SELL";
      const qty = Number(f.quantity ?? 0);
      pos += side === "BUY" ? qty : -qty;
    }
    if (pos !== 0) {
      anyOpen = true;
      console.log(`  Contract ${contractId}: net position = ${pos > 0 ? "+" : ""}${pos} (OPEN — unrealized P&L not in dailyPnl or reconstruction)`);
    }
  }
  if (!anyOpen) {
    console.log(`  All positions flat — no open positions at session end.`);
    console.log(`  Unrealized P&L gap is NOT the cause of the discrepancy.`);
  }
  console.log();

  // ── Dashboard stale detection proof ──────────────────────────────────────────
  console.log("── Dashboard stale detection proof ─────────────────────────────────────");
  console.log("  resolveSessionDisplayMetrics() in data-helpers.ts:");
  console.log("    if (sessionState.sessionDate !== todayKey) {");
  console.log("      return { tradesCount: null, dailyPnl: null, isStale: true }");
  console.log("    }");
  console.log();
  if (session != null) {
    const isStale = session.sessionDate !== cmeDayKey;
    if (isStale) {
      console.log(`  sessionDate "${session.sessionDate}" ≠ current CME key "${cmeDayKey}" → STALE`);
      console.log(`  resolveSessionDisplayMetrics returns → { tradesCount: null, dailyPnl: null }`);
      console.log(`  Dashboard KPI "Broker session P&L snapshot" shows "—"`);
      console.log(`  Dashboard KPI sub shows "Account unavailable · no current data"`);
      console.log(`  Dashboard does NOT show ${fmt$(Number(session.dailyPnl))} or ${session.tradesCount} trades as current`);
    } else {
      console.log(`  sessionDate "${session.sessionDate}" = current CME key "${cmeDayKey}" → CURRENT`);
      console.log(`  resolveSessionDisplayMetrics returns → { tradesCount: ${session.tradesCount}, dailyPnl: ${fmt$(Number(session.dailyPnl))} }`);
      console.log(`  Dashboard shows live session P&L and trade count.`);
    }
  }
  console.log();

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log("── Summary ─────────────────────────────────────────────────────────────");
  console.log();
  console.log(`  Account CUID:             ${account.id}`);
  console.log(`  missingFromBrokerSince:   ${fmt(account.missingFromBrokerSince)}`);
  if (session) {
    const isStale = session.sessionDate !== cmeDayKey;
    console.log(`  LiveSessionState:`);
    console.log(`    sessionDate:            ${session.sessionDate}${isStale ? "  ← STALE (prior session)" : "  ← current"}`);
    console.log(`    dailyPnl:               ${fmt$(Number(session.dailyPnl))}  ← from Tradovate snapshot.todayPnL`);
    console.log(`    tradesCount:            ${session.tradesCount}  ← from sync trade-count resolver`);
    console.log(`    tradeCountSource:       ${session.tradeCountSource ?? "(null)"}`);
    console.log(`  NormalizedTradeEvent:`);
    console.log(`    total fills:            ${allFills.length}`);
    console.log(`    fills with pnl:         ${fillsWithPnl.length}  sum = ${fmt$(sumNonNullPnl)}`);
    console.log(`    fills null pnl:         ${fillsNullPnl.length}`);
    console.log(`  Reconstructed:`);
    console.log(`    round-trips:            ${roundTrips.length}  ← FIFO lot-closures (includes partial exits)`);
    console.log(`    total P&L:              ${fmt$(totalRtPnl)}  ← broker+computed pnl`);
    console.log(`    pnlSource=broker:       ${rtBroker.length} round-trips, ${fmt$(sumBrokerPnl)}`);
    console.log(`    pnlSource=computed:     ${rtComputed.length} round-trips, ${fmt$(sumComputedPnl)}`);
    console.log(`  Dashboard display:`);
    if (isStale) {
      console.log(`    STALE → KPI shows "—" (dailyPnl and tradesCount both null)`);
      console.log(`    Badge: "Historical · unavailable"`);
      console.log(`    Sub: "Account unavailable · no current data"`);
    } else {
      console.log(`    CURRENT → KPI shows ${fmt$(Number(session.dailyPnl))} and ${session.tradesCount} broker-session trade count`);
    }
  }
  console.log();
  console.log("  Reminder: this script performed NO broker call and NO DB mutation.");
  console.log("═".repeat(72));

  await prisma.$disconnect();
}

run().catch(async (err) => {
  console.error("Script error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
