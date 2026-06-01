#!/usr/bin/env tsx
/**
 * Session vs Calendar Day Data Diagnostic — READ ONLY, zero writes.
 *
 * Explains why the Dashboard "Broker session P&L" and the P&L Calendar show
 * DIFFERENT values for the same day and same account.  Root cause: the two
 * panels use DIFFERENT time boundaries:
 *
 *   Dashboard KPI   — CME Globex session P&L: LiveSessionState.dailyPnl.
 *                     The CME session starts at 17:00 CT (not midnight).
 *                     If you're viewing the dashboard at, say, 10:00 AM CT on
 *                     June 1, the current CME session opened at 17:00 CT
 *                     May 31.  LiveSessionState only contains fills from
 *                     AFTER that 17:00 CT open — i.e. the overnight / morning
 *                     fills, NOT the full calendar day.
 *
 *   P&L Calendar    — Calendar-day round-trip P&L: NormalizedTradeEvent
 *                     fills reconstructed into round-trips, bucketed by
 *                     closedAt (midnight-to-midnight in the display timezone).
 *                     The June 1 calendar cell includes ALL round-trips that
 *                     closed on June 1 CT, regardless of which CME session
 *                     they belong to.
 *
 * For the June 1 discrepancy example:
 *   LiveSessionState["2026-06-01"] (CME session opened 17:00 CT June 1)
 *     → only fills from 17:00 CT June 1 onwards → -$404, 47 trades
 *   P&L Calendar June 1 cell
 *     → fills 00:00–23:59 CT June 1 = morning (CME session "2026-05-31") +
 *       evening (CME session "2026-06-01") → +$168.50, 74 trades
 *
 * SAFETY CONTRACT:
 *   - Prisma: findFirst / findUnique / findMany / count only.
 *   - No create / update / updateMany / upsert / delete / deleteMany / raw.
 *   - Does NOT call any enforcement or session function.
 *   - No fetch / axios / Tradovate client. No token or secret printing.
 */

import { resolve } from "path";

import { config } from "dotenv";
config({ path: resolve(process.cwd(), ".env.local") });

import { prisma } from "../src/lib/db.ts";
import { deriveCmeTradingDayKey, deriveCmeTradingDaySessionStart } from "../src/lib/trading-day.ts";
import { reconstructRoundTrips, type FillInput } from "../src/lib/trades/round-trips.ts";

// Default target; override with first CLI arg, e.g.:
//   npx tsx scripts/inspect-session-calendar-data.ts DEMO7433035
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

