import type { NormalizedEvent } from "@/lib/guardian-engine/types";
import type { TradovateOrderFill, TradovateOrder, TradovateAccountSummary } from "./types";

function parseTimestamp(ts: string | undefined | null, field: string): Date {
  if (!ts) throw new Error(`Missing ${field}`);
  const date = new Date(ts);
  if (isNaN(date.getTime())) throw new Error(`Invalid ${field}: "${ts}"`);
  return date;
}

export function normalizeFill(
  internalAccountId: string,
  fill: TradovateOrderFill,
): NormalizedEvent {
  return {
    accountId: internalAccountId,
    eventType: "trade_closed",
    externalTradeId: String(fill.id),
    side: fill.action === "Buy" ? "BUY" : "SELL",
    quantity: fill.qty,
    price: fill.price,
    pnl: fill.profit,
    occurredAt: parseTimestamp(fill.timestamp, "fill.timestamp"),
    rawPayload: fill,
  };
}

export function normalizeOrder(
  internalAccountId: string,
  order: TradovateOrder,
): NormalizedEvent {
  return {
    accountId: internalAccountId,
    eventType: "trade_opened",
    externalTradeId: String(order.id),
    side: order.action === "Buy" ? "BUY" : "SELL",
    quantity: order.qty,
    price: order.price,
    occurredAt: parseTimestamp(order.timestamp, "order.timestamp"),
    rawPayload: order,
  };
}

export function normalizeAccountSummary(
  internalAccountId: string,
  summary: TradovateAccountSummary,
): NormalizedEvent {
  return {
    accountId: internalAccountId,
    eventType: "daily_pnl_updated",
    pnl: summary.realizedPnl,
    occurredAt: parseTimestamp(summary.timestamp, "summary.timestamp"),
    rawPayload: summary,
  };
}
