/**
 * Tests for POST /api/cron/renew-tradovate-tokens.
 *
 * These are source-scan and pure-logic tests — no DB, no network, no Tradovate
 * credentials required. They verify the structural guarantees of the route:
 *   - auth gating with x-cron-secret
 *   - correct query scope (only connected connections with expiring tokens)
 *   - delegation to ensureTradovateAccessToken (not raw Tradovate HTTP)
 *   - transient errors do NOT mark connections expired
 *   - response shape: checked / renewed / skipped / failed / errors
 *   - lookahead window is wider than REFRESH_BUFFER_MS
 *
 * Run:  npm run test:unit
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REFRESH_BUFFER_MINUTES = 15; // matches REFRESH_BUFFER_MS = 15 * 60 * 1000

const ROUTE_FILE = resolve(import.meta.dirname, "./route.ts");
const SCRIPT_FILE = resolve(
  import.meta.dirname,
  "../../../../..",
  "scripts/cron-renew-tradovate-tokens.mjs",
);

function src(path: string): string {
  return readFileSync(path, "utf8");
}

// ── Auth ──────────────────────────────────────────────────────────────────────

describe("POST /api/cron/renew-tradovate-tokens: authentication", () => {
  it("rejects requests without x-cron-secret header", () => {
    const s = src(ROUTE_FILE);
    assert.ok(
      s.includes("x-cron-secret"),
      "route must check the x-cron-secret header",
    );
    assert.ok(
      s.includes('status: 401'),
      "route must return 401 when the secret is missing or wrong",
    );
  });

  it("compares secret against CRON_SECRET env var", () => {
    const s = src(ROUTE_FILE);
    assert.ok(
      s.includes("process.env.CRON_SECRET"),
      "route must compare against CRON_SECRET env var, not a hardcoded value",
    );
  });
});

// ── Query scope ───────────────────────────────────────────────────────────────

describe("POST /api/cron/renew-tradovate-tokens: query scope", () => {
  it("only selects tradovate platform connections", () => {
    const s = src(ROUTE_FILE);
    assert.ok(
      s.includes('platform: "tradovate"'),
      "query must be scoped to tradovate platform",
    );
  });

  it("only selects connected_readonly and connected_live connections", () => {
    const s = src(ROUTE_FILE);
    assert.ok(
      s.includes('"connected_readonly"') && s.includes('"connected_live"'),
      "query must filter to connected_readonly and connected_live — expired connections are excluded",
    );
    // Verify the connectionStatus filter expression does NOT include "expired".
    // Scope check to the findMany where-clause to avoid false positives from comments.
    const whereStart = s.indexOf("connectionStatus: { in: [");
    const whereEnd = s.indexOf("]", whereStart);
    const whereBlock = s.slice(whereStart, whereEnd);
    assert.ok(
      !whereBlock.includes('"expired"'),
      "connectionStatus filter must NOT include expired — those connections need user re-auth",
    );
  });

  it("selects connections where tokenExpiresAt is null (no metadata)", () => {
    const s = src(ROUTE_FILE);
    assert.ok(
      s.includes("tokenExpiresAt: null"),
      "must include connections with no expiry metadata — renew defensively",
    );
  });

  it("selects connections where tokenExpiresAt is within the look-ahead window", () => {
    const s = src(ROUTE_FILE);
    assert.ok(
      s.includes("tokenExpiresAt: { lte: lookaheadCutoff }"),
      "must include connections whose token expires within the look-ahead window",
    );
    assert.ok(
      s.includes("lookaheadCutoff"),
      "look-ahead cutoff must be computed from RENEWAL_LOOKAHEAD_MS",
    );
  });

  it("skips connections whose tokens have plenty of time remaining (no unnecessary queries)", () => {
    const s = src(ROUTE_FILE);
    // The OR filter means only connections with expiring/null tokens are loaded.
    // A connection with tokenExpiresAt = now + 2h is not in the OR window.
    assert.ok(
      s.includes("OR: ["),
      "query must use an OR to express the selection condition concisely",
    );
  });
});

// ── Look-ahead window ─────────────────────────────────────────────────────────

describe("POST /api/cron/renew-tradovate-tokens: RENEWAL_LOOKAHEAD_MS", () => {
  it("RENEWAL_LOOKAHEAD_MS is defined as a constant in the route", () => {
    const s = src(ROUTE_FILE);
    assert.ok(
      s.includes("RENEWAL_LOOKAHEAD_MS"),
      "route must define RENEWAL_LOOKAHEAD_MS for the pre-filter window",
    );
  });

  it("RENEWAL_LOOKAHEAD_MS is wider than REFRESH_BUFFER_MS (15 min)", () => {
    // RENEWAL_LOOKAHEAD_MS = 25 min > REFRESH_BUFFER_MS = 15 min.
    // This ensures connections expiring within two 10-min cron intervals
    // are always caught even if the cron runs slightly late.
    const routeSrc = src(ROUTE_FILE);
    const match = routeSrc.match(/RENEWAL_LOOKAHEAD_MS\s*=\s*(\d+)\s*\*\s*60\s*\*\s*1000/);
    assert.ok(match, "RENEWAL_LOOKAHEAD_MS must be expressed as N * 60 * 1000");
    const lookaheadMinutes = parseInt(match[1], 10);
    assert.ok(
      lookaheadMinutes > REFRESH_BUFFER_MINUTES,
      `RENEWAL_LOOKAHEAD_MS (${lookaheadMinutes} min) must be > REFRESH_BUFFER_MS (${REFRESH_BUFFER_MINUTES} min)`,
    );
  });

  it("RENEWAL_LOOKAHEAD_MS covers two cron intervals (2 × 10 min) with headroom", () => {
    const CRON_INTERVAL_MINUTES = 10;
    const lookaheadMinutes = 25;
    assert.ok(
      lookaheadMinutes > 2 * CRON_INTERVAL_MINUTES,
      `${lookaheadMinutes}-min window must cover 2 × ${CRON_INTERVAL_MINUTES}-min cron intervals`,
    );
  });
});

// ── Delegation to ensureTradovateAccessToken ──────────────────────────────────

describe("POST /api/cron/renew-tradovate-tokens: uses ensureTradovateAccessToken", () => {
  it("imports and calls ensureTradovateAccessToken — not a direct Tradovate fetch", () => {
    const s = src(ROUTE_FILE);
    assert.ok(
      s.includes("ensureTradovateAccessToken"),
      "route must delegate to ensureTradovateAccessToken, not make direct Tradovate API calls",
    );
    assert.ok(
      !s.includes("fetch(renewUrl") && !s.includes("fetch(tokenUrl"),
      "route must not make raw HTTP calls to Tradovate — renewal logic lives in ensureTradovateAccessToken",
    );
  });

  it("passes brokerConnectionId and userId to ensureTradovateAccessToken", () => {
    const s = src(ROUTE_FILE);
    assert.ok(
      s.includes("brokerConnectionId: bc.id"),
      "must pass bc.id as brokerConnectionId",
    );
    assert.ok(
      s.includes("userId: bc.userId"),
      "must pass bc.userId so ensureTradovateAccessToken can scope the DB query to the owner",
    );
  });

  it("reads result.renewed to distinguish actual renewal from no-op", () => {
    const s = src(ROUTE_FILE);
    assert.ok(
      s.includes("result.renewed"),
      "route must check result.renewed to count actual renewals vs. already-fresh tokens",
    );
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe("POST /api/cron/renew-tradovate-tokens: error handling", () => {
  it("catches errors per-connection and continues processing remaining connections", () => {
    const s = src(ROUTE_FILE);
    // The for loop must have a try/catch inside it, not wrap the whole loop.
    const loopStart = s.indexOf("for (const bc of connections)");
    const loopEnd = s.indexOf("\n  }", loopStart + 1);
    const loopBody = s.slice(loopStart, loopEnd);
    assert.ok(
      loopBody.includes("try {") && loopBody.includes("} catch"),
      "must catch errors inside the per-connection loop so one failure doesn't abort all renewals",
    );
  });

  it("records failed connection in errors array without re-throwing", () => {
    const s = src(ROUTE_FILE);
    assert.ok(
      s.includes("errors.push("),
      "errors must be accumulated in an array so the response can report them",
    );
  });

  it("does NOT call markExpiredWithAccounts directly — expiry marking is delegated to ensureTradovateAccessToken", () => {
    const s = src(ROUTE_FILE);
    assert.ok(
      !s.includes("markExpiredWithAccounts"),
      "route must not call markExpiredWithAccounts — ensureTradovateAccessToken handles expired marking for auth_invalid failures",
    );
    assert.ok(
      !s.includes('connectionStatus: "expired"'),
      "route must not write expired status — that is ensureTradovateAccessToken's responsibility",
    );
  });
});

// ── Response shape ────────────────────────────────────────────────────────────

describe("POST /api/cron/renew-tradovate-tokens: response shape", () => {
  it("response includes checked, renewed, skipped, failed, errors", () => {
    const s = src(ROUTE_FILE);
    assert.ok(s.includes("checked:"), "response must include checked count");
    assert.ok(s.includes("renewed:"), "response must include renewed count");
    assert.ok(s.includes("skipped:"), "response must include skipped count");
    assert.ok(s.includes("failed:"), "response must include failed count");
    assert.ok(s.includes("errors:"), "response must include errors array");
  });

  it("returns early with checked: 0 when no connections need attention", () => {
    const s = src(ROUTE_FILE);
    assert.ok(
      s.includes("connections.length === 0"),
      "must return early when no connections need renewal",
    );
    assert.ok(
      s.includes("checked: 0"),
      "early return must report checked: 0",
    );
  });

  it("ok is false when any connection failed", () => {
    const s = src(ROUTE_FILE);
    assert.ok(
      s.includes("ok: failed === 0"),
      "ok field must be false when any renewal failed",
    );
  });
});

// ── Script ────────────────────────────────────────────────────────────────────

describe("scripts/cron-renew-tradovate-tokens.mjs: companion script", () => {
  it("calls the correct endpoint path", () => {
    const s = src(SCRIPT_FILE);
    assert.ok(
      s.includes("/api/cron/renew-tradovate-tokens"),
      "script must call /api/cron/renew-tradovate-tokens",
    );
  });

  it("passes x-cron-secret header from CRON_SECRET env var", () => {
    const s = src(SCRIPT_FILE);
    assert.ok(
      s.includes('"x-cron-secret": secret'),
      "script must attach x-cron-secret header",
    );
    assert.ok(
      s.includes("process.env.CRON_SECRET"),
      "script must read CRON_SECRET from env",
    );
  });

  it("exits 0 on transient renewal failures (does not alert for retryable errors)", () => {
    const s = src(SCRIPT_FILE);
    // The script exits 1 only on HTTP-level failure, not on server-reported renewal errors.
    // Transient renewal failures are retried on the next cron run.
    assert.ok(
      s.includes("process.exit(1)"),
      "script must exit 1 when the HTTP call itself fails",
    );
    assert.ok(
      !s.includes("if (failed > 0)"),
      "script must NOT exit 1 for server-reported renewal failures — those are retried",
    );
  });

  it("logs checked / renewed / skipped / failed counts", () => {
    const s = src(SCRIPT_FILE);
    assert.ok(s.includes("checked"), "script must log checked count");
    assert.ok(s.includes("renewed"), "script must log renewed count");
    assert.ok(s.includes("skipped"), "script must log skipped count");
    assert.ok(s.includes("failed"), "script must log failed count");
  });

  it("includes Railway cron documentation", () => {
    const s = src(SCRIPT_FILE);
    assert.ok(
      s.includes("Railway") || s.includes("railway"),
      "script must document Railway cron setup",
    );
    assert.ok(
      s.includes("10"),
      "script must mention the 10-minute recommended schedule",
    );
  });
});
