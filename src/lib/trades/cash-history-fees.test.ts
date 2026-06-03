import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  classifyCashRow,
  aggregateCashHistory,
  aggregateByPairedTrade,
  cashHistoryDayNet,
  normalizeCashBalanceLogRows,
  type CashHistoryRow,
  type RawCashBalanceLogRow,
} from "./cash-history-fees.ts";

function row(over: Partial<CashHistoryRow>): CashHistoryRow {
  return {
    accountId: over.accountId ?? "1868411",
    contract: over.contract ?? "MNQM6",
    date: over.date ?? "2026-06-02",
    delta: over.delta ?? 0,
    changeType: over.changeType ?? "Commission",
  };
}

// The exact rows from the Cash History PDF for account 1868411, 2026-06-02.
// Two fill sides at 15:43:40 and 15:43:58, each -0.95 in fees, then +1.50 paired.
const PDF_1868411_20260602: CashHistoryRow[] = [
  row({ delta: -0.35, changeType: "Exchange Fee" }),
  row({ delta: -0.19, changeType: "Clearing Fee" }),
  row({ delta: -0.02, changeType: "Nfa Fee" }),
  row({ delta: -0.39, changeType: "Commission" }),
  row({ delta: -0.35, changeType: "Exchange Fee" }),
  row({ delta: -0.19, changeType: "Clearing Fee" }),
  row({ delta: -0.02, changeType: "Nfa Fee" }),
  row({ delta: -0.39, changeType: "Commission" }),
  row({ delta: 1.5, changeType: "Trade Paired" }),
];

describe("classifyCashRow", () => {
  it("recognizes the four fee types (case-insensitive)", () => {
    assert.equal(classifyCashRow("Exchange Fee"), "fee");
    assert.equal(classifyCashRow("Clearing Fee"), "fee");
    assert.equal(classifyCashRow("Nfa Fee"), "fee");
    assert.equal(classifyCashRow("Commission"), "fee");
    assert.equal(classifyCashRow("  commission  "), "fee");
  });
  it("recognizes Trade Paired as P&L", () => {
    assert.equal(classifyCashRow("Trade Paired"), "pnl");
    assert.equal(classifyCashRow("trade paired"), "pnl");
  });
  it("treats funding/subscription/unknown as other", () => {
    assert.equal(classifyCashRow("Fund Transaction"), "other");
    assert.equal(classifyCashRow("Entitlement Subscription"), "other");
    assert.equal(classifyCashRow(""), "other");
    assert.equal(classifyCashRow(null), "other");
  });
});

describe("aggregateCashHistory — the 1868411 PDF example", () => {
  it("tradePnl=+1.50, fees=-1.90, netPnl=-0.40", () => {
    const out = aggregateCashHistory(PDF_1868411_20260602, "1868411");
    assert.equal(out.length, 1, "one (account, contract, day) group");
    const g = out[0]!;
    assert.equal(g.accountId, "1868411");
    assert.equal(g.contract, "MNQM6");
    assert.equal(g.date, "2026-06-02");
    assert.equal(g.tradePnl, 1.5, "Trade Paired sum is +1.50");
    assert.equal(g.fees, -1.9, "fee deltas sum to -1.90 (already negative)");
    assert.equal(g.netPnl, -0.4, "net = 1.50 + (-1.90) = -0.40");
    assert.equal(g.feesAvailable, true);
  });
});

describe("aggregateCashHistory — account isolation", () => {
  it("never mixes fees from another account", () => {
    const rows: CashHistoryRow[] = [
      ...PDF_1868411_20260602,
      // A different account on the same day/contract with huge fees + P&L.
      row({ accountId: "9999999", delta: -500, changeType: "Commission" }),
      row({ accountId: "9999999", delta: 500, changeType: "Trade Paired" }),
    ];
    const out = aggregateCashHistory(rows, "1868411");
    assert.equal(out.length, 1, "only the requested account's group");
    assert.equal(out[0]!.fees, -1.9, "other account's -500 fee must not leak in");
    assert.equal(out[0]!.netPnl, -0.4);
  });

  it("returns empty when no rows match the account", () => {
    const out = aggregateCashHistory(PDF_1868411_20260602, "0000000");
    assert.deepEqual(out, []);
  });
});

describe("aggregateCashHistory — multiple contracts", () => {
  it("groups fees and P&L per contract independently", () => {
    const rows: CashHistoryRow[] = [
      row({ contract: "MNQM6", delta: -0.95, changeType: "Commission" }),
      row({ contract: "MNQM6", delta: 1.5, changeType: "Trade Paired" }),
      row({ contract: "MESM6", delta: -1.0, changeType: "Commission" }),
      row({ contract: "MESM6", delta: 4.0, changeType: "Trade Paired" }),
    ];
    const out = aggregateCashHistory(rows, "1868411");
    const mnq = out.find((g) => g.contract === "MNQM6")!;
    const mes = out.find((g) => g.contract === "MESM6")!;
    assert.equal(mnq.netPnl, 0.55, "MNQM6: 1.50 - 0.95 = 0.55");
    assert.equal(mes.netPnl, 3.0, "MESM6: 4.00 - 1.00 = 3.00");
  });
});

