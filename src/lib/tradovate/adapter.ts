import type { NormalizedEvent } from "@/lib/guardian-engine/types";
import type { TradovateOrderFill, TradovateOrder, TradovateAccountSummary } from "./types";

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
    occurredAt: new Date(fill.timestamp),
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
    occurredAt: new Date(order.timestamp),
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
    occurredAt: new Date(summary.timestamp),
    rawPayload: summary,
  };
}
