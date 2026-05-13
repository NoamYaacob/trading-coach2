/**
 * Tests for the pure helpers behind the Tradovate listener worker.
 *
 * Verifies:
 *   - Only healthy, non-expired Tradovate connections are queued for a listener.
 *   - Connections missing a broker user id are skipped (no listener started).
 *   - Listener state → DB status mapping matches what the dashboard expects.
 *
 * Source-scan tests (further below) guard against:
 *   - Token field names appearing in any log call.
 *   - Re-enabling enforcement / lock writes from the worker.
 *   - The duplicate-listener guard being removed.
 *   - Forgetting graceful shutdown.
 *
 * Run: npm run test:unit
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  HEALTHY_CONNECTION_STATUSES,
  isReadyDbStatus,
  listenerStateToDbStatus,
  planListenerStartups,
  type BrokerConnectionRow,
} from "./tradovate-listener-worker-logic.ts";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<BrokerConnectionRow> = {}): BrokerConnectionRow {
  return {
    id: "conn-1",
    userId: "user-1",
    platform: "tradovate",
    env: "demo",
    brokerUserId: "12345",
    connectionStatus: "connected_live",
    permissionLevel: "full_access",
    tokenExpiresAt: null,
    lastRenewError: null,
    ...overrides,
  };
}

// ── Healthy connection filter ────────────────────────────────────────────────

describe("planListenerStartups: healthy connections", () => {
  it("queues a connected_live full_access connection", () => {
    const { start, skipped } = planListenerStartups([makeRow()]);
    assert.equal(start.length, 1, "must queue the healthy connection");
    assert.equal(skipped.length, 0);
    assert.equal(start[0]!.connectionId, "conn-1");
    assert.equal(start[0]!.userId, "user-1");
    assert.equal(start[0]!.tradovateUserId, 12345);
    assert.equal(start[0]!.env, "demo");
    assert.equal(start[0]!.permissionLevel, "full_access");
  });

  it("queues a connected_readonly connection (read-only is still observable)", () => {
    const { start, skipped } = planListenerStartups([
      makeRow({ connectionStatus: "connected_readonly", permissionLevel: "read_only" }),
    ]);
    assert.equal(start.length, 1, "read-only is allowed in observe-only mode");
    assert.equal(skipped.length, 0);
    assert.equal(start[0]!.permissionLevel, "read_only");
  });

  it("normalises unknown permissionLevel values to null", () => {
    const { start } = planListenerStartups([
      makeRow({ permissionLevel: "unknown_value" }),
    ]);
    assert.equal(start.length, 1);
    assert.equal(start[0]!.permissionLevel, null);
  });

  it("normalises a null permissionLevel to null in the plan", () => {
    const { start } = planListenerStartups([makeRow({ permissionLevel: null })]);
    assert.equal(start.length, 1);
    assert.equal(start[0]!.permissionLevel, null);
  });
});

// ── Expired / unhealthy connection skip ──────────────────────────────────────

describe("planListenerStartups: expired and unhealthy connections", () => {
  it("skips a connection with status 'expired'", () => {
    const { start, skipped } = planListenerStartups([
      makeRow({ connectionStatus: "expired" }),
    ]);
    assert.equal(start.length, 0, "expired connections must NOT get a listener");
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0]!.reason, "unhealthy_status");
  });

  it("skips a connection with status 'connection_error'", () => {
    const { skipped } = planListenerStartups([
      makeRow({ connectionStatus: "connection_error" }),
    ]);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0]!.reason, "unhealthy_status");
  });

  it("skips a connection with status 'not_connected'", () => {
    const { skipped } = planListenerStartups([
      makeRow({ connectionStatus: "not_connected" }),
    ]);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0]!.reason, "unhealthy_status");
  });

  it("HEALTHY_CONNECTION_STATUSES set excludes expired/error statuses", () => {
    assert.equal(HEALTHY_CONNECTION_STATUSES.has("connected_live"), true);
    assert.equal(HEALTHY_CONNECTION_STATUSES.has("connected_readonly"), true);
    assert.equal(HEALTHY_CONNECTION_STATUSES.has("expired"), false);
    assert.equal(HEALTHY_CONNECTION_STATUSES.has("connection_error"), false);
    assert.equal(HEALTHY_CONNECTION_STATUSES.has("not_connected"), false);
  });
});

// ── Missing fields / invalid input ───────────────────────────────────────────

describe("planListenerStartups: invalid rows", () => {
  it("skips rows with platform != tradovate", () => {
    const { skipped } = planListenerStartups([makeRow({ platform: "tradingview" })]);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0]!.reason, "wrong_platform");
  });

  it("skips rows with no brokerUserId", () => {
    const { skipped } = planListenerStartups([makeRow({ brokerUserId: null })]);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0]!.reason, "missing_broker_user_id");
  });

  it("skips rows with non-numeric brokerUserId", () => {
    const { skipped } = planListenerStartups([makeRow({ brokerUserId: "not-a-number" })]);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0]!.reason, "invalid_broker_user_id");
  });

  it("skips rows with brokerUserId <= 0", () => {
    const { skipped } = planListenerStartups([makeRow({ brokerUserId: "0" })]);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0]!.reason, "invalid_broker_user_id");
  });

  it("skips rows with unsupported env value", () => {
    const { skipped } = planListenerStartups([makeRow({ env: "test" })]);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0]!.reason, "unsupported_env");
  });
});

// ── Token eligibility ────────────────────────────────────────────────────────

describe("planListenerStartups: token eligibility", () => {
  it("starts a connection when tokenExpiresAt is null (no expiry known)", () => {
    const { start, skipped } = planListenerStartups([makeRow({ tokenExpiresAt: null })]);
    assert.equal(start.length, 1);
    assert.equal(skipped.length, 0);
  });

  it("starts a connection when tokenExpiresAt is in the future", () => {
    const future = new Date(Date.now() + 60_000);
    const { start, skipped } = planListenerStartups([makeRow({ tokenExpiresAt: future })]);
    assert.equal(start.length, 1);
    assert.equal(skipped.length, 0);
  });

  it("skips with expired_token when tokenExpiresAt is in the past", () => {
    const past = new Date(Date.now() - 60_000);
    const { skipped } = planListenerStartups([makeRow({ tokenExpiresAt: past })]);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0]!.reason, "expired_token");
  });

  it("skips with renew_error when lastRenewError is set (even with valid token)", () => {
    const future = new Date(Date.now() + 60_000);
    const { skipped } = planListenerStartups([
      makeRow({ tokenExpiresAt: future, lastRenewError: "auth_invalid" }),
    ]);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0]!.reason, "renew_error");
  });

  it("renew_error takes priority over expired_token", () => {
    const past = new Date(Date.now() - 60_000);
    const { skipped } = planListenerStartups([
      makeRow({ tokenExpiresAt: past, lastRenewError: "auth_invalid" }),
    ]);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0]!.reason, "renew_error");
  });

  it("diagnostic snapshot includes tokenExpired and tokenExpiresAtExists", () => {
    const past = new Date(Date.now() - 60_000);
    const { skipped } = planListenerStartups([makeRow({ tokenExpiresAt: past })]);
    assert.equal(skipped[0]!.tokenExpired, true);
    assert.equal(skipped[0]!.tokenExpiresAtExists, true);
    assert.equal(skipped[0]!.connectionId, "conn-1");
    assert.equal(skipped[0]!.connectionStatus, "connected_live");
    assert.equal(skipped[0]!.permissionLevel, "full_access");
  });

  it("diagnostic snapshot tokenExpired=false when tokenExpiresAt is null", () => {
    const { skipped } = planListenerStartups([makeRow({ brokerUserId: null })]);
    assert.equal(skipped[0]!.tokenExpired, false);
    assert.equal(skipped[0]!.tokenExpiresAtExists, false);
  });
});

// ── Mixed batch ──────────────────────────────────────────────────────────────

describe("planListenerStartups: mixed batch", () => {
  it("returns the healthy ones in 'start' and the rest in 'skipped'", () => {
    const rows: BrokerConnectionRow[] = [
      makeRow({ id: "ok-1" }),
      makeRow({ id: "expired-1", connectionStatus: "expired" }),
      makeRow({ id: "ok-2", env: "live" }),
      makeRow({ id: "no-user", brokerUserId: null, tokenExpiresAt: null }),
    ];
    const { start, skipped } = planListenerStartups(rows);
    const startIds = start.map((p) => p.connectionId).sort();
    const skippedIds = skipped.map((s) => s.connectionId).sort();
    assert.deepEqual(startIds, ["ok-1", "ok-2"]);
    assert.deepEqual(skippedIds, ["expired-1", "no-user"]);
  });
});

// ── State → DB status mapping ────────────────────────────────────────────────

describe("listenerStateToDbStatus", () => {
  it("maps 'ready' to 'connected'", () => {
    assert.equal(listenerStateToDbStatus("ready"), "connected");
  });

  it("maps 'syncing' to 'connected'", () => {
    // syncing also produces events — dashboard should treat it as live.
    assert.equal(listenerStateToDbStatus("syncing"), "connected");
  });

  it("maps 'connecting' to 'connecting'", () => {
    assert.equal(listenerStateToDbStatus("connecting"), "connecting");
  });

  it("maps 'authorizing' to 'connecting'", () => {
    // authorizing is part of the connect handshake; dashboard shows reconnecting copy
    assert.equal(listenerStateToDbStatus("authorizing"), "connecting");
  });

  it("maps 'reconnecting' to 'reconnecting'", () => {
    assert.equal(listenerStateToDbStatus("reconnecting"), "reconnecting");
  });

  it("maps 'closed' to 'closed'", () => {
    assert.equal(listenerStateToDbStatus("closed"), "closed");
  });

  it("maps 'idle' to 'connecting'", () => {
    assert.equal(listenerStateToDbStatus("idle"), "connecting");
  });

  it("isReadyDbStatus is true only for 'connected'", () => {
    assert.equal(isReadyDbStatus("connected"), true);
    assert.equal(isReadyDbStatus("connecting"), false);
    assert.equal(isReadyDbStatus("reconnecting"), false);
    assert.equal(isReadyDbStatus("closed"), false);
  });
});

// ── Source-scan: observe-only safety + token safety ──────────────────────────

const WORKER_SRC_RAW = readFileSync(
  resolve(import.meta.dirname, "../../../scripts/tradovate-listener-worker.ts"),
  "utf8",
);

/** Worker source with comments stripped — used for "no call to X" assertions
 *  so that documentation explaining what we deliberately don't call doesn't
 *  trip the source-scan. */
