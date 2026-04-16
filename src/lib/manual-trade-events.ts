import { TraderCurrentState, type DailySessionEvent } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { ManualEventSignals } from "@/lib/rule-engine";

export type ManualTradeEventType =
  | "trade_opened"
  | "trade_closed"
  | "win"
  | "loss"
  | "pnl_update"
  | "rule_breach"
  | "manual_note";

export const MANUAL_TRADE_EVENT_TYPES: readonly ManualTradeEventType[] = [
  "trade_opened",
  "trade_closed",
  "win",
  "loss",
  "pnl_update",
  "rule_breach",
  "manual_note",
] as const;

export function isManualTradeEventType(value: string): value is ManualTradeEventType {
  return (MANUAL_TRADE_EVENT_TYPES as readonly string[]).includes(value);
}

export function humanizeManualEventType(eventType: ManualTradeEventType): string {
  switch (eventType) {
    case "trade_opened":
      return "Trade opened";
    case "trade_closed":
      return "Trade closed";
    case "win":
      return "Win";
    case "loss":
      return "Loss";
    case "pnl_update":
      return "P&L update";
    case "rule_breach":
      return "Rule breach";
    case "manual_note":
      return "Note";
  }
}

/**
 * Log a manual trade or session event for the current day.
 * Stored as a DailySessionEvent with source="manual" so it integrates into
 * the existing activity timeline without requiring a schema change.
 * This is a manual entry path — no live broker is connected.
 */
export async function logManualTradeEvent(
  userId: string,
  eventType: ManualTradeEventType,
  options?: { note?: string; pnlAmount?: number },
) {
  const note = options?.note?.trim() ?? "";
  const pnlAmount = options?.pnlAmount ?? null;

  return prisma.dailySessionEvent.create({
    data: {
      userId,
      source: "manual",
      eventType: "TRADE_EVENT",
      detectedIntent: eventType,
      message: note || humanizeManualEventType(eventType),
      traderState: TraderCurrentState.NONE,
      cooldownActive: false,
      metadataJson: pnlAmount !== null ? { pnlAmount } : undefined,
    },
  });
}

/**
 * Fetch today's manual trade events for a user.
 * Returns events sorted ascending by createdAt.
 */
export async function getTodayManualEvents(userId: string): Promise<DailySessionEvent[]> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return prisma.dailySessionEvent.findMany({
    where: {
      userId,
      source: "manual",
      eventType: "TRADE_EVENT",
      createdAt: { gte: start, lt: end },
    },
    orderBy: { createdAt: "asc" },
  });
}

function extractPnlAmount(metadataJson: DailySessionEvent["metadataJson"]): number | null {
  if (
    metadataJson !== null &&
    typeof metadataJson === "object" &&
    !Array.isArray(metadataJson) &&
    "pnlAmount" in metadataJson
  ) {
    const raw = (metadataJson as Record<string, unknown>).pnlAmount;
    if (typeof raw === "number" && isFinite(raw)) {
      return raw;
    }
  }
  return null;
}

/**
 * Derive structured session signals from a set of DailySessionEvents.
 * Filters internally to source="manual" TRADE_EVENT records only, so callers
 * can pass the full today-events array without pre-filtering.
 *
 * Events are processed in chronological order.
 * - Consecutive losses tracks the current streak (reset on win).
 * - netPnL is null when no PnL amounts were provided in any event.
 */
export function deriveManualEventSignals(events: DailySessionEvent[]): ManualEventSignals {
  const relevant = [...events]
    .filter((e) => e.source === "manual" && e.eventType === "TRADE_EVENT")
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  let winCount = 0;
  let lossCount = 0;
  let consecutiveLosses = 0;
  let pnlSum = 0;
  let hasPnLData = false;
  let hasRuleBreach = false;
  let tradeCount = 0;

  for (const event of relevant) {
    switch (event.detectedIntent) {
      case "win": {
        winCount++;
        consecutiveLosses = 0; // win resets the streak
        const pnl = extractPnlAmount(event.metadataJson);
        if (pnl !== null) {
          pnlSum += pnl;
          hasPnLData = true;
        }
        break;
      }
      case "loss": {
        lossCount++;
        consecutiveLosses++;
        const pnl = extractPnlAmount(event.metadataJson);
        if (pnl !== null) {
          pnlSum += pnl;
          hasPnLData = true;
        }
        break;
      }
      case "pnl_update": {
        const pnl = extractPnlAmount(event.metadataJson);
        if (pnl !== null) {
          pnlSum += pnl;
          hasPnLData = true;
        }
        break;
      }
      case "trade_opened":
      case "trade_closed":
        tradeCount++;
        break;
      case "rule_breach":
        hasRuleBreach = true;
        break;
      // "manual_note" — no signals
    }
  }

  return {
    tradeCount,
    winCount,
    lossCount,
    consecutiveLosses,
    netPnL: hasPnLData ? pnlSum : null,
    hasRuleBreach,
    tradeActivityLogged: tradeCount > 0,
  };
}
