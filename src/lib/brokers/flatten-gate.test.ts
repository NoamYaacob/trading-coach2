/**
 * Source-audit tests for the four-gate flatten eligibility model.
 *
 * The flatten gate in tradovate-sync.ts has exactly four ordered checks:
 *   1. ENFORCEMENT_DRY_RUN       → flattenSuppressedReason: "enforcement_dry_run"
 *   2. ENABLE_TRADOVATE_ORDER_ACTIONS → "feature_flag_disabled"
 *   3. permissionAllowsOrders    → "permission_read_only"  (token permission, NOT connectionStatus)
 *   4. consentGranted            → "consent_required"
 *
 * connectionStatus (connected_readonly / connected_live) is NEVER a flatten gate:
 * it tracks webhook liveness, not order permissions.
 *
 * The debug endpoint (tradovate-position-limit) projects these same gates,
 * and its response includes all four as separate readable fields.
 *
 * Pure source-scan — no network, no DB.
 *
 * Run: npm run test:unit
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SYNC_SRC = readFileSync(resolve(import.meta.dirname, "./tradovate-sync.ts"), "utf8");
const DEBUG_SRC = readFileSync(
  resolve(import.meta.dirname, "../../app/api/debug/tradovate-position-limit/route.ts"),
  "utf8",
);

// ── Gate 1: ENFORCEMENT_DRY_RUN ───────────────────────────────────────────────

describe("flatten gate 1: ENFORCEMENT_DRY_RUN (syncDryRun)", () => {
  it("sync checks syncDryRun as the FIRST gate in the if/else chain", () => {
    const wantsFlattenIdx = SYNC_SRC.indexOf("if (wantsFlatten)");
    assert.ok(wantsFlattenIdx !== -1);
    const chain = SYNC_SRC.slice(wantsFlattenIdx);
    const dryRunIdx = chain.indexOf("if (syncDryRun)");
    const flagIdx = chain.indexOf("!orderActionFeatureFlagEnabled");
    assert.ok(dryRunIdx !== -1, "syncDryRun must be checked");
    assert.ok(dryRunIdx < flagIdx, "syncDryRun must be the first gate");
  });

  it("sets flattenSuppressedReason=enforcement_dry_run", () => {
    assert.ok(SYNC_SRC.includes('"enforcement_dry_run"'));
  });

  it("debug computedDryRun is exposed in response", () => {
    assert.ok(
      DEBUG_SRC.includes("computedDryRun"),
      "debug must expose computedDryRun",
    );
  });

  it("debug uses isEnforcementDryRun() to compute dryRun gate", () => {
    assert.ok(
      DEBUG_SRC.includes("isEnforcementDryRun()"),
      "debug route must call isEnforcementDryRun()",
    );
  });
});

// ── Gate 2: ENABLE_TRADOVATE_ORDER_ACTIONS ────────────────────────────────────

describe("flatten gate 2: ENABLE_TRADOVATE_ORDER_ACTIONS feature flag", () => {
  it("sync checks !orderActionFeatureFlagEnabled as second gate", () => {
    const wantsFlattenIdx = SYNC_SRC.indexOf("if (wantsFlatten)");
    const chain = SYNC_SRC.slice(wantsFlattenIdx);
    const flagIdx = chain.indexOf("!orderActionFeatureFlagEnabled");
    const permIdx = chain.indexOf("!permissionAllowsOrders");
    assert.ok(flagIdx !== -1, "feature flag check must exist");
    assert.ok(permIdx !== -1, "permission check must exist");
    assert.ok(flagIdx < permIdx, "feature flag must be second gate (before permission)");
  });

  it("sets flattenSuppressedReason=feature_flag_disabled", () => {
    assert.ok(SYNC_SRC.includes('"feature_flag_disabled"'));
  });

  it("debug orderActionFeatureFlagEnabled is exposed in response", () => {
    assert.ok(
      DEBUG_SRC.includes("orderActionFeatureFlagEnabled"),
      "debug must expose orderActionFeatureFlagEnabled",
    );
  });

  it("isTradovateOrderActionsEnabled reads ENABLE_TRADOVATE_ORDER_ACTIONS env var", () => {
    const flagSrc = readFileSync(resolve(import.meta.dirname, "./order-actions-flag.ts"), "utf8");
    assert.ok(
      flagSrc.includes("ENABLE_TRADOVATE_ORDER_ACTIONS"),
      "flag module must read ENABLE_TRADOVATE_ORDER_ACTIONS",
    );
    assert.ok(
      flagSrc.includes('=== "true"'),
      "flag must compare to the string true",
    );
  });
});

// ── Gate 3: permissionAllowsOrders (token permission, NOT connectionStatus) ────

describe("flatten gate 3: permissionAllowsOrders (OAuth token permission)", () => {
  it("sync uses !permissionAllowsOrders as the third gate, NOT isReadOnlyConnection", () => {
    const wantsFlattenIdx = SYNC_SRC.indexOf("if (wantsFlatten)");
    const chain = SYNC_SRC.slice(wantsFlattenIdx, wantsFlattenIdx + 1500);
    // Must have permission gate
    assert.ok(
      chain.includes("!permissionAllowsOrders"),
      "flatten gate must use !permissionAllowsOrders",
    );
    // isReadOnlyConnection must NOT appear as a gate (only as informational field)
    // It may appear elsewhere in sync as a diagnostic field, but NOT inside the wantsFlatten chain
    const chainAfterPermGate = chain.slice(chain.indexOf("!permissionAllowsOrders"));
    assert.ok(
      !chainAfterPermGate.slice(0, 200).includes("} else if (isReadOnlyConnection)"),
      "isReadOnlyConnection must NOT be an else-if gate in the flatten chain",
    );
  });

  it("permissionAllowsOrders is derived from permissionLevel !== read_only (not connectionStatus)", () => {
    assert.ok(
      SYNC_SRC.includes("permissionAllowsOrders"),
      "sync must compute permissionAllowsOrders",
    );
    // The derivation must reference permissionLevel, not connectionStatus
    const permDerivationIdx = SYNC_SRC.indexOf("permissionAllowsOrders =");
    const permDerivation = SYNC_SRC.slice(permDerivationIdx, permDerivationIdx + 120);
    assert.ok(
      permDerivation.includes("permissionLevel"),
      "permissionAllowsOrders must be derived from permissionLevel",
    );
    assert.ok(
      !permDerivation.includes("connectionStatus"),
      "permissionAllowsOrders must NOT be derived from connectionStatus",
    );
  });

  it("sets flattenSuppressedReason=permission_read_only (not read_only_connection)", () => {
    assert.ok(
      SYNC_SRC.includes('"permission_read_only"'),
      'must use "permission_read_only" for token-level read-only gate',
    );
    assert.ok(
      !SYNC_SRC.includes('"read_only_connection"'),
      '"read_only_connection" must not appear — connectionStatus is not the permission gate',
    );
  });

  it("debug permissionLevelNow and permissionAllowsOrders are separate response fields", () => {
    assert.ok(
      DEBUG_SRC.includes("permissionLevelNow"),
      "debug must expose permissionLevelNow (the raw DB value)",
    );
    assert.ok(
      DEBUG_SRC.includes("permissionAllowsOrders"),
      "debug must expose permissionAllowsOrders (the computed gate result)",
    );
  });

  it("debug connectionStatusNow is exposed separately from permissionAllowsOrders", () => {
    assert.ok(
      DEBUG_SRC.includes("connectionStatusNow"),
      "debug must expose connectionStatusNow (webhook liveness — informational only)",
    );
  });

  it("debug flat gate does NOT use isReadOnlyConnection as a condition", () => {
    const projIdx = DEBUG_SRC.indexOf("projectedFlattenWouldBeAttempted =");
    assert.ok(projIdx !== -1, "projectedFlattenWouldBeAttempted must be computed");
    const projExpr = DEBUG_SRC.slice(projIdx, projIdx + 300);
    assert.ok(
      !projExpr.includes("isReadOnlyConnection"),
      "projectedFlattenWouldBeAttempted must not use isReadOnlyConnection",
    );
    assert.ok(
      projExpr.includes("permissionAllowsOrders"),
      "projectedFlattenWouldBeAttempted must use permissionAllowsOrders",
    );
  });

  it("connected_readonly + full_access permissionLevel: gate uses permissionLevel not connectionStatus", () => {
    // Regression: previously isReadOnlyConnection (connectionStatus==="connected_readonly")
    // was used as the gate, blocking flatten even when permissionLevel==="full_access".
    // Now the gate is !permissionAllowsOrders (permissionLevel!=="read_only").
    // A "connected_readonly" account with "full_access" permissionLevel CAN flatten.
    const wantsFlattenIdx = SYNC_SRC.indexOf("if (wantsFlatten)");
    const chain = SYNC_SRC.slice(wantsFlattenIdx, wantsFlattenIdx + 1500);
    assert.ok(
      !chain.includes("} else if (isReadOnlyConnection)"),
      "flatten chain must not gate on isReadOnlyConnection (that was the bug)",
    );
    assert.ok(
      chain.includes("!permissionAllowsOrders"),
      "flatten chain must gate on !permissionAllowsOrders instead",
    );
  });
});

// ── Gate 4: userConsentGranted / consentGranted ───────────────────────────────

describe("flatten gate 4: consent (automated-action consent)", () => {
  it("sync checks !consentGranted as the fourth gate", () => {
    const wantsFlattenIdx = SYNC_SRC.indexOf("if (wantsFlatten)");
    const chain = SYNC_SRC.slice(wantsFlattenIdx);
    const permIdx = chain.indexOf("!permissionAllowsOrders");
    const consentIdx = chain.indexOf("!consentGranted");
    assert.ok(permIdx !== -1, "permission gate must exist");
    assert.ok(consentIdx !== -1, "consent gate must exist");
    assert.ok(permIdx < consentIdx, "consent gate must come after permission gate");
  });

  it("sets flattenSuppressedReason=consent_required", () => {
    assert.ok(
      SYNC_SRC.includes('"consent_required"'),
      'must set flattenSuppressedReason to "consent_required"',
    );
  });

  it("consentGranted is derived using decideConsentGate", () => {
    assert.ok(
      SYNC_SRC.includes("decideConsentGate("),
      "sync must call decideConsentGate() to compute consentGranted",
    );
  });

  it("sync queries automatedActionsConsent fields from DB", () => {
    assert.ok(
      SYNC_SRC.includes("automatedActionsConsentAt"),
      "sync must select automatedActionsConsentAt from DB",
    );
    assert.ok(
      SYNC_SRC.includes("automatedActionsConsentVersion"),
      "sync must select automatedActionsConsentVersion from DB",
    );
  });

  it("consentGranted is in MaxPositionSizeSyncDiagnostics return value", () => {
    assert.ok(
      SYNC_SRC.includes("consentGranted,"),
      "consentGranted must be included in the diagnostics return",
    );
  });

  it("debug userConsentGranted is exposed in response", () => {
    assert.ok(
      DEBUG_SRC.includes("userConsentGranted"),
      "debug must expose userConsentGranted",
    );
  });
});

// ── Debug endpoint: finalFlattenEligibility ───────────────────────────────────

describe("debug endpoint: finalFlattenEligibility summary field", () => {
  it("exposes finalFlattenEligibility in response", () => {
    assert.ok(
      DEBUG_SRC.includes("finalFlattenEligibility"),
      "debug must expose finalFlattenEligibility",
    );
  });

  it("finalFlattenEligibility is eligible when all gates pass", () => {
    assert.ok(
      DEBUG_SRC.includes('"eligible"'),
      'finalFlattenEligibility must be "eligible" when projectedFlattenWouldBeAttempted',
    );
  });

  it("flattenBlockedReason uses permission_read_only not read_only_connection", () => {
    assert.ok(
      DEBUG_SRC.includes('"permission_read_only"'),
      'debug flattenBlockedReason must use "permission_read_only"',
    );
    assert.ok(
      !DEBUG_SRC.includes('"read_only_connection"'),
      '"read_only_connection" must not appear in debug route',
    );
  });

  it("flattenBlockedReason enforcement_dry_run is first in the if chain", () => {
    const blockedReasonIdx = DEBUG_SRC.indexOf("flattenBlockedReason =");
    assert.ok(blockedReasonIdx !== -1);
    const blockedReasonBlock = DEBUG_SRC.slice(blockedReasonIdx, blockedReasonIdx + 600);
    const dryRunPos = blockedReasonBlock.indexOf('"enforcement_dry_run"');
    const flagPos = blockedReasonBlock.indexOf('"feature_flag_disabled"');
    assert.ok(dryRunPos !== -1, "enforcement_dry_run reason must exist");
    assert.ok(flagPos !== -1, "feature_flag_disabled reason must exist");
    assert.ok(dryRunPos < flagPos, "enforcement_dry_run must appear before feature_flag_disabled");
  });
});

// ── Flatten uses position.id, not contractId or symbol ───────────────────────

describe("flatten payload: uses Tradovate position.id not contractId or symbol", () => {
  it("buildLiquidatePositionsPayload takes positionIds (position row IDs)", () => {
    const helpersSrc = readFileSync(resolve(import.meta.dirname, "./enforcement-helpers.ts"), "utf8");
    const fnIdx = helpersSrc.indexOf("buildLiquidatePositionsPayload(");
    assert.ok(fnIdx !== -1, "buildLiquidatePositionsPayload must be defined");
    const fnBody = helpersSrc.slice(fnIdx, fnIdx + 200);
    assert.ok(
      fnBody.includes("positionIds"),
      "function parameter must be positionIds (Tradovate position row IDs)",
    );
  });

  it("applyFlattenOpenPositions uses position.id, not contractId, for the payload", () => {
    const clientSrc = readFileSync(resolve(import.meta.dirname, "./tradovate-client.ts"), "utf8");
    const flattenIdx = clientSrc.indexOf("async applyFlattenOpenPositions()");
    assert.ok(flattenIdx !== -1);
    // Use a large slice (2000 chars) to cover the full method body.
    const flattenBody = clientSrc.slice(flattenIdx, flattenIdx + 2000);
    // positionIds is built from p.id (the Tradovate position row ID, not contractId).
    assert.ok(
      flattenBody.includes("openPositions.map((p) => p.id)"),
      "flatten must use p.id (position row ID) for the liquidatepositions payload",
    );
    // buildLiquidatePositionsPayload must receive positionIds, not contractIds.
    assert.ok(
      flattenBody.includes("buildLiquidatePositionsPayload(positionIds)"),
      "buildLiquidatePositionsPayload must be called with positionIds (not contractIds)",
    );
  });
});

// ── Token safety ──────────────────────────────────────────────────────────────

describe("flatten gate: no token values logged", () => {
  it("tradovate-sync.ts does not log accessToken in the flatten or sync path", () => {
    assert.ok(!SYNC_SRC.includes("accessToken"), "sync must never log accessToken");
    assert.ok(!SYNC_SRC.includes("refreshToken"), "sync must never log refreshToken");
  });

  it("debug route does not expose accessToken", () => {
    assert.ok(!DEBUG_SRC.includes("accessToken"), "debug route must not expose accessToken");
    assert.ok(!DEBUG_SRC.includes("refreshToken"), "debug route must not expose refreshToken");
  });
});
