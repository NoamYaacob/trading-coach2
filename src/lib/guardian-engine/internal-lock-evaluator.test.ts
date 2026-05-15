/**
 * Phase 2B: unit tests for the pure internal-lock gate logic.
 *
 * Safety properties verified:
 *   - Flag=false  → lock never applied (feature flag gate)
 *   - env=live    → lock never applied (demo-only gate)
 *   - STOPPED     → lock not re-applied (idempotent gate)
 *   - All three gates must pass simultaneously
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canApplyInternalLock } from "./internal-lock-evaluator.ts";

describe("canApplyInternalLock", () => {
  it("returns true when all gates pass", () => {
    assert.equal(canApplyInternalLock({ flagEnabled: true, env: "demo", riskState: "NORMAL" }), true);
  });

  it("returns true for WARNING state (not yet locked)", () => {
    assert.equal(canApplyInternalLock({ flagEnabled: true, env: "demo", riskState: "WARNING" }), true);
  });

  // ── Feature flag gate ──────────────────────────────────────────────────────

  it("returns false when flag is disabled", () => {
    assert.equal(canApplyInternalLock({ flagEnabled: false, env: "demo", riskState: "NORMAL" }), false);
  });

  it("flag=false overrides demo env and NORMAL state", () => {
    assert.equal(canApplyInternalLock({ flagEnabled: false, env: "demo", riskState: "NORMAL" }), false);
  });

  // ── Demo-only gate ─────────────────────────────────────────────────────────

  it("returns false for live accounts", () => {
    assert.equal(canApplyInternalLock({ flagEnabled: true, env: "live", riskState: "NORMAL" }), false);
  });

  it("returns false for live even when flag=true and NORMAL", () => {
    assert.equal(canApplyInternalLock({ flagEnabled: true, env: "live", riskState: "NORMAL" }), false);
  });

  it("returns false for unknown env", () => {
    assert.equal(canApplyInternalLock({ flagEnabled: true, env: "staging", riskState: "NORMAL" }), false);
  });

  // ── Idempotent gate ────────────────────────────────────────────────────────

  it("returns false when already STOPPED", () => {
    assert.equal(canApplyInternalLock({ flagEnabled: true, env: "demo", riskState: "STOPPED" }), false);
  });

  it("STOPPED gate overrides — not re-locked even with all other gates passing", () => {
    assert.equal(canApplyInternalLock({ flagEnabled: true, env: "demo", riskState: "STOPPED" }), false);
  });

  // ── Combined gate interactions ─────────────────────────────────────────────

  it("flag=false + live + STOPPED → false", () => {
    assert.equal(canApplyInternalLock({ flagEnabled: false, env: "live", riskState: "STOPPED" }), false);
  });

  it("flag=true + live + STOPPED → false", () => {
    assert.equal(canApplyInternalLock({ flagEnabled: true, env: "live", riskState: "STOPPED" }), false);
  });
});
