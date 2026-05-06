import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mapConnectionStatus,
  mapOutcome,
  mapRiskState,
  CONNECTION_STATUS_LABEL,
  OUTCOME_LABEL,
  RISK_STATE_LABEL,
} from "./diagnostics-helpers.ts";

const FORBIDDEN = ["read_only", "connected_readonly", "monitoring_only", "dry_run", "READ-ONLY"];

// ── mapConnectionStatus ───────────────────────────────────────────────────────

describe("mapConnectionStatus", () => {
  it("connected_live → 'Connected'", () => {
    assert.equal(mapConnectionStatus("connected_live"), "Connected");
  });

  it("connected_readonly → 'Connected' (no raw enum leaked)", () => {
    assert.equal(mapConnectionStatus("connected_readonly"), "Connected");
  });

  it("pending_webhook → 'Pending sync'", () => {
    assert.equal(mapConnectionStatus("pending_webhook"), "Pending sync");
  });

  it("connection_error → 'Connection error'", () => {
    assert.equal(mapConnectionStatus("connection_error"), "Connection error");
  });

  it("unknown value falls back to spaced version", () => {
    assert.equal(mapConnectionStatus("some_unknown_status"), "some unknown status");
  });

  it("no label in CONNECTION_STATUS_LABEL contains a raw enum string", () => {
    for (const [key, label] of Object.entries(CONNECTION_STATUS_LABEL)) {
      for (const forbidden of FORBIDDEN) {
        assert.ok(
          !label.toLowerCase().includes(forbidden.toLowerCase()),
          `CONNECTION_STATUS_LABEL['${key}'] must not contain '${forbidden}': ${label}`,
        );
      }
    }
  });
});

// ── mapOutcome ────────────────────────────────────────────────────────────────

describe("mapOutcome", () => {
  it("stop → 'Stopped'", () => {
    assert.equal(mapOutcome("stop"), "Stopped");
  });

  it("cooldown → 'Cooldown'", () => {
    assert.equal(mapOutcome("cooldown"), "Cooldown");
  });

  it("warning → 'Warning'", () => {
    assert.equal(mapOutcome("warning"), "Warning");
  });

  it("skipped → 'Skipped'", () => {
    assert.equal(mapOutcome("skipped"), "Skipped");
  });

  it("unknown value falls back to spaced version", () => {
    assert.equal(mapOutcome("some_new_outcome"), "some new outcome");
  });

  it("no label in OUTCOME_LABEL contains a raw underscore enum", () => {
    for (const [key, label] of Object.entries(OUTCOME_LABEL)) {
      assert.ok(
        !label.includes("_"),
        `OUTCOME_LABEL['${key}'] must not contain underscores: ${label}`,
      );
    }
  });
});

// ── mapRiskState ──────────────────────────────────────────────────────────────

describe("mapRiskState", () => {
  it("NORMAL → 'Normal'", () => {
    assert.equal(mapRiskState("NORMAL"), "Normal");
  });

  it("WARNING → 'Warning'", () => {
    assert.equal(mapRiskState("WARNING"), "Warning");
  });

  it("STOPPED → 'Stopped'", () => {
    assert.equal(mapRiskState("STOPPED"), "Stopped");
  });

  it("unknown value passed through unchanged", () => {
    assert.equal(mapRiskState("UNKNOWN_STATE"), "UNKNOWN_STATE");
  });

  it("each risk state maps to a distinct label", () => {
    const labels = Object.values(RISK_STATE_LABEL);
    const unique = new Set(labels);
    assert.equal(unique.size, labels.length, "each riskState must map to a unique label");
  });
});

// ── Regression: no forbidden raw strings in any label map ────────────────────

describe("regression: no raw enum strings in any diagnostics label", () => {
  const allLabels = [
    ...Object.values(CONNECTION_STATUS_LABEL),
    ...Object.values(OUTCOME_LABEL),
    ...Object.values(RISK_STATE_LABEL),
  ];

  it("no label renders 'read_only' or similar raw DB enum", () => {
    for (const label of allLabels) {
      for (const forbidden of FORBIDDEN) {
        assert.ok(
          !label.toLowerCase().includes(forbidden.toLowerCase()),
          `A diagnostics label must not contain '${forbidden}': "${label}"`,
        );
      }
    }
  });

  it("no label renders 'Guardian' (old product term)", () => {
    for (const label of allLabels) {
      assert.ok(
        !label.toLowerCase().includes("guardian"),
        `A diagnostics label must not say 'Guardian': "${label}"`,
      );
    }
  });
});
