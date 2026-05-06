import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  shouldSkipRefresh,
  clampRefreshInterval,
  DASHBOARD_AUTO_REFRESH_MIN_MS,
} from "../../../lib/sync-freshness.ts";

// ── shouldSkipRefresh ─────────────────────────────────────────────────────────

describe("shouldSkipRefresh", () => {
  it("tab hidden → skip (user switched away)", () => {
    assert.equal(shouldSkipRefresh(true, false), true);
  });

  it("request in flight → skip (prevent overlap)", () => {
    assert.equal(shouldSkipRefresh(false, true), true);
  });

  it("both hidden and in flight → skip", () => {
    assert.equal(shouldSkipRefresh(true, true), true);
  });

  it("tab visible and no request in flight → proceed", () => {
    assert.equal(shouldSkipRefresh(false, false), false);
  });
});

// ── clampRefreshInterval ──────────────────────────────────────────────────────

describe("clampRefreshInterval", () => {
  it("value below minimum is clamped to the minimum", () => {
    assert.equal(clampRefreshInterval(5_000), DASHBOARD_AUTO_REFRESH_MIN_MS);
  });

  it("value at minimum is unchanged", () => {
    assert.equal(clampRefreshInterval(DASHBOARD_AUTO_REFRESH_MIN_MS), DASHBOARD_AUTO_REFRESH_MIN_MS);
  });

  it("value above minimum is unchanged", () => {
    assert.equal(clampRefreshInterval(30_000), 30_000);
  });

  it("NaN falls back to minMs", () => {
    assert.equal(clampRefreshInterval(NaN), DASHBOARD_AUTO_REFRESH_MIN_MS);
  });

  it("Infinity falls back to minMs (not a valid interval)", () => {
    assert.equal(clampRefreshInterval(Infinity), DASHBOARD_AUTO_REFRESH_MIN_MS);
  });

  it("zero falls back to minMs", () => {
    assert.equal(clampRefreshInterval(0), DASHBOARD_AUTO_REFRESH_MIN_MS);
  });

  it("negative value falls back to minMs", () => {
    assert.equal(clampRefreshInterval(-1_000), DASHBOARD_AUTO_REFRESH_MIN_MS);
  });

  it("custom minMs is respected", () => {
    assert.equal(clampRefreshInterval(10_000, 20_000), 20_000);
    assert.equal(clampRefreshInterval(30_000, 20_000), 30_000);
  });
});