const WORKER_SRC = WORKER_SRC_RAW
  // Remove /** ... */ block comments (handles JSDoc + multi-line)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  // Remove // line comments
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("listener worker source: observe-only safety", () => {
  it("does NOT call decideRealtimeEnforcement (Phase 1 = observe-only)", () => {
    assert.ok(
      !WORKER_SRC.includes("decideRealtimeEnforcement"),
      "Phase 1 worker must not invoke enforcement decisions",
    );
  });

  it("does NOT write riskState anywhere", () => {
    assert.ok(
      !WORKER_SRC.includes("riskState"),
      "Phase 1 worker must not change riskState",
    );
  });

  it("does NOT create RuleViolation rows", () => {
    assert.ok(
      !WORKER_SRC.includes("ruleViolation") && !WORKER_SRC.includes("RuleViolation"),
      "Phase 1 worker must not write RuleViolation rows",
    );
  });

  it("does NOT call flatten / applyMaxPositionSize / closePosition", () => {
    for (const forbidden of ["flattenPositions", "applyMaxPositionSize", "closePosition"]) {
      assert.ok(
        !WORKER_SRC.includes(forbidden),
        `Phase 1 worker must not call ${forbidden}`,
      );
    }
  });
});

describe("listener worker source: token safety", () => {
  it("never logs token field names", () => {
    const forbidden = [
      "accessToken",
      "refreshToken",
      "tokenEncrypted",
      "accessTokenEncrypted",
      "refreshTokenEncrypted",
    ];
    const logCalls = WORKER_SRC.match(/console\.(log|warn|info|error)\([\s\S]*?\)\s*;/g) ?? [];
    for (const logCall of logCalls) {
      for (const field of forbidden) {
        assert.ok(
          !logCall.includes(field),
          `log call must not include "${field}": ${logCall.slice(0, 100)}`,
        );
      }
    }
  });

  it("uses the ensureTradovateAccessToken refresh path", () => {
    assert.ok(
      WORKER_SRC.includes("ensureTradovateAccessToken"),
      "worker must reuse the existing token-refresh helper",
    );
  });
});

