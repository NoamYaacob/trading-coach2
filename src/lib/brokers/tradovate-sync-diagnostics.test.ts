/**
 * Source-audit tests for max_position_size enforcement diagnostics in the sync.
 *
 * Verifies structural properties of:
 *   - tradovate-sync.ts (SyncResult diagnostic fields, pre-flatten gates)
 *   - api/accounts/[id]/sync/route.ts (exposes maxPositionSize in response)
 *   - api/debug/tradovate-position-limit/route.ts (currentRiskState, projected fields)
 *
 * Pure source-scan — no network, no DB, no TradovateClient required.
 *
 * Run: npm run test:unit
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SYNC_SRC = readFileSync(resolve(import.meta.dirname, "./tradovate-sync.ts"), "utf8");
const SYNC_ROUTE_SRC = readFileSync(
  resolve(import.meta.dirname, "../../app/api/accounts/[id]/sync/route.ts"),
  "utf8",
);
const DEBUG_ROUTE_SRC = readFileSync(
  resolve(import.meta.dirname, "../../app/api/debug/tradovate-position-limit/route.ts"),
  "utf8",
);

// ── SyncResult type ────────────────────────────────────────────────────────────

describe("tradovate-sync: MaxPositionSizeSyncDiagnostics type is exported", () => {
  it("exports MaxPositionSizeSyncDiagnostics type", () => {
    assert.ok(
      SYNC_SRC.includes("MaxPositionSizeSyncDiagnostics"),
      "tradovate-sync.ts must export MaxPositionSizeSyncDiagnostics type",
    );
  });

  it("SyncResult includes maxPositionSize field", () => {
    assert.ok(
      SYNC_SRC.includes("maxPositionSize: MaxPositionSizeSyncDiagnostics | null"),
      "SyncResult must include maxPositionSize: MaxPositionSizeSyncDiagnostics | null",
    );
  });

  it("diagnostic type includes riskStateAtSyncStart and riskStateAtSyncEnd", () => {
    assert.ok(
      SYNC_SRC.includes("riskStateAtSyncStart"),
      "MaxPositionSizeSyncDiagnostics must include riskStateAtSyncStart",
    );
    assert.ok(
      SYNC_SRC.includes("riskStateAtSyncEnd"),
      "MaxPositionSizeSyncDiagnostics must include riskStateAtSyncEnd",
    );
  });

  it("diagnostic type includes violationCreated and violationSuppressedReason", () => {
    assert.ok(SYNC_SRC.includes("violationCreated"), "must include violationCreated");
    assert.ok(SYNC_SRC.includes("violationSuppressedReason"), "must include violationSuppressedReason");
  });

  it("diagnostic type includes flattenAttempted and flattenSuppressedReason", () => {
    assert.ok(SYNC_SRC.includes("flattenAttempted"), "must include flattenAttempted");
    assert.ok(SYNC_SRC.includes("flattenSuppressedReason"), "must include flattenSuppressedReason");
  });

  it("diagnostic type includes orderActionFeatureFlagEnabled", () => {
    assert.ok(
      SYNC_SRC.includes("orderActionFeatureFlagEnabled"),
      "must include orderActionFeatureFlagEnabled",
    );
  });

  it("diagnostic type includes openPositionContractIds (numeric IDs)", () => {
    assert.ok(
      SYNC_SRC.includes("openPositionContractIds"),
      "must include openPositionContractIds for traceability",
    );
  });

  it("diagnostic type includes flattenResult with status and message", () => {
    assert.ok(
      SYNC_SRC.includes("flattenResult"),
      "must include flattenResult",
    );
  });
});

// ── NORMAL → STOPPED transition tracking ──────────────────────────────────────

describe("tradovate-sync: NORMAL → STOPPED breach produces correct diagnostics", () => {
  it("riskStateAtSyncStart is captured from prevRiskState (before DB write)", () => {
    assert.ok(
      SYNC_SRC.includes("riskStateAtSyncStart: prevRiskState"),
      "riskStateAtSyncStart must be set from prevRiskState (the state before this sync ran)",
    );
  });

  it("riskStateAtSyncEnd is captured from newRiskState (after enforcement decision)", () => {
    assert.ok(
      SYNC_SRC.includes("riskStateAtSyncEnd: newRiskState"),
      "riskStateAtSyncEnd must be set from newRiskState",
    );
  });

  it("violationCreated is true only on NORMAL → STOPPED transition (maxPosRuleTriggered)", () => {
    assert.ok(
      SYNC_SRC.includes("maxPosViolationCreated = maxPosRuleTriggered && violationCreated"),
      "maxPosViolationCreated must be the conjunction of the rule trigger and the STOPPED transition",
    );
  });

  it("violationSuppressedReason is already_stopped when account was already STOPPED", () => {
    assert.ok(
      SYNC_SRC.includes('"already_stopped"'),
      "must set violationSuppressedReason to already_stopped for pre-stopped accounts",
    );
  });

  it("violationSuppressedReason is rule_not_triggered when exposure is within limit", () => {
    assert.ok(
      SYNC_SRC.includes('"rule_not_triggered"'),
      "must set violationSuppressedReason to rule_not_triggered when no breach",
    );
  });

  it("wouldBreach is null when maxContracts is not configured (effectiveMaxContracts=null)", () => {
    assert.ok(
      SYNC_SRC.includes("effectiveMaxContracts !== null ? maxPositionSizeDecision.shouldTrigger : null"),
      "wouldBreach must be null when maxContracts is not configured",
    );
  });
});

// ── Flatten gate ordering ──────────────────────────────────────────────────────

describe("tradovate-sync: flatten suppression gates have correct priority order", () => {
  it("ENFORCEMENT_DRY_RUN check precedes feature flag check in if/else chain", () => {
    // Find the if/else chain inside the wantsFlatten block.
    const wantsFlattenIdx = SYNC_SRC.indexOf("if (wantsFlatten)");
    assert.ok(wantsFlattenIdx !== -1, "wantsFlatten block must exist");
    const chainSection = SYNC_SRC.slice(wantsFlattenIdx);
    const dryRunIdx = chainSection.indexOf("if (syncDryRun)");
    const flagIdx = chainSection.indexOf("!orderActionFeatureFlagEnabled");
    assert.ok(dryRunIdx !== -1, "syncDryRun check must exist in the chain");
    assert.ok(flagIdx !== -1, "orderActionFeatureFlagEnabled check must exist in the chain");
    assert.ok(
      dryRunIdx < flagIdx,
      "enforcement dry-run check must precede ENABLE_TRADOVATE_ORDER_ACTIONS flag check",
    );
  });

  it("feature flag check precedes read-only connection check in if/else chain", () => {
    const wantsFlattenIdx = SYNC_SRC.indexOf("if (wantsFlatten)");
    assert.ok(wantsFlattenIdx !== -1, "wantsFlatten block must exist");
    const chainSection = SYNC_SRC.slice(wantsFlattenIdx);
    const flagIdx = chainSection.indexOf("!orderActionFeatureFlagEnabled");
    const readOnlyIdx = chainSection.indexOf("isReadOnlyConnection");
    assert.ok(flagIdx !== -1, "orderActionFeatureFlagEnabled check must exist in chain");
    assert.ok(readOnlyIdx !== -1, "isReadOnlyConnection check must exist in chain");
    assert.ok(
      flagIdx < readOnlyIdx,
      "ENABLE_TRADOVATE_ORDER_ACTIONS check must precede isReadOnlyConnection check",
    );
  });

  it("flattenSuppressedReason=enforcement_dry_run set when ENFORCEMENT_DRY_RUN=true", () => {
    assert.ok(
      SYNC_SRC.includes('"enforcement_dry_run"'),
      "must set flattenSuppressedReason to enforcement_dry_run",
    );
  });

  it("flattenSuppressedReason=feature_flag_disabled when ENABLE_TRADOVATE_ORDER_ACTIONS not set", () => {
    assert.ok(
      SYNC_SRC.includes('"feature_flag_disabled"'),
      "must set flattenSuppressedReason to feature_flag_disabled",
    );
  });

  it("flattenSuppressedReason=read_only_connection for connected_readonly", () => {
    assert.ok(
      SYNC_SRC.includes('"read_only_connection"'),
      "must set flattenSuppressedReason to read_only_connection",
    );
  });

  it("flattenSuppressedReason=no_open_positions when trigger fires but no positions", () => {
    assert.ok(
      SYNC_SRC.includes('"no_open_positions"'),
      "must set flattenSuppressedReason to no_open_positions",
    );
  });

  it("flattenAttemptedThisSync=true only when all gates pass (live path)", () => {
    assert.ok(
      SYNC_SRC.includes("flattenAttemptedThisSync = true"),
      "flattenAttemptedThisSync must be explicitly set true on the live flatten path",
    );
  });
});

// ── Flatten uses contractId, not contractName ──────────────────────────────────

describe("tradovate-sync: flatten uses Tradovate contractId as the key", () => {
  it("openPositionContractIds is built from contractId (numeric Tradovate ID)", () => {
    assert.ok(
      SYNC_SRC.includes("openPositionContractIds = nonZeroRaw.map((p) => p.contractId)"),
      "openPositionContractIds must be the numeric contractId from position/list, not a string symbol",
    );
  });

  it("positions are resolved via resolveContracts for symbol names (not used as flatten key)", () => {
    assert.ok(
      SYNC_SRC.includes("resolveContracts(uniqueIds)"),
      "contract resolution via resolveContracts must exist (used for symbol names, not flatten key)",
    );
  });
});

// ── isTradovateOrderActionsEnabled is imported ─────────────────────────────────

describe("tradovate-sync: imports isTradovateOrderActionsEnabled", () => {
  it("imports isTradovateOrderActionsEnabled from order-actions-flag", () => {
    assert.ok(
      SYNC_SRC.includes("isTradovateOrderActionsEnabled"),
      "sync must import and call isTradovateOrderActionsEnabled",
    );
  });
});

// ── Account sync route exposes maxPositionSize ─────────────────────────────────

describe("account sync route: exposes maxPositionSize diagnostics in response", () => {
  it("response includes maxPositionSize from result", () => {
    assert.ok(
      SYNC_ROUTE_SRC.includes("maxPositionSize: result.maxPositionSize"),
      "sync route must include maxPositionSize: result.maxPositionSize in the JSON response",
    );
  });
});

// ── Debug endpoint: renamed fields ────────────────────────────────────────────

describe("debug tradovate-position-limit: currentRiskState replaces riskStateBefore", () => {
  it("uses currentRiskState (not riskStateBefore) for the DB-read state", () => {
    assert.ok(
      DEBUG_ROUTE_SRC.includes("currentRiskState"),
      "debug endpoint must use currentRiskState to describe the current DB state",
    );
    assert.ok(
      !DEBUG_ROUTE_SRC.includes("riskStateBefore"),
      "debug endpoint must not use the old name riskStateBefore (rename to currentRiskState)",
    );
  });

  it("uses alreadyStoppedNow (not alreadyStopped) to show current stopped state", () => {
    assert.ok(
      DEBUG_ROUTE_SRC.includes("alreadyStoppedNow"),
      "debug endpoint must use alreadyStoppedNow",
    );
    assert.ok(
      !DEBUG_ROUTE_SRC.includes('"alreadyStopped"'),
      'debug endpoint must not use the old name alreadyStopped in the response JSON',
    );
  });

  it("projectedRiskStateAfterEvaluation replaces riskStateAfter", () => {
    assert.ok(
      DEBUG_ROUTE_SRC.includes("projectedRiskStateAfterEvaluation"),
      "debug endpoint must use projectedRiskStateAfterEvaluation to make clear it is a projection",
    );
    assert.ok(
      !DEBUG_ROUTE_SRC.includes("riskStateAfter"),
      "debug endpoint must not use the old name riskStateAfter",
    );
  });
});

describe("debug tradovate-position-limit: projected fields use projected prefix", () => {
  it("projectedRuleWouldTrigger replaces ruleTriggered", () => {
    assert.ok(
      DEBUG_ROUTE_SRC.includes("projectedRuleWouldTrigger"),
      "must use projectedRuleWouldTrigger",
    );
  });

  it("projectedViolationWouldBeCreated replaces violationCreated", () => {
    assert.ok(
      DEBUG_ROUTE_SRC.includes("projectedViolationWouldBeCreated"),
      "must use projectedViolationWouldBeCreated",
    );
  });

  it("projectedFlattenWouldBeAttempted replaces flattenAttempted", () => {
    assert.ok(
      DEBUG_ROUTE_SRC.includes("projectedFlattenWouldBeAttempted"),
      "must use projectedFlattenWouldBeAttempted",
    );
  });
});

describe("debug tradovate-position-limit: flattenBlockedReason exposes exact gate", () => {
  it("flattenBlockedReason is included in the response", () => {
    assert.ok(
      DEBUG_ROUTE_SRC.includes("flattenBlockedReason"),
      "debug endpoint must include flattenBlockedReason",
    );
  });

  it("feature_flag_disabled is a possible flattenBlockedReason", () => {
    assert.ok(
      DEBUG_ROUTE_SRC.includes('"feature_flag_disabled"'),
      "flattenBlockedReason must include feature_flag_disabled gate",
    );
  });

  it("read_only_connection is a possible flattenBlockedReason", () => {
    assert.ok(
      DEBUG_ROUTE_SRC.includes('"read_only_connection"'),
      "flattenBlockedReason must include read_only_connection gate",
    );
  });

  it("consent_missing is a possible flattenBlockedReason", () => {
    assert.ok(
      DEBUG_ROUTE_SRC.includes('"consent_missing"'),
      "flattenBlockedReason must include consent_missing gate",
    );
  });

  it("already_stopped is a possible flattenBlockedReason", () => {
    assert.ok(
      DEBUG_ROUTE_SRC.includes('"already_stopped"'),
      "flattenBlockedReason must include already_stopped gate",
    );
  });
});

describe("debug tradovate-position-limit: orderActionFeatureFlagEnabled is separate from consent", () => {
  it("orderActionFeatureFlagEnabled is included in the response (from isTradovateOrderActionsEnabled)", () => {
    assert.ok(
      DEBUG_ROUTE_SRC.includes("orderActionFeatureFlagEnabled"),
      "debug endpoint must include orderActionFeatureFlagEnabled (ENABLE_TRADOVATE_ORDER_ACTIONS flag)",
    );
  });

  it("consentGranted is included as the consent-gate field", () => {
    assert.ok(
      DEBUG_ROUTE_SRC.includes("consentGranted"),
      "debug endpoint must include consentGranted as the consent-gate field",
    );
  });
});

// ── No token logging ───────────────────────────────────────────────────────────

describe("tradovate-sync: no token fields in logs or diagnostics", () => {
  const FORBIDDEN = [
    "accessToken",
    "refreshToken",
    "tokenEncrypted",
    "accessTokenEncrypted",
    "refreshTokenEncrypted",
  ];

  for (const field of FORBIDDEN) {
    it(`sync must not reference token field '${field}'`, () => {
      assert.ok(
        !SYNC_SRC.includes(field),
        `tradovate-sync.ts must not log or expose token field: ${field}`,
      );
    });
  }
});
