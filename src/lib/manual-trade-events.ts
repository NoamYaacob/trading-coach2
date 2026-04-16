import { TraderCurrentState } from "@prisma/client";

import { prisma } from "@/lib/db";

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
