/**
 * Tests for Tradovate contractId → contract name resolution and
 * standard-equivalent exposure computation from resolved positions.
 *
 * Pure-function tests — no network, no DB, no broker client required.
 *
 * Run: npm run test:unit
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { normalizeSymbolRoot, getContractMetadata } from "../futures/contracts.ts";
import {
  computeMiniEquivalentExposure,
  deriveMaxPositionSizeBreach,
} from "./position-exposure.ts";

// ── Contract name → symbol root resolution ────────────────────────────────────

describe("contract name → symbol root (normalizeSymbolRoot)", () => {
  it("NQM6 resolves to root NQ", () => {
    assert.equal(normalizeSymbolRoot("NQM6"), "NQ");
  });

  it("MNQM6 resolves to root MNQ", () => {
    assert.equal(normalizeSymbolRoot("MNQM6"), "MNQ");
  });

  it("ESH6 resolves to root ES", () => {
    assert.equal(normalizeSymbolRoot("ESH6"), "ES");
  });

  it("MESH6 resolves to root MES", () => {
    assert.equal(normalizeSymbolRoot("MESH6"), "MES");
  });

  it("NQM6 is in the Guardrail registry (getContractMetadata returns non-null)", () => {
    const meta = getContractMetadata("NQM6");
    assert.ok(meta !== null, "NQM6 must be found in the futures registry");
    assert.equal(meta.symbolRoot, "NQ");
    assert.equal(meta.parentRoot, "NQ");
    assert.equal(meta.exposureRatioToParent, 1);
  });

  it("MNQM6 is in the Guardrail registry with ratio 0.1", () => {
    const meta = getContractMetadata("MNQM6");
    assert.ok(meta !== null, "MNQM6 must be found in the futures registry");
    assert.equal(meta.symbolRoot, "MNQ");
    assert.equal(meta.parentRoot, "NQ");
    assert.equal(meta.exposureRatioToParent, 0.1);
  });
});

// ── Numeric contractId is NOT in the registry ─────────────────────────────────

describe("numeric contractId must not be passed directly to registry", () => {
  it("getContractMetadata('4214191') returns null (numeric ID is not a futures symbol)", () => {
    // This is the key bug: when resolveContracts fails, callers must not pass
    // the numeric contractId string to computeMiniEquivalentExposure — it
    // produces null here, which must result in an unsupportedPositions entry.
    const meta = getContractMetadata("4214191");
    assert.equal(
      meta,
      null,
      "numeric contractId string '4214191' must not match any known futures root",
    );
  });

  it("a realistic numeric ID does not accidentally match a known root prefix", () => {
    // Verify several different numeric IDs — none should be in the registry.
    for (const id of ["1234567", "9999999", "0000001"]) {
      assert.equal(
        getContractMetadata(id),
        null,
        `numeric string '${id}' must not be in the futures registry`,
      );
    }
  });
});

// ── Short positions use absolute exposure ─────────────────────────────────────

describe("short positions use absolute value for exposure", () => {
  it("netPos=-3 NQ contributes 3 standard-equivalent, not -3", () => {
    const r = computeMiniEquivalentExposure([{ symbol: "NQM6", netPos: -3 }]);
    assert.equal(r.totalMiniEquivalent, 3);
    assert.equal(r.unsupported.length, 0);
  });

  it("netPos=-20 MNQ contributes 2.0 standard-equivalent", () => {
    const r = computeMiniEquivalentExposure([{ symbol: "MNQM6", netPos: -20 }]);
    assert.equal(r.totalMiniEquivalent, 2);
  });

  it("netPos=-21 MNQ contributes 2.1 standard-equivalent", () => {
    const r = computeMiniEquivalentExposure([{ symbol: "MNQM6", netPos: -21 }]);
    assert.equal(r.totalMiniEquivalent, 2.1);
  });
});

// ── Breach detection: specific scenarios from product spec ────────────────────

describe("wouldBreach scenarios with short positions", () => {
  it("-3 NQ with max=2: wouldBreach=true (3 > 2)", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "NQM6", netPos: -3 }],
      maxContracts: 2,
    });
    assert.equal(d.shouldTrigger, true);
    assert.equal(d.totalMiniEquivalent, 3);
    assert.equal(d.reasonKind, "exposure");
  });

  it("-20 MNQ with max=2: wouldBreach=false (2.0 = 2.0, not strictly greater)", () => {
    // 20 × 0.1 = 2.0 exactly — equality is allowed (not a breach)
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "MNQM6", netPos: -20 }],
      maxContracts: 2,
    });
    assert.equal(d.shouldTrigger, false);
    assert.equal(d.totalMiniEquivalent, 2);
    assert.equal(d.reasonKind, null);
  });

  it("-21 MNQ with max=2: wouldBreach=true (2.1 > 2)", () => {
    // 21 × 0.1 = 2.1 in integer-millis: 2100 > 2000 → breach
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "MNQM6", netPos: -21 }],
      maxContracts: 2,
    });
    assert.equal(d.shouldTrigger, true);
    assert.equal(d.totalMiniEquivalent, 2.1);
    assert.equal(d.reasonKind, "exposure");
  });

  it("-1 NQ with max=2: wouldBreach=false", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "NQM6", netPos: -1 }],
      maxContracts: 2,
    });
    assert.equal(d.shouldTrigger, false);
    assert.equal(d.reasonKind, null);
  });

  it("-2 NQ with max=2: wouldBreach=false (equality is not a breach)", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "NQM6", netPos: -2 }],
      maxContracts: 2,
    });
    assert.equal(d.shouldTrigger, false);
    assert.equal(d.reasonKind, null);
  });
});

// ── resolveContracts cache / failure source-scan ──────────────────────────────

const CLIENT_SRC = readFileSync(
  resolve(import.meta.dirname, "./tradovate-client.ts"),
  "utf8",
);

describe("resolveContracts: per-ID fallback deduplification (source audit)", () => {
  it("fallback uses ids.filter to skip already-resolved IDs (cache-equivalent dedup)", () => {
    // The fallback loop skips IDs already in the map, preventing duplicate GET calls.
    assert.ok(
      CLIENT_SRC.includes("ids.filter((id) => !map.has(id))"),
      "resolveContracts fallback must filter out already-resolved IDs to avoid duplicate calls",
    );
  });

  it("getContractById uses contract/item?id= (single-item GET endpoint)", () => {
    assert.match(
      CLIENT_SRC,
      /contract\/item\?id=\$\{id\}/,
      "getContractById must call contract/item?id= with the given id",
    );
  });

  it("resolveContracts contains both contract/items batch and per-ID fallback paths", () => {
    // Verify both resolution strategies exist.
    assert.ok(
      CLIENT_SRC.includes('"contract/items"'),
      "contract/items batch call must exist in resolveContracts",
    );
    assert.ok(
      CLIENT_SRC.includes("contract/item?id="),
      "contract/item?id= per-ID fallback must exist",
    );
  });
});

// ── Debug endpoint: contract resolution failure → unsupportedPositions ────────

const DEBUG_ROUTE_SRC = readFileSync(
  resolve(
    import.meta.dirname,
    "../../app/api/debug/tradovate-position-limit/route.ts",
  ),
  "utf8",
);

describe("debug endpoint: unresolved contractId produces unsupportedPositions (source audit)", () => {
  it("debug route checks contractMap.get for null and pushes to unsupportedPositions", () => {
    // When resolveContracts cannot resolve a contractId, the debug endpoint
    // must add it to unsupportedPositions (not silently pass a numeric string
    // to the registry which would produce a false-positive unsupported entry).
    assert.ok(
      DEBUG_ROUTE_SRC.includes("unsupportedPositions.push"),
      "debug route must push unresolved positions to unsupportedPositions",
    );
    assert.ok(
      DEBUG_ROUTE_SRC.includes("contractName: null"),
      "debug route must record contractName: null for unresolved contractIds",
    );
  });

  it("debug route exposes contractId in livePositions (not just the symbol string)", () => {
    assert.ok(
      DEBUG_ROUTE_SRC.includes("contractId: p.contractId"),
      "livePositions must include the raw contractId for traceability",
    );
  });
});

// ── No token fields in logs ───────────────────────────────────────────────────

describe("tradovate-client.ts: no token fields logged in resolveContracts / getContractById", () => {
  // Isolate just the resolveContracts and getContractById method text.
  const resolveStart = CLIENT_SRC.indexOf("async resolveContracts(");
  const getContractStart = CLIENT_SRC.indexOf("async getContractById(");
  // Next method boundary (rough: look for next 'async ' at indentation level)
  const resolveEnd = CLIENT_SRC.indexOf("\n  async ", resolveStart + 1);
  const contractSection =
    getContractStart !== -1 && resolveStart !== -1
      ? CLIENT_SRC.slice(
          Math.min(getContractStart, resolveStart),
          resolveEnd !== -1 ? resolveEnd : undefined,
        )
      : CLIENT_SRC;

  const FORBIDDEN = [
    "accessToken",
    "refreshToken",
    "tokenEncrypted",
    "accessTokenEncrypted",
    "refreshTokenEncrypted",
  ];

  for (const field of FORBIDDEN) {
    it(`resolveContracts/getContractById section must not log '${field}'`, () => {
      assert.ok(
        !contractSection.includes(field),
        `contract resolution methods must not reference token field: ${field}`,
      );
    });
  }
});
