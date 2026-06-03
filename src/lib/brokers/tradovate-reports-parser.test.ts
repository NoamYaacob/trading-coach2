import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parsePerformanceReportTradeCount,
  parsePerformanceReportPnl,
  parseMoney,
} from "./tradovate-reports-parser.ts";

// ── HTML ──────────────────────────────────────────────────────────────────────

describe("parsePerformanceReportTradeCount — HTML", () => {
  it("extracts # of Trades from a simple <td> table", () => {
    const html = `<table>
      <tr><th>Statistic</th><th>Value</th></tr>
      <tr><td># of Trades</td><td>11</td></tr>
      <tr><td>Total P/L</td><td>-1022.50</td></tr>
    </table>`;
    assert.equal(
      parsePerformanceReportTradeCount({ body: html, contentType: "text/html" }),
      11,
    );
  });

  it("handles &nbsp; in label text", () => {
    const html = `<div>#&nbsp;of&nbsp;Trades</div><div>6</div>`;
    assert.equal(
      parsePerformanceReportTradeCount({ body: html, contentType: "text/html" }),
      6,
    );
  });

  it("handles label and value in nested elements", () => {
    const html = `
      <div class="report">
        <div class="row">
          <span class="label"># of Trades</span>
          <span class="value">  11  </span>
        </div>
      </div>`;
    assert.equal(
      parsePerformanceReportTradeCount({ body: html, contentType: "text/html" }),
      11,
    );
  });

  it("handles 'Total Trades' label variant", () => {
    const html = `<p>Total Trades: 7</p>`;
    assert.equal(
      parsePerformanceReportTradeCount({ body: html, contentType: "text/html" }),
      7,
    );
  });

  it("returns null when no recognizable label is present", () => {
    const html = `<p>Net P/L: -500</p>`;
    assert.equal(
      parsePerformanceReportTradeCount({ body: html, contentType: "text/html" }),
      null,
    );
  });

  it("ignores inline script/style content", () => {
    const html = `
      <style>.trades { color: red; } /* # of Trades = 999 */</style>
      <script>const tradeCount = 999;</script>
      <table><tr><td># of Trades</td><td>4</td></tr></table>`;
    assert.equal(
      parsePerformanceReportTradeCount({ body: html, contentType: "text/html" }),
      4,
    );
  });

  it("works without an explicit content type (sniffs format)", () => {
    const html = `<table><tr><td># of Trades</td><td>9</td></tr></table>`;
    assert.equal(
      parsePerformanceReportTradeCount({ body: html, contentType: null }),
      9,
    );
  });
});

// ── CSV ───────────────────────────────────────────────────────────────────────

describe("parsePerformanceReportTradeCount — CSV", () => {
  it("extracts from label/value pair rows", () => {
    const csv = `Statistic,Value\n"# of Trades",11\nTotal P/L,-1022.50`;
    assert.equal(
      parsePerformanceReportTradeCount({ body: csv, contentType: "text/csv" }),
      11,
    );
  });

  it("extracts from a header column with one data row", () => {
    const csv = `Account,# of Trades,Net P/L\nMFFUEVBLDR133936248,6,-1025.00`;
    assert.equal(
      parsePerformanceReportTradeCount({ body: csv, contentType: "text/csv" }),
      6,
    );
  });

  it("handles quoted values with commas inside", () => {
    const csv = `"Statistic","Value"\n"# of Trades","11"\n"Total P/L","-1,022.50"`;
    assert.equal(
      parsePerformanceReportTradeCount({ body: csv, contentType: "text/csv" }),
      11,
    );
  });

  it("returns null when CSV has no recognizable label", () => {
    const csv = `Account,Net P/L\nMFFUEVBLDR133936248,-1025.00`;
    assert.equal(
      parsePerformanceReportTradeCount({ body: csv, contentType: "text/csv" }),
      null,
    );
  });
});

// ── JSON ──────────────────────────────────────────────────────────────────────

