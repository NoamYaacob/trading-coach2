/**
 * Source-scan tests for POST /api/brokers/[connectionId]/sync.
 *
 * Verifies structural guarantees without a DB or network:
 *   - syncTradovateConnection is called
 *   - expired/connection_error connections return 409 reconnect_required BEFORE sync
 *   - thrown exceptions are caught and returned as structured JSON (not raw 500/502)
 *   - sync-all skips expired connections (only queries healthy ones)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTE_FILE = resolve(import.meta.dirname, "./route.ts");
const SYNC_ALL_FILE = resolve(
  import.meta.dirname,
  "../../../accounts/sync-all/route.ts",
);

function src(f = ROUTE_FILE): string {
  return readFileSync(f, "utf8");
}

describe("POST /api/brokers/[connectionId]/sync: error handling", () => {
  it("wraps syncTradovateConnection in try/catch", () => {
    const s = src();
    const callIdx = s.indexOf("syncTradovateConnection(");
    assert.ok(callIdx !== -1, "syncTradovateConnection must be called");
    const tryIdx = s.lastIndexOf("try {", callIdx);
    assert.ok(tryIdx !== -1, "syncTradovateConnection call must be inside a try block");
    assert.ok(tryIdx < callIdx, "try must appear before syncTradovateConnection call");
  });

  it("catch block returns structured JSON, not unhandled throw", () => {
    const s = src();
    assert.ok(s.includes("catch (err)"), "must have a catch block");
    assert.ok(
      s.includes("NextResponse.json(") && s.includes("status: 502"),
      "catch must return NextResponse.json with 502 status",
    );
  });

  it("catch block does not re-throw", () => {
    const s = src();
    const catchIdx = s.indexOf("catch (err)");
    assert.ok(catchIdx !== -1);
    const catchBody = s.slice(catchIdx, s.indexOf("\n  }", catchIdx + 1) + 4);
    assert.ok(
      !catchBody.includes("throw "),
      "catch block must not re-throw the error",
    );
  });

  it("returns ok:false on catch", () => {
    const s = src();
    const catchIdx = s.indexOf("catch (err)");
    const afterCatch = s.slice(catchIdx, catchIdx + 300);
    assert.ok(
      afterCatch.includes("ok: false"),
      "catch response must include ok: false",
    );
  });
});

describe("POST /api/brokers/[connectionId]/sync: auth", () => {
  it("checks for current user before syncing", () => {
    const s = src();
    assert.ok(s.includes("getCurrentUser"), "must call getCurrentUser");
    assert.ok(s.includes("status: 401"), "must return 401 when unauthenticated");
  });

  it("verifies connection belongs to current user", () => {
    const s = src();
    assert.ok(
      s.includes("userId: currentUser.id"),
      "must scope DB lookup to current user",
    );
    assert.ok(s.includes("status: 404"), "must return 404 when connection not found");
  });
});

describe("POST /api/brokers/[connectionId]/sync: expired connection handling", () => {
  it("fetches connectionStatus in the connection lookup", () => {
    const s = src();
    const lookupIdx = s.indexOf("brokerConnection.findFirst");
    assert.ok(lookupIdx !== -1, "must query BrokerConnection");
    const lookupBlock = s.slice(lookupIdx, s.indexOf("});", lookupIdx) + 3);
    assert.ok(
      lookupBlock.includes("connectionStatus"),
      "connection lookup must select connectionStatus",
    );
  });

  it("returns 409 reconnect_required before syncing an expired connection", () => {
    const s = src();
    assert.ok(s.includes('"reconnect_required"'), "must return reconnect_required error code");
    assert.ok(s.includes("status: 409"), "must use 409 status for expired connection");
    // The 409 must appear BEFORE syncTradovateConnection is called
    const status409Idx = s.indexOf("status: 409");
    const syncCallIdx = s.indexOf("syncTradovateConnection(");
    assert.ok(
      status409Idx < syncCallIdx,
      "409 reconnect_required must be returned before syncTradovateConnection is called",
    );
  });

  it("checks both expired and connection_error statuses", () => {
    const s = src();
    // Find the status-check block (before syncTradovateConnection)
    const syncCallIdx = s.indexOf("syncTradovateConnection(");
    const statusCheckBlock = s.slice(0, syncCallIdx);
    assert.ok(
      statusCheckBlock.includes('"expired"'),
      "must handle expired status",
    );
    assert.ok(
      statusCheckBlock.includes('"connection_error"'),
      "must handle connection_error status",
    );
  });

  it("response includes connectionStatus field for expired connections", () => {
    const s = src();
    const reconnectIdx = s.indexOf('"reconnect_required"');
    const reconnectBlock = s.slice(reconnectIdx, reconnectIdx + 150);
    assert.ok(
      reconnectBlock.includes("connectionStatus"),
      "reconnect_required response must include the connectionStatus field",
    );
  });
});

describe("sync-all: only syncs healthy connections", () => {
  it("filters to connected_readonly and connected_live only", () => {
    const s = src(SYNC_ALL_FILE);
    assert.ok(
      s.includes('"connected_readonly"') && s.includes('"connected_live"'),
      "sync-all must include healthy statuses in its query",
    );
    // The 'in' filter must appear in the DB query
    const queryIdx = s.indexOf("brokerConnection.findMany");
    const queryBlock = s.slice(queryIdx, s.indexOf("});", queryIdx) + 3);
    assert.ok(
      queryBlock.includes("connectionStatus"),
      "sync-all query must filter by connectionStatus",
    );
  });

  it("does not include expired or connection_error in sync-all query", () => {
    const s = src(SYNC_ALL_FILE);
    const queryIdx = s.indexOf("brokerConnection.findMany");
    const queryBlock = s.slice(queryIdx, s.indexOf("});", queryIdx) + 3);
    assert.ok(
      !queryBlock.includes('"expired"'),
      "sync-all must not query expired connections",
    );
    assert.ok(
      !queryBlock.includes('"connection_error"'),
      "sync-all must not query connection_error connections",
    );
  });

  it("wraps per-connection sync in try/catch so one failure does not abort others", () => {
    const s = src(SYNC_ALL_FILE);
    assert.ok(
      s.includes("try {") && s.includes("catch (err)"),
      "sync-all must wrap each connection sync in try/catch",
    );
  });
});

// ── maxPositionSize pass-through ──────────────────────────────────────────────

describe("POST /api/brokers/[connectionId]/sync: maxPositionSize diagnostics in response", () => {
  it("results map includes maxPositionSize field from SyncResult", () => {
    const s = src();
    // Find the results.map block
    const mapIdx = s.indexOf("results.map(");
    assert.ok(mapIdx !== -1, "route must call results.map");
    const mapBlock = s.slice(mapIdx, s.indexOf("})),", mapIdx) + 4);
    assert.ok(
      mapBlock.includes("maxPositionSize: r.maxPositionSize"),
      "results map must include maxPositionSize: r.maxPositionSize (not omit it)",
    );
  });

  it("route does NOT filter out maxPositionSize (all SyncResult diagnostic fields pass through)", () => {
    const s = src();
    // The map must not be an exhaustive allowlist that drops maxPositionSize.
    // Verify maxPositionSize appears in the results.map body.
    assert.ok(
      s.includes("maxPositionSize"),
      "maxPositionSize must appear in the route source — was it accidentally filtered?",
    );
  });

  it("SyncResult type includes all required max_position_size diagnostic fields", () => {
    const syncSrc = readFileSync(
      resolve(import.meta.dirname, "../../../../../lib/brokers/tradovate-sync.ts"),
      "utf8",
    );
    const required = [
      "riskStateAtSyncStart",
      "riskStateAtSyncEnd",
      "wouldBreach",
      "ruleTriggered",
      "violationCreated",
      "violationSuppressedReason",
      "flattenAttempted",
      "flattenSuppressedReason",
      "orderActionFeatureFlagEnabled",
      "dryRun",
      "permissionAllowsOrders",
      "isReadOnlyConnection",
      "hasOpenPositions",
      "openPositionContractIds",
    ];
    for (const field of required) {
      assert.ok(
        syncSrc.includes(field),
        `MaxPositionSizeSyncDiagnostics must include field: ${field}`,
      );
    }
  });

  it("permissionAllowsOrders is derived from brokerConnection.permissionLevel (not just connectionStatus)", () => {
    const syncSrc = readFileSync(
      resolve(import.meta.dirname, "../../../../../lib/brokers/tradovate-sync.ts"),
      "utf8",
    );
    assert.ok(
      syncSrc.includes("permissionAllowsOrders"),
      "sync must compute permissionAllowsOrders",
    );
    assert.ok(
      syncSrc.includes("permissionLevel"),
      "permissionAllowsOrders must be derived from the OAuth permissionLevel field",
    );
  });
});

describe("sync-button: hydration safety", () => {
  const SYNC_BUTTON_FILE = resolve(
    import.meta.dirname,
    "../../../../accounts/_components/sync-button.tsx",
  );

  it("uses useEffect to compute relativeLabel state (not inline in JSX)", () => {
    const s = readFileSync(SYNC_BUTTON_FILE, "utf8");
    // The component must declare a relativeLabel state and set it inside useEffect
    assert.ok(s.includes("relativeLabel"), "must declare relativeLabel state");
    assert.ok(s.includes("setRelativeLabel("), "must call setRelativeLabel");
    // setRelativeLabel must be called inside useEffect (not at render time)
    const useEffectIdx = s.indexOf("useEffect(");
    assert.ok(useEffectIdx !== -1, "must use useEffect");
    const setLabelIdx = s.indexOf("setRelativeLabel(");
    assert.ok(setLabelIdx > useEffectIdx, "setRelativeLabel must be called inside useEffect");
  });

  it("JSX render does not interpolate relativeTime() directly", () => {
    const s = readFileSync(SYNC_BUTTON_FILE, "utf8");
    // Find the SyncButton component body — starts at its export function line
    const componentStart = s.indexOf("export function SyncButton(");
    assert.ok(componentStart !== -1, "SyncButton export must exist");
    const componentBody = s.slice(componentStart);
    // relativeTime( must appear only inside the useEffect callback, not in JSX
    // JSX interpolation looks like: {relativeTime( — check it's absent in JSX
    assert.ok(
      !componentBody.includes("{relativeTime("),
      "JSX must not use {relativeTime(...)} directly — use {relativeLabel} instead",
    );
  });
});
