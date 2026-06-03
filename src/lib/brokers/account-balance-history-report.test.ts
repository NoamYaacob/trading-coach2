import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseAccountBalanceHistoryReport,
  buildRealizedPnlDayMap,
  normalizeTradeDate,
  type AccountBalanceHistoryDay,
} from "./account-balance-history-report.ts";

// Representative Default.html-style table. The real report body should be
// validated against a live Railway capture (see diagnose-tradovate-cash-history-source),
// but the parser is intentionally tolerant of column order and spacing.
const HTML_FIXTURE = `<!DOCTYPE html><html><body>
  <h2>Account Balance History</h2>
  <table>
    <thead>
      <tr>
        <th>Account ID</th>
        <th>Account Name</th>
        <th>Trade Date</th>
        <th>Total Amount, $</th>
        <th>Total Realized PNL, $</th>
      </tr>
    </thead>
    <tbody>
      <tr><td>1734393</td><td>1868411</td><td>04/30/2026</td><td>973.30</td><td>-200.50</td></tr>
      <tr><td>1734393</td><td>1868411</td><td>05/04/2026</td><td>1,050.00</td><td>76.70</td></tr>
      <tr><td>1734393</td><td>1868411</td><td>05/30/2026</td><td>973.30</td><td>0.00</td></tr>
      <tr><td>1734393</td><td>1868411</td><td>06/02/2026</td><td>972.90</td><td>-0.40</td></tr>
    </tbody>
  </table>
</body></html>`;

describe("parseAccountBalanceHistoryReport — HTML", () => {
  it("parses all data rows from the table", () => {
    const days = parseAccountBalanceHistoryReport({ body: HTML_FIXTURE, contentType: "text/html" });
    assert.equal(days.length, 4);
  });

  it("maps columns by header regardless of layout", () => {
    const days = parseAccountBalanceHistoryReport({ body: HTML_FIXTURE, contentType: "text/html" });
    const first = days[0]!;
    assert.equal(first.accountId, "1734393");
    assert.equal(first.accountName, "1868411");
    assert.equal(first.tradeDate, "2026-04-30");
    assert.equal(first.totalAmount, 973.30);
    assert.equal(first.realizedPnl, -200.50);
  });

  it("parses negative realized P&L correctly", () => {
    const days = parseAccountBalanceHistoryReport({ body: HTML_FIXTURE, contentType: "text/html" });
    const apr30 = days.find((d) => d.tradeDate === "2026-04-30")!;
    assert.equal(apr30.realizedPnl, -200.50);
    const jun2 = days.find((d) => d.tradeDate === "2026-06-02")!;
    assert.equal(jun2.realizedPnl, -0.40);
  });

  it("parses thousands-comma amounts", () => {
    const days = parseAccountBalanceHistoryReport({ body: HTML_FIXTURE, contentType: "text/html" });
    const may4 = days.find((d) => d.tradeDate === "2026-05-04")!;
    assert.equal(may4.totalAmount, 1050.00);
  });

  it("returns earliest date earlier than Jun 2 (wider than cashBalanceLog/deps)", () => {
    const days = parseAccountBalanceHistoryReport({ body: HTML_FIXTURE, contentType: "text/html" });
    const dates = days.map((d) => d.tradeDate).sort();
    assert.equal(dates[0], "2026-04-30");
    assert.ok(dates[0]! < "2026-06-02", "report exposes history before Jun 2");
  });

  it("returns [] for non-table HTML", () => {
    const days = parseAccountBalanceHistoryReport({ body: "<html><body>No data</body></html>", contentType: "text/html" });
    assert.deepEqual(days, []);
  });

  it("ignores rows missing a date or realized P&L", () => {
    const html = `<table>
      <tr><th>Trade Date</th><th>Total Realized PNL, $</th></tr>
      <tr><td></td><td>10.00</td></tr>
      <tr><td>06/02/2026</td><td></td></tr>
      <tr><td>06/03/2026</td><td>5.00</td></tr>
    </table>`;
    const days = parseAccountBalanceHistoryReport({ body: html, contentType: "text/html" });
    assert.equal(days.length, 1);
    assert.equal(days[0]!.tradeDate, "2026-06-03");
  });
});

