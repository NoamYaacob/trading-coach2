#!/usr/bin/env tsx
/**
 * Session vs Calendar Day — P&L Source Diagnostic. READ ONLY, zero writes.
 *
 * Explains why LiveSessionState.dailyPnl and reconstructed round-trip P&L
 * show DIFFERENT values for the same account and same CME session:
 *
 *   LiveSessionState.dailyPnl
 *     Source:  Webhook path. applyTradeClose(fill.pnl) called for every fill
 *              where Tradovate reports a `profit` value (pnl != null).
 *              Fills where pnl == null are COMPLETELY SKIPPED.
 *              Tradovate's `profit` field is commission-adjusted.
 *
 *   Reconstructed round-trip P&L (P&L calendar, Equity curve)
 *     Source:  NormalizedTradeEvent fills → reconstructRoundTrips() FIFO.
 *              Uses fill.pnl (pnlSource="broker") when non-null.
 *              For fills where pnl == null: computes from price difference
 *              (pnlSource="computed") — NO commissions deducted.
 *
 *   tradesCount
 *     Source:  Webhook path. Incremented only when position returns to flat
 *              OR reverses direction AND pnl != null.
 *              Does NOT count partial exits (position shrinks but stays open).
 *
 *   Round-trip count
 *     Source:  reconstructRoundTrips FIFO. Counts every lot-closure event,
 *              including partial exits and null-pnl fills. Higher than
 *              tradesCount because partial exits = one round-trip each.
 *
 * Example (MFFUSFRPD133936252, CME session 2026-05-31):
 *   dailyPnl = -$404   (sum of non-null fill.pnl, commissions included)
 *   reconstruction = +$168.50  (non-null broker pnl + computed price-based pnl)
 *   gap = +$572.50 = price-computed P&L for null-pnl fills (no commissions)
 *   tradesCount = 47   (position cycles with pnl != null)
 *   round-trips = 74   (all FIFO lot-closures including partial exits)
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
      consecutiveLosses: true,
      riskState: true,
      lastTradeAt: true,
    },
  });

  console.log("── LiveSessionState ─────────────────────────────────────────────────────");
  console.log("  Source: webhook → applyTradeClose(fill.pnl, ...) per non-null pnl fill");
  console.log("  dailyPnl = cumulative sum of Tradovate-reported fill.profit (non-null only)");
  console.log("  tradesCount = position cycles: times net position returned to flat or reversed");
  console.log("                (only incremented when fill.pnl != null AND position logic matched)");
  console.log();
  if (!session) {
    console.log("  (no LiveSessionState row — account never had a session)");
  } else {
    console.log(`  ${pad("sessionDate:", 22)} ${session.sessionDate}`);
    console.log(`  ${pad("dailyPnl:", 22)} ${fmt$(Number(session.dailyPnl))}`);
    console.log(`  ${pad("tradesCount:", 22)} ${session.tradesCount}`);
    console.log(`  ${pad("consecutiveLosses:", 22)} ${session.consecutiveLosses}`);
    console.log(`  ${pad("riskState:", 22)} ${session.riskState}`);
    console.log(`  ${pad("lastTradeAt:", 22)} ${fmt(session.lastTradeAt)}`);

    if (session.sessionDate !== cmeDayKey) {
      console.log();
      console.log(`  NOTE: sessionDate "${session.sessionDate}" ≠ current CME key "${cmeDayKey}"`);
      console.log(`  Dashboard will show "—" (stale session). This account's session data`);
      console.log(`  is from a previous CME day.`);
    }
  }
  console.log();

  // ── Raw fills for the session ─────────────────────────────────────────────────
  // Load all fills since the session date's CME start (or 48h fallback)
  const sessionStartForLookup = session != null
    ? (() => {
        // Compute the CME session start for the stored sessionDate
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
  console.log(`  Total fills:              ${allFills.length}`);
  console.log(`  Fills with pnl != null:   ${fillsWithPnl.length}  → sum = ${fmt$(sumNonNullPnl)}`);
  console.log(`  Fills with pnl == null:   ${fillsNullPnl.length}`);
  console.log();
  if (session != null) {
    const sessionDailyPnl = Number(session.dailyPnl);
    const diff = Math.abs(sumNonNullPnl - sessionDailyPnl);
    if (diff < 0.01) {
      console.log(`  ✓ sum(non-null fill pnl) = ${fmt$(sumNonNullPnl)} matches LiveSessionState.dailyPnl = ${fmt$(sessionDailyPnl)}`);
    } else {
      console.log(`  ⚠  sum(non-null fill pnl) = ${fmt$(sumNonNullPnl)} ≠ LiveSessionState.dailyPnl = ${fmt$(sessionDailyPnl)}`);
      console.log(`     Difference: ${fmt$(sumNonNullPnl - sessionDailyPnl)}`);
      console.log(`     Possible cause: some fills were added via sync after session reset,`);
      console.log(`     or out-of-order events. Check the sync path.`);
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

  const roundTrips = reconstructRoundTrips(fillInput).sort(
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
  console.log("  pnlSource=broker → uses fill.pnl (Tradovate-reported, commission-adjusted)");
  console.log("  pnlSource=computed → price difference (entry avg - exit price, NO commissions)");
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
    console.log(`    = sum of fill.pnl where Tradovate reported profit (${fillsWithPnl.length} of ${allFills.length} fills)`);
    console.log(`    = Tradovate commission-adjusted P&L`);
    console.log();
    console.log(`  Reconstructed total P&L:                ${fmt$(totalRtPnl)}`);
    console.log(`    = ${fmt$(sumBrokerPnl)} from ${rtBroker.length} broker-reported round-trips`);
    console.log(`    + ${fmt$(sumComputedPnl)} from ${rtComputed.length} price-computed round-trips (no commissions)`);
    console.log();
    console.log(`  Gap (reconstruction − session):         ${fmt$(gap)}`);
    if (Math.abs(gap) < 0.01) {
      console.log(`  ✓ Sources agree — no null-pnl fills, no commission gap.`);
    } else if (gap > 0) {
      console.log(`  Explanation: price-computed round-trips add ${fmt$(sumComputedPnl)} that was`);
      console.log(`  not captured by the webhook (null pnl fills → no applyTradeClose call).`);
      console.log(`  Computed P&L excludes commissions, so the gap includes both:`);
      console.log(`    a) P&L from fills Tradovate did not report profit for`);
      console.log(`    b) Commission savings vs broker-reported (commission-adjusted) fills`);
    } else {
      console.log(`  ⚠  session P&L > reconstruction P&L — may indicate fees charged by broker`);
      console.log(`  outside of individual fill profit, or partial open positions.`);
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
    console.log(`  LiveSessionState.tradesCount = ${tcCount}`);
    console.log(`    = position cycles: times net position returned to flat OR reversed direction`);
    console.log(`    = only incremented when fill.pnl != null AND classification matched`);
    console.log(`    = what prop firms typically call "number of trades"`);
    console.log();
    console.log(`  Reconstructed round-trips = ${rtCount}`);
    console.log(`    = every FIFO lot-closure event (each partial exit = one round-trip)`);
    console.log(`    = includes null-pnl fills (position tracked even without reported profit)`);
    console.log();
    console.log(`  Difference = ${rtExtra} extra round-trips vs tradesCount`);
    if (rtExtra > 0) {
      console.log(`    Sources of extra round-trips:`);
      console.log(`      1. Partial exits (position reduces but does not reach flat) =`);
      console.log(`         one round-trip per partial exit, but tradesCount only increments at flat`);
      console.log(`      2. Null-pnl fills (reversal/reduction where broker did not report profit) =`);
      console.log(`         webhook skips tradesCount increment, reconstruction still creates RT`);
    } else if (rtExtra < 0) {
      console.log(`  ⚠  tradesCount > round-trips — possible sync count reconciliation artifact.`);
    } else {
      console.log(`  ✓ tradesCount matches round-trip count exactly.`);
    }
  }
  console.log();

  // ── Open positions check ────────────────────────────────────────────────────
  console.log("── Open positions at session end ────────────────────────────────────────");
  const { classifyFill } = await import("../src/lib/guardian-engine/fill-classifier.ts");
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
      console.log(`  Contract ${contractId}: net position = ${pos > 0 ? "+" : ""}${pos} (OPEN — unrealized P&L not in dailyPnl)`);
    }
  }
  if (!anyOpen) {
    console.log(`  All positions flat — no open positions at session end.`);
    console.log(`  Unrealized P&L gap is NOT the cause of the discrepancy.`);
  }
  console.log();

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log("── Summary ─────────────────────────────────────────────────────────────");
  console.log();
  console.log(`  Account CUID:             ${account.id}`);
  console.log(`  missingFromBrokerSince:   ${fmt(account.missingFromBrokerSince)}`);
  if (session) {
    console.log(`  LiveSessionState:`);
    console.log(`    sessionDate:            ${session.sessionDate}`);
    console.log(`    dailyPnl:               ${fmt$(Number(session.dailyPnl))}  ← webhook fill accumulation`);
    console.log(`    tradesCount:            ${session.tradesCount}  ← position cycles (flat returns)`);
    console.log(`  Reconstructed:`);
    console.log(`    round-trips:            ${roundTrips.length}  ← FIFO lot-closures (includes partial exits)`);
    console.log(`    total P&L:              ${fmt$(totalRtPnl)}  ← broker+computed pnl`);
    console.log(`    pnlSource=broker:       ${rtBroker.length} round-trips, ${fmt$(sumBrokerPnl)}`);
    console.log(`    pnlSource=computed:     ${rtComputed.length} round-trips, ${fmt$(sumComputedPnl)}`);
    console.log(`  Gap explanation:`);
    console.log(`    ${fillsNullPnl.length} fills had pnl=null → not in dailyPnl, but computed by reconstruction`);
    console.log(`    ${fmt$(sumComputedPnl)} = price-based P&L for those fills (commissions excluded)`);
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