describe("aggregateCashHistory — multiple days", () => {
  it("keeps each trading day separate", () => {
    const rows: CashHistoryRow[] = [
      row({ date: "2026-06-02", delta: 1.5, changeType: "Trade Paired" }),
      row({ date: "2026-06-02", delta: -1.9, changeType: "Commission" }),
      row({ date: "2026-05-04", delta: 11.0, changeType: "Trade Paired" }),
      row({ date: "2026-05-04", delta: -0.95, changeType: "Commission" }),
    ];
    const out = aggregateCashHistory(rows, "1868411");
    assert.equal(out.length, 2);
    assert.equal(out.find((g) => g.date === "2026-06-02")!.netPnl, -0.4);
    assert.equal(out.find((g) => g.date === "2026-05-04")!.netPnl, 10.05);
  });
});

describe("aggregateCashHistory — honesty when fees missing", () => {
  it("feesAvailable=false and net falls back to tradePnl when no fee rows", () => {
    const rows: CashHistoryRow[] = [
      row({ delta: 1.5, changeType: "Trade Paired" }),
    ];
    const out = aggregateCashHistory(rows, "1868411");
    assert.equal(out[0]!.tradePnl, 1.5);
    assert.equal(out[0]!.fees, 0);
    assert.equal(out[0]!.netPnl, 1.5, "no fees → net equals tradePnl numerically");
    assert.equal(out[0]!.feesAvailable, false, "but feesAvailable=false flags it as NOT truly net");
  });
});

describe("aggregateByPairedTrade — paired trade window", () => {
  it("the 1868411 PDF case: one paired trade, fees -1.90 attributed, net -0.40", () => {
    const out = aggregateByPairedTrade(PDF_1868411_20260602, "1868411");
    assert.equal(out.length, 1, "one Trade Paired row → one paired trade");
    assert.equal(out[0]!.tradePnl, 1.5);
    assert.equal(out[0]!.fees, -1.9, "all preceding fee rows attributed to the close");
    assert.equal(out[0]!.netPnl, -0.4);
    assert.equal(out[0]!.feesAvailable, true);
  });

  it("attributes each trade's own preceding fees in ledger order", () => {
    const rows: CashHistoryRow[] = [
      row({ delta: -0.95, changeType: "Commission" }),
      row({ delta: 1.5, changeType: "Trade Paired" }), // trade 1: fees -0.95, net 0.55
      row({ delta: -0.5, changeType: "Commission" }),
      row({ delta: -0.5, changeType: "Commission" }),
      row({ delta: 4.0, changeType: "Trade Paired" }), // trade 2: fees -1.00, net 3.00
    ];
    const out = aggregateByPairedTrade(rows, "1868411");
    assert.equal(out.length, 2);
    assert.equal(out[0]!.netPnl, 0.55);
    assert.equal(out[1]!.netPnl, 3.0);
  });

  it("separates paired-trade buckets per contract", () => {
    const rows: CashHistoryRow[] = [
      row({ contract: "MNQM6", delta: -0.95, changeType: "Commission" }),
      row({ contract: "MESM6", delta: -1.0, changeType: "Commission" }),
      row({ contract: "MNQM6", delta: 1.5, changeType: "Trade Paired" }),
      row({ contract: "MESM6", delta: 4.0, changeType: "Trade Paired" }),
    ];
    const out = aggregateByPairedTrade(rows, "1868411");
    const mnq = out.find((t) => t.contract === "MNQM6")!;
    const mes = out.find((t) => t.contract === "MESM6")!;
    assert.equal(mnq.netPnl, 0.55, "MNQM6 fees do not bleed into MESM6 trade");
    assert.equal(mes.netPnl, 3.0);
  });

  it("paired-trade nets sum to the day net (reconciliation)", () => {
    const out = aggregateByPairedTrade(PDF_1868411_20260602, "1868411");
    const sum = out.reduce((s, t) => s + t.netPnl, 0);
    const dayNet = cashHistoryDayNet(PDF_1868411_20260602, "1868411")["2026-06-02"];
    assert.ok(Math.abs(sum - dayNet) < 1e-9, "per-trade nets reconcile to the day total");
  });
});

