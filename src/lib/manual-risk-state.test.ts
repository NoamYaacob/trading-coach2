import test from "node:test";
import assert from "node:assert/strict";

import { computeManualRiskState } from "./manual-risk-state.ts";

function trade(input: { id: string; tradedAt: string; pnl: string }) {
  return {
    id: input.id,
    userId: "user-1",
    symbol: "MNQ",
    direction: "LONG",
    tradedAt: new Date(input.tradedAt),
    entryPrice: null,
    exitPrice: null,
    stopPrice: null,
    targetPrice: null,
    quantity: "1",
    pnl: input.pnl,
    riskAmount: null,
    rMultiple: null,
    strategy: null,
    notes: null,
    ruleBreached: false,
    breachReason: null,
    createdAt: new Date(input.tradedAt),
    updatedAt: new Date(input.tradedAt),
  };
}

test("manual risk summary counts saved loss trades", () => {
  const state = computeManualRiskState({
    rules: null,
    todayTrades: [
      trade({ id: "t1", tradedAt: "2026-04-29T14:57:00.000Z", pnl: "-125" }),
    ],
  });

  assert.equal(state.todayPnL, -125);
  assert.equal(state.todayTradesCount, 1);
  assert.equal(state.lossCount, 1);
  assert.equal(state.winCount, 0);
  assert.equal(state.consecutiveLosses, 1);
  assert.equal(state.largestLoss, 125);
});

test("manual risk loss streak resets after a profitable trade", () => {
  const state = computeManualRiskState({
    rules: null,
    todayTrades: [
      trade({ id: "t1", tradedAt: "2026-04-29T14:00:00.000Z", pnl: "-50" }),
      trade({ id: "t2", tradedAt: "2026-04-29T15:00:00.000Z", pnl: "75" }),
    ],
  });

  assert.equal(state.todayPnL, 25);
  assert.equal(state.todayTradesCount, 2);
  assert.equal(state.lossCount, 1);
  assert.equal(state.winCount, 1);
  assert.equal(state.consecutiveLosses, 0);
});