describe("parsePerformanceReportTradeCount — JSON", () => {
  it("extracts from a top-level key", () => {
    const json = JSON.stringify({ "# of Trades": 6, "Total P/L": -1025 });
    assert.equal(
      parsePerformanceReportTradeCount({ body: json, contentType: "application/json" }),
      6,
    );
  });

  it("extracts from nested object", () => {
    const json = JSON.stringify({
      report: { stats: { "# of Trades": 11, "Total P/L": -1022.5 } },
    });
    assert.equal(
      parsePerformanceReportTradeCount({ body: json, contentType: "application/json" }),
      11,
    );
  });

  it("extracts from {name, value} row pattern", () => {
    const json = JSON.stringify({
      rows: [
        { name: "# of Trades", value: 7 },
        { name: "Net P/L", value: -250 },
      ],
    });
    assert.equal(
      parsePerformanceReportTradeCount({ body: json, contentType: "application/json" }),
      7,
    );
  });

  it("handles {label, value} variant", () => {
    const json = JSON.stringify([{ label: "Total Trades", value: "9" }]);
    assert.equal(
      parsePerformanceReportTradeCount({ body: json, contentType: "application/json" }),
      9,
    );
  });

  it("returns null for malformed JSON", () => {
    assert.equal(
      parsePerformanceReportTradeCount({ body: "not json", contentType: "application/json" }),
      null,
    );
  });

  it("falls through to HTML/text scan when JSON parse fails", () => {
    // Body claims to be JSON but is actually HTML — parser should still find the value.
    const body = `<p># of Trades 4</p>`;
    assert.equal(
      parsePerformanceReportTradeCount({ body, contentType: "application/json" }),
      4,
    );
  });
});

// ── multi-account regression: expected fixture values ────────────────────────

describe("parsePerformanceReportTradeCount — Tradovate fixture values", () => {
  // The two MFF accounts in the production bug report:
  //   MFFUEVBLDR133936248 → Performance Report shows # of Trades = 6
  //   MFFUEVBLDR133936249 → Performance Report shows # of Trades = 11
  // These tests document that the parser would correctly extract those numbers
  // from a typical Tradovate Performance Report response.

  it("account 6248 fixture (HTML) → 6", () => {
    const html = `
      <html><body>
        <h1>Performance Report</h1>
        <table>
          <tr><th>Account</th><td>MFFUEVBLDR133936248</td></tr>
          <tr><th># of Trades</th><td>6</td></tr>
          <tr><th>Total P/L</th><td>-1025.00</td></tr>
        </table>
      </body></html>`;
    assert.equal(
      parsePerformanceReportTradeCount({ body: html, contentType: "text/html" }),
      6,
    );
  });

  it("account 6249 fixture (HTML) → 11", () => {
    const html = `
      <html><body>
        <h1>Performance Report</h1>
        <table>
          <tr><th>Account</th><td>MFFUEVBLDR133936249</td></tr>
          <tr><th># of Trades</th><td>11</td></tr>
          <tr><th>Total P/L</th><td>-1022.50</td></tr>
        </table>
      </body></html>`;
    assert.equal(
      parsePerformanceReportTradeCount({ body: html, contentType: "text/html" }),
      11,
    );
  });

  it("account 6248 fixture (CSV) → 6", () => {
    const csv = `Account,# of Trades,Total P/L\nMFFUEVBLDR133936248,6,-1025.00`;
    assert.equal(
      parsePerformanceReportTradeCount({ body: csv, contentType: "text/csv" }),
      6,
    );
  });
});

// ── parseMoney ──────────────────────────────────────────────────────────────

describe("parseMoney", () => {
  it("parses plain, signed, currency, comma, and accounting-negative forms", () => {
    assert.equal(parseMoney("1.50"), 1.5);
    assert.equal(parseMoney("+$1.50"), 1.5);
    assert.equal(parseMoney("-$0.40"), -0.4);
    assert.equal(parseMoney("(1.90)"), -1.9);
    assert.equal(parseMoney("$1,234.50"), 1234.5);
    assert.equal(parseMoney("  -1,022.50 "), -1022.5);
  });
  it("returns null for non-money strings", () => {
    assert.equal(parseMoney("n/a"), null);
    assert.equal(parseMoney(""), null);
    assert.equal(parseMoney(null), null);
    assert.equal(parseMoney(undefined), null);
  });
});

// ── parsePerformanceReportPnl — the 1868411 scenario ────────────────────────
// Account Report: Gross P/L +1.50, Fees -1.90, Net/Total P/L -0.40.
// fillFee/list returns 0 records, so this report is the only fee source.