describe("normalizeCashBalanceLogRows — LIVE API shape", () => {
  // The live cashBalanceLog/list rows (account 1868411 / 2026-06-02) carry the
  // signed per-row value in `delta`. `amount` is the running balance and
  // `realizedPnL` is cumulative — BOTH must be ignored. cashChangeType is the
  // UNSPACED form ("TradePaired", "Commission", "ExchangeFee", …).
  it("uses delta, NOT amount or realizedPnL, for a TradePaired row", () => {
    const raw: RawCashBalanceLogRow[] = [
      {
        accountId: 1734393,
        timestamp: "2026-06-02T12:43:58.216Z",
        tradeDate: { year: 2026, month: 6, day: 2 },
        cashChangeType: "TradePaired",
        fillPairId: 15348818485,
        delta: 1.5,
        amount: 972.9,      // running balance — must NOT be used
        realizedPnL: -0.4,  // cumulative — must NOT be used
      },
    ];
    const out = normalizeCashBalanceLogRows(raw, 1734393, "1868411");
    assert.equal(out.length, 1);
    assert.equal(out[0]!.delta, 1.5, "row value is delta (1.5), not amount (972.9) or realizedPnL (-0.4)");
    assert.equal(out[0]!.changeType, "TradePaired");
    assert.equal(out[0]!.date, "2026-06-02");
  });

  it("a Commission row with delta=-0.39 normalizes to a -0.39 fee delta (ignores amount/realizedPnL)", () => {
    const raw: RawCashBalanceLogRow[] = [
      {
        accountId: 1734393,
        timestamp: "2026-06-02T12:43:58.216Z",
        tradeDate: { year: 2026, month: 6, day: 2 },
        cashChangeType: "Commission",
        fillId: 15348818480,
        delta: -0.39,
        amount: 971.4,
        realizedPnL: -1.9,
      },
    ];
    const out = normalizeCashBalanceLogRows(raw, 1734393, "1868411");
    assert.equal(out[0]!.delta, -0.39);
    assert.equal(classifyCashRow(out[0]!.changeType), "fee");
  });

  it("amount is never used as the P&L/fee value (would yield ~972, not 1.5)", () => {
    const raw: RawCashBalanceLogRow[] = [
      { accountId: 1734393, cashChangeType: "TradePaired", delta: 1.5, amount: 972.9, realizedPnL: -0.4, tradeDate: { year: 2026, month: 6, day: 2 } },
    ];
    const agg = aggregateCashHistory(normalizeCashBalanceLogRows(raw, 1734393, "1868411"), "1868411")[0]!;
    assert.equal(agg.tradePnl, 1.5, "must be the delta, not the 972.9 running balance");
    assert.notEqual(agg.tradePnl, 972.9);
    assert.notEqual(agg.tradePnl, -0.4);
  });

  it("drops rows for other broker accounts (isolation at ingestion)", () => {
    const raw: RawCashBalanceLogRow[] = [
      { accountId: 1734393, delta: -1.9, cashChangeType: "Commission", tradeDate: { year: 2026, month: 6, day: 2 } },
      { accountId: 777, delta: -500, cashChangeType: "Commission", tradeDate: { year: 2026, month: 6, day: 2 } },
    ];
    const out = normalizeCashBalanceLogRows(raw, 1734393, "1868411");
    assert.equal(out.length, 1);
    assert.equal(out[0]!.delta, -1.9);
  });

  it("skips rows missing a usable delta, date, or change type — never throws", () => {
    const raw: RawCashBalanceLogRow[] = [
      { accountId: 1734393, cashChangeType: "Commission" }, // no delta, no date
      { accountId: 1734393, delta: -1, tradeDate: { year: 2026, month: 6, day: 2 } }, // no changeType
      { accountId: 1734393, amount: -1, cashChangeType: "Commission", tradeDate: { year: 2026, month: 6, day: 2 } }, // delta missing → skipped
      { accountId: 1734393, delta: -1, cashChangeType: "Commission", tradeDate: { year: 2026, month: 6, day: 2 } }, // ok
    ];
    const out = normalizeCashBalanceLogRows(raw, 1734393, "1868411");
    assert.equal(out.length, 1, "only the row with a usable delta + date + changeType survives");
  });

  it("end-to-end live shape: the 11 rows for 1868411/2026-06-02 → +1.50 / -1.90 / -0.40", () => {
    const td = { year: 2026, month: 6, day: 2 };
    const raw: RawCashBalanceLogRow[] = [
      // first fill side (15:43:40) — unspaced API names, signed deltas
      { accountId: 1734393, cashChangeType: "ExchangeFee", delta: -0.35, amount: 972.95, realizedPnL: 0, tradeDate: td },
      { accountId: 1734393, cashChangeType: "ClearingFee", delta: -0.19, amount: 972.76, realizedPnL: 0, tradeDate: td },
      { accountId: 1734393, cashChangeType: "NfaFee", delta: -0.02, amount: 972.74, realizedPnL: 0, tradeDate: td },
      { accountId: 1734393, cashChangeType: "Commission", delta: -0.39, amount: 972.35, realizedPnL: 0, tradeDate: td },
      // second fill side (15:43:58)
      { accountId: 1734393, cashChangeType: "ExchangeFee", delta: -0.35, amount: 972.0, realizedPnL: 0, tradeDate: td },
      { accountId: 1734393, cashChangeType: "ClearingFee", delta: -0.19, amount: 971.81, realizedPnL: 0, tradeDate: td },
      { accountId: 1734393, cashChangeType: "NfaFee", delta: -0.02, amount: 971.79, realizedPnL: 0, tradeDate: td },
      { accountId: 1734393, cashChangeType: "Commission", delta: -0.39, amount: 971.4, realizedPnL: -1.9, tradeDate: td },
      // paired P&L
      { accountId: 1734393, cashChangeType: "TradePaired", delta: 1.5, amount: 972.9, realizedPnL: -0.4, tradeDate: td },
    ];
    const norm = normalizeCashBalanceLogRows(raw, 1734393, "1868411");
    assert.equal(norm.length, 9, "all 9 fee/pnl rows normalized (running balances are 11 total incl. non-trade)");
    const agg = aggregateCashHistory(norm, "1868411")[0]!;
    assert.equal(agg.tradePnl, 1.5);
    assert.equal(agg.fees, -1.9);
    assert.equal(agg.netPnl, -0.4);
    assert.equal(agg.feesAvailable, true);

    const dayNet = cashHistoryDayNet(norm, "1868411");
    assert.ok(Math.abs(dayNet["2026-06-02"] - -0.4) < 1e-9, "day-net map = { '2026-06-02': -0.4 }");
  });
});

