/**
 * Tests for buildConversionRows — pure helper that powers the
 * MaxPositionSizeConversionTable component.
 *
 * Apex model: 10 micro = 1 standard. For max=2 the table must show:
 *   NQ ≤ 2  · MNQ ≤ 20
 *   ES ≤ 2  · MES ≤ 20
 *   YM ≤ 2  · MYM ≤ 20
 *   RTY ≤ 2 · M2K ≤ 20
 *
 * Run: npm run test:unit
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildConversionRows } from "./position-size-conversion.ts";

describe("buildConversionRows: max=2 (the primary test case)", () => {
  const rows = buildConversionRows(2);

  it("returns one row per supported standard/micro pair (4 pairs)", () => {
    assert.equal(rows.length, 4, "expected 4 rows for NQ/MNQ, ES/MES, YM/MYM, RTY/M2K");
  });

  it("rows appear in canonical order: NQ, ES, YM, RTY", () => {
    assert.deepEqual(
      rows.map((r) => r.parentRoot),
      ["NQ", "ES", "YM", "RTY"],
    );
  });

  it("NQ row: parent=2, micro=MNQ, microLimit=20", () => {
    const nq = rows.find((r) => r.parentRoot === "NQ");
    assert.ok(nq, "NQ row must exist");
    assert.equal(nq.parentLimit, 2);
    assert.equal(nq.microRoot, "MNQ");
    assert.equal(nq.microLimit, 20);
  });

  it("ES row: parent=2, micro=MES, microLimit=20", () => {
    const es = rows.find((r) => r.parentRoot === "ES");
    assert.ok(es);
    assert.equal(es.parentLimit, 2);
    assert.equal(es.microRoot, "MES");
    assert.equal(es.microLimit, 20);
  });

  it("YM row: parent=2, micro=MYM, microLimit=20", () => {
    const ym = rows.find((r) => r.parentRoot === "YM");
    assert.ok(ym);
    assert.equal(ym.parentLimit, 2);
    assert.equal(ym.microRoot, "MYM");
    assert.equal(ym.microLimit, 20);
  });

  it("RTY row: parent=2, micro=M2K, microLimit=20", () => {
    const rty = rows.find((r) => r.parentRoot === "RTY");
    assert.ok(rty);
    assert.equal(rty.parentLimit, 2);
    assert.equal(rty.microRoot, "M2K");
    assert.equal(rty.microLimit, 20);
  });
});

describe("buildConversionRows: max=1", () => {
  const rows = buildConversionRows(1);
  it("each parent=1 and each micro=10 (10 micro = 1 standard)", () => {
    for (const row of rows) {
      assert.equal(row.parentLimit, 1, `${row.parentRoot} must allow 1 standard`);
      assert.equal(row.microLimit, 10, `${row.microRoot} must allow 10 micros`);
    }
  });
});

describe("buildConversionRows: max=5", () => {
  const rows = buildConversionRows(5);
  it("each parent=5 and each micro=50", () => {
    for (const row of rows) {
      assert.equal(row.parentLimit, 5);
      assert.equal(row.microLimit, 50);
    }
  });
});

describe("buildConversionRows: edge cases", () => {
  it("returns [] for 0", () => {
    assert.deepEqual(buildConversionRows(0), []);
  });

  it("returns [] for negative values", () => {
    assert.deepEqual(buildConversionRows(-1), []);
    assert.deepEqual(buildConversionRows(-100), []);
  });

  it("returns [] for NaN", () => {
    assert.deepEqual(buildConversionRows(NaN), []);
  });

  it("returns [] for Infinity", () => {
    assert.deepEqual(buildConversionRows(Infinity), []);
    assert.deepEqual(buildConversionRows(-Infinity), []);
  });
});

describe("buildConversionRows: row shape", () => {
  it("each row has parentRoot, parentLimit, microRoot, microLimit", () => {
    const rows = buildConversionRows(3);
    for (const row of rows) {
      assert.equal(typeof row.parentRoot, "string");
      assert.equal(typeof row.parentLimit, "number");
      assert.equal(typeof row.microRoot, "string");
      assert.equal(typeof row.microLimit, "number");
    }
  });

  it("microLimit is always ten times parentLimit (Apex 10-micro = 1-standard model)", () => {
    for (const max of [1, 2, 3, 5, 10]) {
      for (const row of buildConversionRows(max)) {
        assert.equal(
          row.microLimit,
          row.parentLimit * 10,
          `${row.parentRoot}/${row.microRoot}: micro must be 10× parent for max=${max}`,
        );
      }
    }
  });
});

// ── Source-scan: conversion table component honors detection-response framing ──

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("max-position-size-conversion-table component: detection-response framing", () => {
  const COMPONENT_SRC = readFileSync(
    resolve(import.meta.dirname, "./max-position-size-conversion-table.tsx"),
    "utf8",
  );

  it("label mentions detection-response (not pre-trade reject)", () => {
    assert.ok(
      COMPONENT_SRC.includes("detection-response"),
      "table heading must say detection-response to set correct expectations",
    );
  });

  it("does not imply immediate broker reject", () => {
    const FORBIDDEN = ["broker-enforced", "pre-trade reject", "immediately reject", "blocks before"];
    for (const phrase of FORBIDDEN) {
      assert.ok(
        !COMPONENT_SRC.toLowerCase().includes(phrase.toLowerCase()),
        `component must not contain "${phrase}" — Guardrail enforces after detection`,
      );
    }
  });
});