describe("parsePerformanceReportPnl — HTML", () => {
  it("extracts gross +1.50, fees 1.90 (magnitude), net -0.40 from a report table", () => {
    const html = `<table>
      <tr><th>Statistic</th><th>Value</th></tr>
      <tr><td>Gross P/L</td><td>$1.50</td></tr>
      <tr><td>Total Fees</td><td>-$1.90</td></tr>
      <tr><td>Net P/L</td><td>-$0.40</td></tr>
    </table>`;
    const pnl = parsePerformanceReportPnl({ body: html, contentType: "text/html" });
    assert.equal(pnl.grossPnl, 1.5);
    assert.equal(pnl.fees, 1.9, "fees normalised to positive magnitude");
    assert.ok(Math.abs(pnl.netPnl! - -0.4) < 1e-9, "net is -0.40");
  });

  it("handles &nbsp; separators and 'Commission' label", () => {
    const html = `<div>Gross&nbsp;P/L</div><div>1.50</div>
      <div>Commission</div><div>(1.90)</div>
      <div>Total&nbsp;P/L</div><div>-0.40</div>`;
    const pnl = parsePerformanceReportPnl({ body: html, contentType: "text/html" });
    assert.equal(pnl.grossPnl, 1.5);
    assert.equal(pnl.fees, 1.9);
    assert.ok(Math.abs(pnl.netPnl! - -0.4) < 1e-9);
  });
});

describe("parsePerformanceReportPnl — CSV", () => {
  it("extracts gross/fees/net from label,value rows", () => {
    const csv = `Statistic,Value
Gross P/L,1.50
Total Fees,-1.90
Net P/L,-0.40`;
    const pnl = parsePerformanceReportPnl({ body: csv, contentType: "text/csv" });
    assert.equal(pnl.grossPnl, 1.5);
    assert.equal(pnl.fees, 1.9);
    assert.ok(Math.abs(pnl.netPnl! - -0.4) < 1e-9);
  });
});

describe("parsePerformanceReportPnl — JSON", () => {
  it("extracts from direct keys", () => {
    const json = JSON.stringify({ "Gross P/L": 1.5, "Total Fees": -1.9, "Net P/L": -0.4 });
    const pnl = parsePerformanceReportPnl({ body: json, contentType: "application/json" });
    assert.equal(pnl.grossPnl, 1.5);
    assert.equal(pnl.fees, 1.9);
    assert.ok(Math.abs(pnl.netPnl! - -0.4) < 1e-9);
  });

  it("extracts from {name,value} statistic rows", () => {
    const json = JSON.stringify({
      statistics: [
        { name: "Gross P/L", value: "1.50" },
        { name: "Commissions", value: "-1.90" },
        { name: "Net P/L", value: "-0.40" },
      ],
    });
    const pnl = parsePerformanceReportPnl({ body: json, contentType: "application/json" });
    assert.equal(pnl.grossPnl, 1.5);
    assert.equal(pnl.fees, 1.9);
    assert.ok(Math.abs(pnl.netPnl! - -0.4) < 1e-9);
  });
});

describe("parsePerformanceReportPnl — honesty (never fabricate)", () => {
  it("returns null fields when labels are absent — no derivation", () => {
    const html = `<table><tr><td># of Trades</td><td>1</td></tr></table>`;
    const pnl = parsePerformanceReportPnl({ body: html, contentType: "text/html" });
    assert.equal(pnl.grossPnl, null);
    assert.equal(pnl.fees, null);
    assert.equal(pnl.netPnl, null);
  });

  it("does not derive net from gross and fees when net is missing", () => {
    const html = `<div>Gross P/L</div><div>1.50</div><div>Total Fees</div><div>-1.90</div>`;
    const pnl = parsePerformanceReportPnl({ body: html, contentType: "text/html" });
    assert.equal(pnl.grossPnl, 1.5);
    assert.equal(pnl.fees, 1.9);
    assert.equal(pnl.netPnl, null, "net stays null — never computed from gross-fees");
  });

  it("returns all null for an empty body", () => {
    const pnl = parsePerformanceReportPnl({ body: "", contentType: null });
    assert.deepEqual(pnl, { grossPnl: null, fees: null, netPnl: null });
  });
});
