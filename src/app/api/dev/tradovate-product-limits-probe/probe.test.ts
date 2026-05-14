/**
 * Source-audit tests for the tradovate-product-limits-probe endpoint.
 *
 * Verifies:
 *   - Returns 404 in production (NODE_ENV check)
 *   - Only operates on demo accounts (accountType guard)
 *   - Calls probePerContractPositionLimits() on TradovateClient
 *   - No token values in response shape
 *   - Uses GUARDRAIL_PROBE_LIMIT_DESCRIPTION_PREFIX not GUARDRAIL_POSITION_LIMIT_DESCRIPTION
 *   - TradovateClient.probePerContractPositionLimits method exists in client source
 *   - Probe uses PerContract and PerProduct (not Overall) as totalBy values
 *   - Probe cleans up after itself (deactivates probe limits)
 *
 * Pure source-scan — no network, no DB.
 *
 * Run: npm run test:unit
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTE_SRC = readFileSync(resolve(import.meta.dirname, "./route.ts"), "utf8");
const CLIENT_SRC = readFileSync(
  resolve(import.meta.dirname, "../../../../lib/brokers/tradovate-client.ts"),
  "utf8",
);
const LIMIT_SRC = readFileSync(
  resolve(import.meta.dirname, "../../../../lib/brokers/tradovate-position-limit.ts"),
  "utf8",
);

// ── Route: production guard (x-cron-secret) ──────────────────────────────────

describe("probe route: production secret guard", () => {
  it("checks NODE_ENV === production", () => {
    assert.ok(
      ROUTE_SRC.includes('NODE_ENV === "production"'),
      "route must check NODE_ENV to gate secret requirement",
    );
  });

  it("reads x-cron-secret header", () => {
    assert.ok(
      ROUTE_SRC.includes('request.headers.get("x-cron-secret")'),
      "route must read x-cron-secret header",
    );
  });

  it("compares against CRON_SECRET env var", () => {
    assert.ok(
      ROUTE_SRC.includes("CRON_SECRET"),
      "route must compare against CRON_SECRET env var",
    );
  });

  it("returns 403 without valid secret in production", () => {
    assert.ok(
      ROUTE_SRC.includes("status: 403"),
      "route must return 403 when secret is missing or wrong in production",
    );
  });

  it("does not return 404 as the production secret-gate response", () => {
    // The secret gate must return 403 (forbidden), not 404 (not found).
    // A bare 404 would hide the endpoint entirely; 403 tells callers to add the header.
    assert.ok(
      !ROUTE_SRC.includes('"Not found"'),
      "route must not return a bare 404 Not Found as the production gate response",
    );
  });

  it("error field is 'forbidden' for the secret gate", () => {
    assert.ok(
      ROUTE_SRC.includes('"forbidden"'),
      "secret gate error must be forbidden",
    );
  });
});

// ── Route: demo-only guard ────────────────────────────────────────────────────

describe("probe route: demo-only account guard", () => {
  it("rejects non-demo accounts", () => {
    assert.ok(
      ROUTE_SRC.includes('accountType !== "demo"'),
      "route must reject accounts where accountType !== demo",
    );
  });

  it("returns 403 for non-demo accounts", () => {
    assert.ok(
      ROUTE_SRC.includes("403"),
      "route must return 403 for live/funded accounts",
    );
  });
});

// ── Route: uses probePerContractPositionLimits ────────────────────────────────

describe("probe route: calls probePerContractPositionLimits", () => {
  it("calls client.probePerContractPositionLimits()", () => {
    assert.ok(
      ROUTE_SRC.includes("probePerContractPositionLimits()"),
      "route must call client.probePerContractPositionLimits()",
    );
  });

  it("initializes client before calling probe", () => {
    assert.ok(
      ROUTE_SRC.includes("client.initialize()"),
      "route must call client.initialize() before probing",
    );
  });

  it("includes probeResult in response", () => {
    assert.ok(
      ROUTE_SRC.includes("probeResult"),
      "route must return probeResult in JSON response",
    );
  });

  it("includes interpretation in response", () => {
    assert.ok(
      ROUTE_SRC.includes("interpretation"),
      "route must include interpretation field to help read probe results",
    );
  });
});

// ── Route: no token values ────────────────────────────────────────────────────

describe("probe route: no token values in response", () => {
  it("does not reference accessToken", () => {
    assert.ok(!ROUTE_SRC.includes("accessToken"), "route must not reference accessToken");
  });

  it("does not reference refreshToken", () => {
    assert.ok(!ROUTE_SRC.includes("refreshToken"), "route must not reference refreshToken");
  });

  it("does not reference tokenEncrypted", () => {
    assert.ok(!ROUTE_SRC.includes("tokenEncrypted"), "route must not reference tokenEncrypted");
  });
});

// ── TradovateClient: probePerContractPositionLimits ───────────────────────────

describe("TradovateClient: probePerContractPositionLimits method", () => {
  it("method is defined", () => {
    assert.ok(
      CLIENT_SRC.includes("async probePerContractPositionLimits()"),
      "TradovateClient must define probePerContractPositionLimits()",
    );
  });

  it("uses PerContract as totalBy for probe payloads", () => {
    assert.ok(
      CLIENT_SRC.includes('"PerContract"'),
      "probe method must use totalBy PerContract",
    );
  });

  it("uses PerProduct as totalBy for probe payloads", () => {
    assert.ok(
      CLIENT_SRC.includes('"PerProduct"'),
      "probe method must use totalBy PerProduct",
    );
  });

  it("does NOT use Overall as totalBy in the probe method", () => {
    const probeMethodIdx = CLIENT_SRC.indexOf("async probePerContractPositionLimits()");
    assert.ok(probeMethodIdx !== -1);
    const probeBody = CLIENT_SRC.slice(probeMethodIdx, probeMethodIdx + 3000);
    assert.ok(
      !probeBody.includes('"Overall"'),
      "probe method must NOT use totalBy Overall — that is the production global cap",
    );
  });

  it("uses GUARDRAIL_PROBE_LIMIT_DESCRIPTION_PREFIX for probe descriptions", () => {
    assert.ok(
      CLIENT_SRC.includes("GUARDRAIL_PROBE_LIMIT_DESCRIPTION_PREFIX"),
      "probe must use GUARDRAIL_PROBE_LIMIT_DESCRIPTION_PREFIX for limit descriptions",
    );
  });

  it("deactivates probe limits after creation (cleanup)", () => {
    const probeMethodIdx = CLIENT_SRC.indexOf("async probePerContractPositionLimits()");
    assert.ok(probeMethodIdx !== -1);
    const probeBody = CLIENT_SRC.slice(probeMethodIdx, probeMethodIdx + 3000);
    assert.ok(
      probeBody.includes("active: false"),
      "probe method must deactivate probe limits after creation",
    );
    assert.ok(
      probeBody.includes("userAccountPositionLimit/update"),
      "probe cleanup must call userAccountPositionLimit/update to deactivate",
    );
  });

  it("does not log token values", () => {
    const probeMethodIdx = CLIENT_SRC.indexOf("async probePerContractPositionLimits()");
    assert.ok(probeMethodIdx !== -1);
    const probeBody = CLIENT_SRC.slice(probeMethodIdx, probeMethodIdx + 3000);
    assert.ok(!probeBody.includes("accessToken"), "probe must not log accessToken");
    assert.ok(!probeBody.includes("refreshToken"), "probe must not log refreshToken");
  });
});

// ── Position limit module: probe types exported ───────────────────────────────

describe("tradovate-position-limit: probe types exported", () => {
  it("exports GUARDRAIL_PROBE_LIMIT_DESCRIPTION_PREFIX", () => {
    assert.ok(
      LIMIT_SRC.includes("export const GUARDRAIL_PROBE_LIMIT_DESCRIPTION_PREFIX"),
      "tradovate-position-limit must export GUARDRAIL_PROBE_LIMIT_DESCRIPTION_PREFIX",
    );
  });

  it("exports ProbeAttempt type", () => {
    assert.ok(
      LIMIT_SRC.includes("export type ProbeAttempt"),
      "tradovate-position-limit must export ProbeAttempt type",
    );
  });

  it("exports ProbePerContractResult type", () => {
    assert.ok(
      LIMIT_SRC.includes("export type ProbePerContractResult"),
      "tradovate-position-limit must export ProbePerContractResult type",
    );
  });

  it("GUARDRAIL_PROBE_LIMIT_DESCRIPTION_PREFIX is different from GUARDRAIL_POSITION_LIMIT_DESCRIPTION", () => {
    assert.ok(
      LIMIT_SRC.includes('GUARDRAIL_PROBE_LIMIT_DESCRIPTION_PREFIX = "Guardrail Probe"'),
      "probe prefix must be a distinct string starting with 'Guardrail Probe'",
    );
    assert.ok(
      LIMIT_SRC.includes('GUARDRAIL_POSITION_LIMIT_DESCRIPTION = "Guardrail Max Position Size"'),
      "production description must be 'Guardrail Max Position Size'",
    );
  });
});