describe("parseAccountBalanceHistoryReport — JSON", () => {
  it("parses a JSON array of row objects", () => {
    const json = JSON.stringify([
      { "Account ID": "1734393", "Account Name": "1868411", "Trade Date": "2026-04-30", "Total Amount, $": "973.30", "Total Realized PNL, $": "-200.50" },
      { "Account ID": "1734393", "Account Name": "1868411", "Trade Date": "2026-06-02", "Total Amount, $": "972.90", "Total Realized PNL, $": "-0.40" },
    ]);
    const days = parseAccountBalanceHistoryReport({ body: json, contentType: "application/json" });
    assert.equal(days.length, 2);
    assert.equal(days[0]!.tradeDate, "2026-04-30");
    assert.equal(days[0]!.realizedPnl, -200.50);
  });

  it("parses a { data: [...] } wrapper", () => {
    const json = JSON.stringify({
      data: [{ "Trade Date": "2026-05-04", "Total Realized PNL, $": 76.70, "Total Amount, $": 1050 }],
    });
    const days = parseAccountBalanceHistoryReport({ body: json, contentType: "application/json" });
    assert.equal(days.length, 1);
    assert.equal(days[0]!.realizedPnl, 76.70);
  });
});

describe("buildRealizedPnlDayMap", () => {
  const days: AccountBalanceHistoryDay[] = [
    { tradeDate: "2026-04-30", accountId: "1734393", accountName: "1868411", totalAmount: 973.3, realizedPnl: -200.5 },
    { tradeDate: "2026-05-04", accountId: "1734393", accountName: "1868411", totalAmount: 1050, realizedPnl: 76.7 },
    { tradeDate: "2026-05-30", accountId: "1734393", accountName: "1868411", totalAmount: 973.3, realizedPnl: 0 },
    { tradeDate: "2026-06-02", accountId: "1734393", accountName: "1868411", totalAmount: 972.9, realizedPnl: -0.4 },
  ];

  it("produces a YYYY-MM-DD → realizedPnl map", () => {
    const map = buildRealizedPnlDayMap(days);
    assert.deepEqual(map, {
      "2026-04-30": -200.5,
      "2026-05-04": 76.7,
      "2026-05-30": 0,
      "2026-06-02": -0.4,
    });
  });

  it("sums duplicate dates", () => {
    const dup = [...days, { tradeDate: "2026-06-02", accountId: "x", accountName: "y", totalAmount: 0, realizedPnl: -1.6 }];
    const map = buildRealizedPnlDayMap(dup);
    assert.equal(map["2026-06-02"], -2.0);
  });

  it("drops zero-P&L days when dropZero is set", () => {
    const map = buildRealizedPnlDayMap(days, { dropZero: true });
    assert.ok(!("2026-05-30" in map), "zero day omitted");
    assert.ok("2026-04-30" in map);
  });
});

describe("normalizeTradeDate", () => {
  it("converts MM/DD/YYYY to YYYY-MM-DD", () => {
    assert.equal(normalizeTradeDate("04/30/2026"), "2026-04-30");
    assert.equal(normalizeTradeDate("6/2/2026"), "2026-06-02");
  });

  it("passes through YYYY-MM-DD and trims timestamps", () => {
    assert.equal(normalizeTradeDate("2026-06-02"), "2026-06-02");
    assert.equal(normalizeTradeDate("2026-06-02T17:00:00Z"), "2026-06-02");
  });

  it("returns empty string for unrecognized input", () => {
    assert.equal(normalizeTradeDate("not a date"), "");
    assert.equal(normalizeTradeDate(""), "");
  });
});