describe("classifyCashRow — spaced and unspaced API/PDF variants", () => {
  it("recognizes UNSPACED live API names", () => {
    assert.equal(classifyCashRow("TradePaired"), "pnl");
    assert.equal(classifyCashRow("ExchangeFee"), "fee");
    assert.equal(classifyCashRow("ClearingFee"), "fee");
    assert.equal(classifyCashRow("NfaFee"), "fee");
    assert.equal(classifyCashRow("Commission"), "fee");
  });
  it("recognizes SPACED PDF names", () => {
    assert.equal(classifyCashRow("Trade Paired"), "pnl");
    assert.equal(classifyCashRow("Exchange Fee"), "fee");
    assert.equal(classifyCashRow("Clearing Fee"), "fee");
    assert.equal(classifyCashRow("Nfa Fee"), "fee");
  });
});

describe("cashHistoryDayNet — calendar/dashboard day net", () => {
  it("produces -0.40 for 2026-06-02 when fees are present", () => {
    const net = cashHistoryDayNet(PDF_1868411_20260602, "1868411");
    assert.ok(Math.abs(net["2026-06-02"] - -0.4) < 1e-9);
  });

  it("omits days that have no fee data (never labels them Net)", () => {
    const rows: CashHistoryRow[] = [
      row({ date: "2026-06-02", delta: 1.5, changeType: "Trade Paired" }),
      row({ date: "2026-06-02", delta: -1.9, changeType: "Commission" }),
      // A day with a paired P&L but no fee rows at all → must be omitted.
      row({ date: "2026-06-01", delta: 2.0, changeType: "Trade Paired" }),
    ];
    const net = cashHistoryDayNet(rows, "1868411");
    assert.ok("2026-06-02" in net, "day with fees is included");
    assert.ok(!("2026-06-01" in net), "fees-missing day is omitted so UI shows 'before fees'");
  });

  it("sums multiple contracts on the same day", () => {
    const rows: CashHistoryRow[] = [
      row({ date: "2026-06-02", contract: "MNQM6", delta: 1.5, changeType: "Trade Paired" }),
      row({ date: "2026-06-02", contract: "MNQM6", delta: -1.9, changeType: "Commission" }),
      row({ date: "2026-06-02", contract: "MESM6", delta: 4.0, changeType: "Trade Paired" }),
      row({ date: "2026-06-02", contract: "MESM6", delta: -1.0, changeType: "Commission" }),
    ];
    const net = cashHistoryDayNet(rows, "1868411");
    // (1.50 - 1.90) + (4.00 - 1.00) = -0.40 + 3.00 = 2.60
    assert.ok(Math.abs(net["2026-06-02"] - 2.6) < 1e-9);
  });

  it("isolates by account", () => {
    const rows: CashHistoryRow[] = [
      ...PDF_1868411_20260602,
      row({ accountId: "9999999", date: "2026-06-02", delta: 999, changeType: "Trade Paired" }),
      row({ accountId: "9999999", date: "2026-06-02", delta: -1, changeType: "Commission" }),
    ];
    const net = cashHistoryDayNet(rows, "1868411");
    assert.ok(Math.abs(net["2026-06-02"] - -0.4) < 1e-9, "other account's 999 must not leak");
  });
});
