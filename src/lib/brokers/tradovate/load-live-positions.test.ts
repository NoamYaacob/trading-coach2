/**
 * Source-audit tests for the shared live-position loader and parity between
 * the sync and debug paths.
 *
 * Verifies:
 *   - loadLivePositions uses getRawPositions() (unfiltered) not getPositions()
 *   - Account filter uses numeric comparison (Number(externalAccountId))
 *   - TvPosition is exported from tradovate-client.ts
 *   - getRawPositions() is defined on TradovateClient
 *   - Both debug and sync import from the same shared helper
 *   - Sync diagnostics log includes position load info
 *   - contractId (not symbol) is used for openPositionContractIds
 *   - No token values appear in diagnostic output
 *
 * Pure source-scan — no network, no DB.
 *
 * Run: npm run test:unit
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HELPER_SRC = readFileSync(resolve(import.meta.dirname, "./load-live-positions.ts"), "utf8");
const CLIENT_SRC = readFileSync(resolve(import.meta.dirname, "../tradovate-client.ts"), "utf8");
const SYNC_SRC = readFileSync(resolve(import.meta.dirname, "../tradovate-sync.ts"), "utf8");
const DEBUG_SRC = readFileSync(
  resolve(import.meta.dirname, "../../../app/api/debug/tradovate-position-limit/route.ts"),
  "utf8",
);

// ── TradovateClient exports ────────────────────────────────────────────────────

describe("tradovate-client: TvPosition export and getRawPositions", () => {
  it("exports TvPosition type", () => {
    assert.ok(
      CLIENT_SRC.includes("export type TvPosition"),
      "TradovateClient must export TvPosition type",
    );
  });

  it("defines getRawPositions() method", () => {
    assert.ok(
      CLIENT_SRC.includes("getRawPositions()"),
      "TradovateClient must define getRawPositions()",
    );
  });

  it("getRawPositions() calls position/list without account filter", () => {
    const rawIdx = CLIENT_SRC.indexOf("getRawPositions()");
    assert.ok(rawIdx !== -1);
    const methodBody = CLIENT_SRC.slice(rawIdx, rawIdx + 200);
    assert.ok(
      methodBody.includes("position/list"),
      "getRawPositions must call position/list",
    );
    assert.ok(
      !methodBody.includes("#tvAccountId"),
      "getRawPositions must NOT filter by #tvAccountId",
    );
  });

  it("defines getExternalAccountId() getter", () => {
    assert.ok(
      CLIENT_SRC.includes("getExternalAccountId()"),
      "TradovateClient must expose getExternalAccountId()",
    );
  });
});

// ── Shared helper: load-live-positions.ts ─────────────────────────────────────

describe("load-live-positions: uses getRawPositions for unfiltered fetch", () => {
  it("calls getRawPositions() not getPositions()", () => {
    assert.ok(
      HELPER_SRC.includes("getRawPositions()"),
      "helper must call getRawPositions() for unfiltered data",
    );
    assert.ok(
      !HELPER_SRC.includes("getPositions()"),
      "helper must NOT call getPositions() (which applies internal account filter)",
    );
  });
});

describe("load-live-positions: account filter uses numeric Tradovate ID", () => {
  it("parses externalAccountId as integer for comparison", () => {
    assert.ok(
      HELPER_SRC.includes("parseInt(externalAccountId, 10)"),
      "helper must parse externalAccountId as integer",
    );
  });

  it("filters by p.accountId === tvAccountId (numeric equality)", () => {
    assert.ok(
      HELPER_SRC.includes("p.accountId === tvAccountId"),
      "helper must compare raw position accountId numerically to tvAccountId",
    );
  });

  it("does NOT compare raw position accountId to the Guardrail DB CUID string", () => {
    // The only valid comparison is numeric: p.accountId === tvAccountId
    // (tvAccountId is parsed from externalAccountId, which is the Tradovate numeric ID).
    // The Guardrail DB account primary key (a CUID like "cm...") must never be used here.
    assert.ok(
      !HELPER_SRC.includes("p.accountId === accountId"),
      "helper must not compare p.accountId to the Guardrail CUID accountId parameter",
    );
  });
});

describe("load-live-positions: uses contractId for flatten keys", () => {
  it("openPositionContractIds is built from p.contractId", () => {
    assert.ok(
      HELPER_SRC.includes("openPositionContractIds = nonZero.map((p) => p.contractId)"),
      "openPositionContractIds must use p.contractId (Tradovate numeric ID)",
    );
  });
});

describe("load-live-positions: diagnostics fields", () => {
  it("includes tradovateAccountIdUsedForPositionFetch", () => {
    assert.ok(
      HELPER_SRC.includes("tradovateAccountIdUsedForPositionFetch"),
      "diagnostics must include tradovateAccountIdUsedForPositionFetch",
    );
  });

  it("includes rawPositionCount", () => {
    assert.ok(HELPER_SRC.includes("rawPositionCount"), "diagnostics must include rawPositionCount");
  });

  it("includes filteredByAccountCount", () => {
    assert.ok(HELPER_SRC.includes("filteredByAccountCount"), "diagnostics must include filteredByAccountCount");
  });

  it("includes filteredPositionCount", () => {
    assert.ok(HELPER_SRC.includes("filteredPositionCount"), "diagnostics must include filteredPositionCount");
  });

  it("includes positionFetchSource set to position/list", () => {
    assert.ok(
      HELPER_SRC.includes('"position/list"'),
      'diagnostics positionFetchSource must be "position/list"',
    );
  });

  it("includes positionFilterReason", () => {
    assert.ok(HELPER_SRC.includes("positionFilterReason"), "diagnostics must include positionFilterReason");
  });

  it("does NOT log token values", () => {
    assert.ok(!HELPER_SRC.includes("accessToken"), "helper must not reference accessToken");
    assert.ok(!HELPER_SRC.includes("refreshToken"), "helper must not reference refreshToken");
    assert.ok(!HELPER_SRC.includes("tokenEncrypted"), "helper must not reference tokenEncrypted");
  });
});

// ── Sync path: uses shared helper ─────────────────────────────────────────────

describe("tradovate-sync: imports and uses shared loadLivePositions helper", () => {
  it("imports loadLivePositions from shared helper", () => {
    assert.ok(
      SYNC_SRC.includes("loadLivePositions"),
      "tradovate-sync.ts must import loadLivePositions",
    );
    assert.ok(
      SYNC_SRC.includes("tradovate/load-live-positions"),
      "tradovate-sync.ts must import from ./tradovate/load-live-positions",
    );
  });

  it("calls loadLivePositions with client and externalAccountId", () => {
    assert.ok(
      SYNC_SRC.includes("loadLivePositions(client, externalAccountId)"),
      "sync must call loadLivePositions(client, externalAccountId)",
    );
  });

  it("fetches externalAccountId from client.getExternalAccountId()", () => {
    assert.ok(
      SYNC_SRC.includes("client.getExternalAccountId()"),
      "sync must call client.getExternalAccountId() to get externalAccountId",
    );
  });

  it("does NOT call client.getPositions() directly for position loading", () => {
    // After the refactor, sync should use loadLivePositions, not getPositions directly.
    assert.ok(
      !SYNC_SRC.includes("client.getPositions()"),
      "tradovate-sync.ts must not call client.getPositions() directly — use loadLivePositions",
    );
  });

  it("logs position load diagnostics with accountId", () => {
    assert.ok(
      SYNC_SRC.includes("position load diagnostics"),
      "sync must log position load diagnostics",
    );
  });
});

// ── Debug path: uses shared helper ────────────────────────────────────────────

describe("debug/tradovate-position-limit: imports and uses shared loadLivePositions helper", () => {
  it("imports loadLivePositions from shared helper", () => {
    assert.ok(
      DEBUG_SRC.includes("loadLivePositions"),
      "debug route must import loadLivePositions",
    );
    assert.ok(
      DEBUG_SRC.includes("tradovate/load-live-positions"),
      "debug route must import from tradovate/load-live-positions",
    );
  });

  it("calls loadLivePositions with client and externalAccountId", () => {
    assert.ok(
      DEBUG_SRC.includes("loadLivePositions(client, account.externalAccountId)"),
      "debug route must call loadLivePositions with account.externalAccountId",
    );
  });

  it("does NOT call client.getPositions() directly", () => {
    assert.ok(
      !DEBUG_SRC.includes("client.getPositions()"),
      "debug route must not call client.getPositions() directly — use loadLivePositions",
    );
  });

  it("exposes positionLoadDiagnostics in response", () => {
    assert.ok(
      DEBUG_SRC.includes("positionLoadDiagnostics"),
      "debug route must include positionLoadDiagnostics in response",
    );
  });
});

// ── Parity: both paths use the same helper ────────────────────────────────────

describe("parity: sync and debug use same shared load-live-positions helper", () => {
  it("both import from the same module path", () => {
    const HELPER_PATH = "tradovate/load-live-positions";
    assert.ok(SYNC_SRC.includes(HELPER_PATH), `sync must import from ${HELPER_PATH}`);
    assert.ok(DEBUG_SRC.includes(HELPER_PATH), `debug route must import from ${HELPER_PATH}`);
  });

  it("both call loadLivePositions (same function name)", () => {
    assert.ok(SYNC_SRC.includes("loadLivePositions("), "sync must call loadLivePositions(");
    assert.ok(DEBUG_SRC.includes("loadLivePositions("), "debug must call loadLivePositions(");
  });
});