async function run(): Promise<void> {
  const now = new Date();
  const cmeDayKey = deriveCmeTradingDayKey(now);
  const cmeSessionStart = deriveCmeTradingDaySessionStart(now);
  const calendarTodayKey = calDayKey(now, DISPLAY_TZ);

  console.log("=".repeat(72));
  console.log("Session vs Calendar Day Diagnostic — READ ONLY");
  console.log("=".repeat(72));
  console.log(`  Run time (UTC):           ${now.toISOString()}`);
  console.log(`  CT calendar day:          ${calendarTodayKey}`);
  console.log(`  CME session day key:      ${cmeDayKey}`);
  console.log(`  CME session opened at:    ${cmeSessionStart.toISOString()}  (${cmeSessionStart.toLocaleString("en-US", { timeZone: DISPLAY_TZ, timeStyle: "short", dateStyle: "short" })} CT)`);
  console.log();
  if (cmeDayKey !== calendarTodayKey) {
    console.log("  ⚠️  CME session day ≠ calendar today — fills from earlier today belong to the");
    console.log(`  PREVIOUS CME session ("${cmeDayKey}"). The P&L calendar June 1 cell will include`);
    console.log(`  those fills but LiveSessionState["${calendarTodayKey}"] will NOT.`);
    console.log();
  }

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
    console.error(`Usage: npx tsx scripts/inspect-session-calendar-data.ts <LABEL_OR_EXTERNAL_ID>`);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log("── Account ─────────────────────────────────────────────────────────────");
  console.log(`  id:                   ${account.id}`);
  console.log(`  label:                ${fmt(account.label)}`);
  console.log(`  displayName:          ${fmt(account.displayName)}`);
  console.log(`  externalAccountId:    ${fmt(account.externalAccountId)}`);
  console.log(`  protectionStatus:     ${account.protectionStatus}`);
  console.log(`  missingFromBroker:    ${fmt(account.missingFromBrokerSince)}`);
  console.log(`  brokerConn.env:       ${fmt(account.brokerConnection?.env)}`);
  console.log(`  brokerConn.status:    ${fmt(account.brokerConnection?.connectionStatus)}`);
  console.log();

  // ── LiveSessionState (broker session metrics) ──────────────────────────────
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

  console.log("── LiveSessionState (broker session — KPI dashboard card source) ────────");
  if (!session) {
    console.log("  (no LiveSessionState row exists for this account)");
  } else {
    console.log(`  sessionDate:          ${session.sessionDate}`);
    console.log(`  dailyPnl:             ${fmt$(Number(session.dailyPnl))}`);
    console.log(`  tradesCount:          ${session.tradesCount}`);
    console.log(`  consecutiveLosses:    ${session.consecutiveLosses}`);
    console.log(`  riskState:            ${session.riskState}`);
    console.log(`  lastTradeAt:          ${fmt(session.lastTradeAt)}`);
    if (session.sessionDate === cmeDayKey) {
      console.log(`  ✓ sessionDate matches current CME day key "${cmeDayKey}"`);
      console.log(`    → These are fills from ${cmeSessionStart.toLocaleString("en-US", { timeZone: DISPLAY_TZ, timeStyle: "short", dateStyle: "short" })} CT onwards.`);
    } else {
      console.log(`  ⚠️  sessionDate "${session.sessionDate}" ≠ current CME key "${cmeDayKey}"`);
      console.log(`    → Dashboard will show "—" (stale session, resolveSessionDisplayMetrics returns null).`);
    }
  }
  console.log();

  // ── NormalizedTradeEvent count (raw fills) ────────────────────────────────
  // Count fills for the current calendar day (CT midnight-to-midnight)
  const calDayStart_CT = new Date(`${calendarTodayKey}T00:00:00`);
  // Build the inclusive range for the CT calendar day in UTC
  const fmt_start = new Intl.DateTimeFormat("en-CA", { timeZone: DISPLAY_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  // We need UTC boundaries for the CT calendar day
  // CT midnight = calendarTodayKey 00:00:00 CT
  const ctMidnightUtc = new Date(
    new Intl.DateTimeFormat("sv-SE", { timeZone: DISPLAY_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now) + "T00:00:00"
  );
  // Approximate: build boundaries by iterating (simpler: use a known UTC range)
  // Get exact CT midnight UTC by finding when CT calendar date changes
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayCtKey = calDayKey(yesterday, DISPLAY_TZ);
  // Since we care about today, use the last 48h window and filter
  const since48h = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const allFillsToday = await prisma.normalizedTradeEvent.findMany({
    where: {
      accountId: account.id,
      side: { not: null },
      quantity: { not: null },
      price: { not: null },
      occurredAt: { gte: since48h },
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

  // Bucket fills by CT calendar day
  const fillsByCalDay = new Map<string, typeof allFillsToday>();
  for (const f of allFillsToday) {
    const k = calDayKey(f.occurredAt, DISPLAY_TZ);
    const arr = fillsByCalDay.get(k) ?? [];
    arr.push(f);
    fillsByCalDay.set(k, arr);
  }

  // Also bucket fills by CME session day
  const fillsByCmeDay = new Map<string, typeof allFillsToday>();
  for (const f of allFillsToday) {
    const k = deriveCmeTradingDayKey(f.occurredAt);
    const arr = fillsByCmeDay.get(k) ?? [];
    arr.push(f);
    fillsByCmeDay.set(k, arr);
  }

  console.log("── NormalizedTradeEvent fills (last 48h, bucketed by CT calendar day) ───");
  const calDayKeys = [...fillsByCalDay.keys()].sort();
  if (calDayKeys.length === 0) {
    console.log("  (no fills in last 48h)");
  }
  for (const dk of calDayKeys) {
    const fills = fillsByCalDay.get(dk)!;
    console.log(`  CT calendar day ${dk}: ${fills.length} fills`);
  }
  console.log();

  console.log("── NormalizedTradeEvent fills (last 48h, bucketed by CME session day) ───");
  const cmeDayKeys = [...fillsByCmeDay.keys()].sort();
  if (cmeDayKeys.length === 0) {
    console.log("  (no fills in last 48h)");
  }
  for (const dk of cmeDayKeys) {
    const fills = fillsByCmeDay.get(dk)!;
    console.log(`  CME session day ${dk}: ${fills.length} fills`);
  }
  console.log();

  // ── Reconstructed round-trips (what the P&L calendar shows) ──────────────
  const fillInput: FillInput[] = allFillsToday.map((f) => ({
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

  // Bucket round-trips by CT calendar day
  const rtByCalDay = new Map<string, typeof roundTrips>();
  for (const rt of roundTrips) {
    const k = calDayKey(rt.closedAt, DISPLAY_TZ);
    const arr = rtByCalDay.get(k) ?? [];
    arr.push(rt);
    rtByCalDay.set(k, arr);
  }

  // Bucket round-trips by CME session day (based on closedAt)
  const rtByCmeDay = new Map<string, typeof roundTrips>();
  for (const rt of roundTrips) {
    const k = deriveCmeTradingDayKey(rt.closedAt);
    const arr = rtByCmeDay.get(k) ?? [];
    arr.push(rt);
    rtByCmeDay.set(k, arr);
  }

  console.log("── Round-trips (P&L calendar source — bucketed by CT calendar day) ──────");
  const rtCalDayKeys = [...rtByCalDay.keys()].sort();
  if (rtCalDayKeys.length === 0) {
    console.log("  (no closed round-trips in last 48h)");
  }
  for (const dk of rtCalDayKeys) {
    const rts = rtByCalDay.get(dk)!;
    const pnl = rts.reduce((s, t) => s + t.pnl, 0);
    console.log(`  CT calendar day ${dk}: ${rts.length} round-trips, P&L = ${fmt$(pnl)}`);
  }
  console.log();

  console.log("── Round-trips (bucketed by CME session day of closedAt) ────────────────");
  const rtCmeDayKeys = [...rtByCmeDay.keys()].sort();
  if (rtCmeDayKeys.length === 0) {
    console.log("  (no closed round-trips in last 48h)");
  }
  for (const dk of rtCmeDayKeys) {
    const rts = rtByCmeDay.get(dk)!;
    const pnl = rts.reduce((s, t) => s + t.pnl, 0);
    console.log(`  CME session day ${dk}: ${rts.length} round-trips, P&L = ${fmt$(pnl)}`);
  }
  console.log();

  // ── Boundary explanation ─────────────────────────────────────────────────
  console.log("── Boundary Explanation ─────────────────────────────────────────────────");
  console.log();
  console.log("  DASHBOARD KPI 'Broker session P&L':                                    ");
  console.log(`    Source:     LiveSessionState.dailyPnl / .tradesCount`);
  console.log(`    Boundary:   CME session opened ${cmeSessionStart.toLocaleString("en-US", { timeZone: DISPLAY_TZ, timeStyle: "short", dateStyle: "short" })} CT (${cmeSessionStart.toISOString()})`);
  console.log(`    Key:        CME day = "${cmeDayKey}"`);
  if (session) {
    console.log(`    Shows:      ${fmt$(Number(session.dailyPnl))}, ${session.tradesCount} trades`);
  }
  console.log();
  console.log("  P&L CALENDAR cell (e.g. June 1):                                       ");
  console.log(`    Source:     reconstructRoundTrips(NormalizedTradeEvent fills).closedAt`);
  console.log(`    Boundary:   Calendar day (midnight CT–midnight CT)`);
  const calTodayRts = rtByCalDay.get(calendarTodayKey) ?? [];
  const calTodayPnl = calTodayRts.reduce((s, t) => s + t.pnl, 0);
  console.log(`    Shows:      ${fmt$(calTodayPnl)}, ${calTodayRts.length} round-trips for "${calendarTodayKey}"`);
  console.log();
  if (session && calendarTodayKey !== cmeDayKey) {
    console.log("  KEY FINDING: CME session key ≠ calendar today key.");
    console.log(`  Round-trips closed between 00:00 CT ${calendarTodayKey} and ${cmeSessionStart.toLocaleString("en-US", { timeZone: DISPLAY_TZ, timeStyle: "short" })} CT`);
    console.log(`  belong to CME session "${cmeDayKey}" (old session) but appear in calendar day "${calendarTodayKey}".`);
    console.log(`  Those fills are NOT in LiveSessionState["${calendarTodayKey}"] — they are in the`);
    console.log(`  session that was already reset. This explains the discrepancy.`);
  } else if (session && calendarTodayKey === cmeDayKey && Number(session.dailyPnl).toFixed(2) !== calTodayPnl.toFixed(2)) {
    console.log("  NOTE: CME session key = calendar today key, but values still differ.");
    console.log("  LiveSessionState.dailyPnl accumulates every fill (open + closing).");
    console.log("  Round-trip P&L only counts COMPLETED round-trips (closing fill PnL).");
    console.log("  If there are open positions, dailyPnl will include partial fills.");
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
