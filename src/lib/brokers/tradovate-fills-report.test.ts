/**
 * Unit tests for the pure Tradovate Fills-report parser.
 * No DB, no network — runs with `node --test`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseFillsReport,
  normalizeSide,
  parseFillTimestamp,
  type HistoricalFillRow,
} from "./tradovate-fills-report.ts";

// A representative slice of the "Fills" report body (representationType=html,
// Default.md template) for account 1868411 on 4/30/2026, matching the columns
// the diagnostic confirmed: Fill ID | Order ID | B/S | Quantity | Price |
// Contract | Timestamp | Account.
const SAMPLE_HTML = `
<h3><strong>MNQM6</strong></h3>
<h4>4/30/26: 4 fills</h4>
<table>
  <thead>
    <tr>
      <th>Fill ID</th><th>Order ID</th><th>B/S</th><th>Quantity</th>
      <th>Price</th><th>Contract</th><th>Timestamp</th><th>Account</th>
    </tr>
  </thead>
  <tbody>
    <tr><td>100001</td><td>900001</td><td>Buy</td><td>2</td><td>20000.25</td><td>MNQM6</td><td>4/30/2026 09:31:05</td><td>1868411</td></tr>
    <tr><td>100002</td><td>900002</td><td>Sell</td><td>2</td><td>19980.00</td><td>MNQM6</td><td>4/30/2026 09:45:12</td><td>1868411</td></tr>
    <tr><td>100003</td><td>900003</td><td>B</td><td>1</td><td>19975.50</td><td>MNQM6</td><td>4/30/2026 10:02:00</td><td>1868411</td></tr>
    <tr><td>100004</td><td>900004</td><td>S</td><td>1</td><td>19990.75</td><td>MNQM6</td><td>4/30/2026 10:20:33</td><td>1868411</td></tr>
  </tbody>
</table>
`;

describe("parseFillsReport — HTML body", () => {
  it("parses every fill row with all fields normalized", () => {
    const rows = parseFillsReport({ body: SAMPLE_HTML, contentType: "text/html" });
    assert.equal(rows.length, 4, "must parse all 4 fill rows");

    const first = rows[0]!;
    assert.equal(first.fillId, "100001");
    assert.equal(first.orderId, "900001");
    assert.equal(first.side, "BUY");
    assert.equal(first.quantity, 2);
    assert.equal(first.price, 20000.25);
    assert.equal(first.contract, "MNQM6");
    assert.equal(first.accountName, "1868411");
    assert.equal(first.timestamp, "2026-04-30T09:31:05.000Z");
  });

  it("normalizes B/S short forms to BUY/SELL", () => {
    const rows = parseFillsReport({ body: SAMPLE_HTML, contentType: "text/html" });
    assert.deepEqual(
      rows.map((r) => r.side),
      ["BUY", "SELL", "BUY", "SELL"],
    );
  });

  it("parses fills across multiple per-contract/date tables", () => {
    const multi = SAMPLE_HTML + `
      <h3><strong>NQM6</strong></h3>
      <h4>5/4/26: 2 fills</h4>
      <table>
        <tr><th>Fill ID</th><th>Order ID</th><th>B/S</th><th>Quantity</th><th>Price</th><th>Contract</th><th>Timestamp</th><th>Account</th></tr>
        <tr><td>200001</td><td>910001</td><td>Buy</td><td>1</td><td>20100.00</td><td>NQM6</td><td>5/4/2026 08:00:00</td><td>1868411</td></tr>
        <tr><td>200002</td><td>910002</td><td>Sell</td><td>1</td><td>20135.40</td><td>NQM6</td><td>5/4/2026 08:30:00</td><td>1868411</td></tr>
      </table>
    `;
    const rows = parseFillsReport({ body: multi, contentType: "text/html" });
    assert.equal(rows.length, 6, "must parse rows from both tables");
    assert.ok(rows.some((r) => r.contract === "NQM6" && r.fillId === "200001"));
  });

  it("skips rows that are not real fills (missing id / qty / price)", () => {
    const messy = `
      <table>
        <tr><th>Fill ID</th><th>Order ID</th><th>B/S</th><th>Quantity</th><th>Price</th><th>Contract</th><th>Timestamp</th><th>Account</th></tr>
        <tr><td>300001</td><td>920001</td><td>Buy</td><td>1</td><td>20000.00</td><td>MNQM6</td><td>4/30/2026 09:00:00</td><td>1868411</td></tr>
        <tr><td></td><td></td><td></td><td></td><td></td><td></td><td>Totals</td><td></td></tr>
        <tr><td>300002</td><td>920002</td><td>Sell</td><td>0</td><td>20010.00</td><td>MNQM6</td><td>4/30/2026 09:05:00</td><td>1868411</td></tr>
      </table>
    `;
    const rows = parseFillsReport({ body: messy, contentType: "text/html" });
    assert.equal(rows.length, 1, "only the one valid fill row is kept");
    assert.equal(rows[0]!.fillId, "300001");
  });

  it("returns [] for an empty or non-fills body (never throws)", () => {
    assert.deepEqual(parseFillsReport({ body: "", contentType: "text/html" }), []);
    assert.deepEqual(
      parseFillsReport({ body: "<html><body><p>No data</p></body></html>", contentType: "text/html" }),
      [],
    );
  });
});

describe("parseFillsReport — JSON body", () => {
  it("parses a JSON array of fill objects", () => {
    const json = JSON.stringify([
      {
        "Fill ID": "400001",
        "Order ID": "930001",
        "B/S": "Buy",
        Quantity: 3,
        Price: 20000.5,
        Contract: "MNQM6",
        Timestamp: "2026-04-30 09:31:05",
        Account: "1868411",
      },
    ]);
    const rows = parseFillsReport({ body: json, contentType: "application/json" });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.fillId, "400001");
    assert.equal(rows[0]!.side, "BUY");
    assert.equal(rows[0]!.quantity, 3);
    assert.equal(rows[0]!.timestamp, "2026-04-30T09:31:05.000Z");
  });
});

describe("normalizeSide", () => {
  it("maps buy aliases to BUY", () => {
    for (const s of ["B", "b", "Buy", "BUY", "bought", "Long"]) {
      assert.equal(normalizeSide(s), "BUY", `"${s}" → BUY`);
    }
  });
  it("maps sell aliases to SELL", () => {
    for (const s of ["S", "s", "Sell", "SELL", "sold", "Short", "Sld"]) {
      assert.equal(normalizeSide(s), "SELL", `"${s}" → SELL`);
    }
  });
  it("returns null for unrecognized side text", () => {
    assert.equal(normalizeSide(""), null);
    assert.equal(normalizeSide("xyz"), null);
  });
});

describe("parseFillTimestamp", () => {
  it("parses MM/DD/YYYY HH:mm:ss as UTC", () => {
    assert.equal(parseFillTimestamp("4/30/2026 09:31:05"), "2026-04-30T09:31:05.000Z");
  });
  it("expands 2-digit years to 20YY", () => {
    assert.equal(parseFillTimestamp("4/30/26 09:31:05"), "2026-04-30T09:31:05.000Z");
  });
  it("parses ISO-style date-time", () => {
    assert.equal(parseFillTimestamp("2026-05-04 08:00:00"), "2026-05-04T08:00:00.000Z");
  });
  it("parses date-only (midnight UTC)", () => {
    assert.equal(parseFillTimestamp("6/2/2026"), "2026-06-02T00:00:00.000Z");
  });
  it("returns null for garbage", () => {
    assert.equal(parseFillTimestamp(""), null);
    assert.equal(parseFillTimestamp("not a date"), null);
  });
});

// Type-level guard: HistoricalFillRow shape used by downstream loaders.
describe("HistoricalFillRow contract", () => {
  it("exposes the fields the loader needs", () => {
    const rows = parseFillsReport({ body: SAMPLE_HTML, contentType: "text/html" });
    const r: HistoricalFillRow = rows[0]!;
    const keys = Object.keys(r).sort();
    assert.deepEqual(keys, [
      "accountName",
      "contract",
      "fillId",
      "orderId",
      "price",
      "quantity",
      "side",
      "timestamp",
    ]);
  });
});