describe("listener worker source: dedup + shutdown", () => {
  it("relies on TradovateListenerManager for deduplication", () => {
    assert.ok(
      WORKER_SRC.includes("TradovateListenerManager"),
      "worker must use TradovateListenerManager for per-process dedup",
    );
    assert.ok(
      WORKER_SRC.includes("manager.hasListener("),
      "worker must check hasListener before starting a new listener",
    );
  });

  it("has SIGTERM and SIGINT handlers that call closeAll", () => {
    assert.ok(WORKER_SRC.includes("SIGTERM"), "worker must handle SIGTERM");
    assert.ok(WORKER_SRC.includes("SIGINT"), "worker must handle SIGINT");
    assert.ok(WORKER_SRC.includes("closeAll"), "worker must call manager.closeAll() on shutdown");
  });

  it("staggers startup with a non-zero delay between listener starts", () => {
    assert.ok(
      WORKER_SRC.includes("STARTUP_STAGGER_MS"),
      "worker must define a stagger constant",
    );
    assert.ok(
      /STARTUP_STAGGER_MS\s*=\s*[1-9]\d*/.test(WORKER_SRC),
      "stagger constant must be positive",
    );
  });

  it("periodically reconciles connections from DB", () => {
    assert.ok(
      WORKER_SRC.includes("setInterval"),
      "worker must re-scan DB on an interval to pick up new/removed connections",
    );
    assert.ok(
      WORKER_SRC.includes("RESCAN_INTERVAL_MS"),
      "worker must define a rescan interval constant",
    );
  });
});

describe("listener worker source: persistence", () => {
  it("writes BrokerConnection.listenerStatus on state changes", () => {
    assert.ok(
      WORKER_SRC.includes("listenerStatus"),
      "worker must persist listenerStatus",
    );
    assert.ok(
      WORKER_SRC.includes("listenerLastHeartbeatAt"),
      "worker must persist listenerLastHeartbeatAt",
    );
    assert.ok(
      WORKER_SRC.includes("listenerLastEventAt"),
      "worker must persist listenerLastEventAt",
    );
    assert.ok(
      WORKER_SRC.includes("listenerConnectedAt"),
      "worker must stamp listenerConnectedAt on first connect",
    );
  });
});

// ── Railway config — service correctness ─────────────────────────────────────

const RAILWAY_WORKER_CONFIG = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../../railway-listener-worker-config/railway.json"),
    "utf8",
  ),
) as {
  deploy: {
    startCommand: string;
    restartPolicyType: string;
    restartPolicyMaxRetries: number;
    numReplicas?: number;
    cronSchedule?: string;
    healthcheckPath?: string;
  };
};

describe("railway-listener-worker-config/railway.json", () => {
  it("startCommand runs the worker script via the start:listener npm script", () => {
    assert.ok(
      RAILWAY_WORKER_CONFIG.deploy.startCommand.includes("start:listener"),
      "startCommand must invoke the start:listener npm script (tsx-backed)",
    );
  });

  it("restartPolicyType is ON_FAILURE with retries=10", () => {
    assert.equal(RAILWAY_WORKER_CONFIG.deploy.restartPolicyType, "ON_FAILURE");
    assert.equal(RAILWAY_WORKER_CONFIG.deploy.restartPolicyMaxRetries, 10);
  });

  it("has no cronSchedule (persistent process, not a cron)", () => {
    assert.equal(RAILWAY_WORKER_CONFIG.deploy.cronSchedule, undefined);
  });

  it("has no healthcheckPath (worker has no HTTP surface)", () => {
    assert.equal(RAILWAY_WORKER_CONFIG.deploy.healthcheckPath, undefined);
  });

  it("explicitly pins numReplicas to 1 (manager dedup is per-process)", () => {
    assert.equal(
      RAILWAY_WORKER_CONFIG.deploy.numReplicas,
      1,
      "two replicas would each open a duplicate WebSocket per connection",
    );
  });
});
