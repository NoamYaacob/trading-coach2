import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { computeEnforcementMode } from "./enforcement-mode.ts";

const tradovateAccount = (
  connStatus: string,
  permissionLevel: string | null = null,
) => ({
  platform: "tradovate",
  brokerConnectionId: "conn-1",
  brokerConnection: {
    platform: "tradovate",
    connectionStatus: connStatus,
    permissionLevel,
  },
});

describe("computeEnforcementMode — dry-run override (user-facing 'Protection test mode')", () => {
  it("returns dry_run mode (internal enum) when isDryRun is true (default scope)", () => {
    const result = computeEnforcementMode(null, true, { isDryRun: true });
    assert.equal(result.mode, "dry_run");
    // Internal enum stays "dry_run"; user-facing label is "Protection test mode".
    assert.equal(result.label, "Protection test mode");
  });

  it("returns dry_run mode when isDryRun is true even with full permissions", () => {
    const result = computeEnforcementMode(
      tradovateAccount("connected_live", "full_access"),
      false,
      { isDryRun: true },
    );
    assert.equal(result.mode, "dry_run");
    assert.equal(result.label, "Protection test mode");
  });

  it("user-facing label does NOT use the technical phrase 'Dry run mode'", () => {
    const result = computeEnforcementMode(null, true, { isDryRun: true });
    assert.ok(
      !result.label.toLowerCase().includes("dry run"),
      `'Dry run' must not appear in user-facing label, got: ${result.label}`,
    );
  });

  it("dry-run detail uses 'Protection test mode:' prefix and mentions simulation", () => {
    const result = computeEnforcementMode(null, true, { isDryRun: true });
    assert.ok(
      result.detail.includes("Protection test mode"),
      `expected 'Protection test mode' in detail, got: ${result.detail}`,
    );
    assert.ok(result.detail.toLowerCase().includes("simulated"));
    assert.ok(result.detail.includes("No Tradovate write"));
  });
});

describe("computeEnforcementMode — default template", () => {
  it("returns monitoring_only mode for default scope (no dry-run)", () => {
    const result = computeEnforcementMode(null, true);
    assert.equal(result.mode, "monitoring_only");
  });

  it("label mentions 'Monitoring only' for default template", () => {
    const result = computeEnforcementMode(null, true);
    assert.ok(result.label.includes("Monitoring only"), `unexpected label: ${result.label}`);
  });

  it("detail explains broker actions require account-level rules", () => {
    const result = computeEnforcementMode(null, true);
    assert.ok(result.detail.includes("Broker actions require account-level rules"));
  });
});

describe("computeEnforcementMode — no account selected", () => {
  it("returns monitoring_only when account is null and isDefault is false", () => {
    const result = computeEnforcementMode(null, false);
    assert.equal(result.mode, "monitoring_only");
  });
});

describe("computeEnforcementMode — no broker connection", () => {
  it("returns monitoring_only when account has no broker connection", () => {
    const result = computeEnforcementMode(
      { platform: "tradovate", brokerConnectionId: null, brokerConnection: null },
      false,
    );
    assert.equal(result.mode, "monitoring_only");
    assert.ok(result.label.includes("No broker connected"));
  });
});

describe("computeEnforcementMode — expired/errored connection", () => {
  it("returns monitoring_only for expired connection", () => {
    const result = computeEnforcementMode(tradovateAccount("expired", "full_access"), false);
    assert.equal(result.mode, "monitoring_only");
  });

  it("label says 'Unavailable — reconnect required' for expired connection", () => {
    const result = computeEnforcementMode(tradovateAccount("expired"), false);
    assert.equal(result.label, "Unavailable — reconnect required");
  });

  it("label says 'Unavailable — reconnect required' for connection_error", () => {
    const result = computeEnforcementMode(tradovateAccount("connection_error"), false);
    assert.equal(result.label, "Unavailable — reconnect required");
  });
});

describe("computeEnforcementMode — Tradovate permission_level=read_only", () => {
  it("returns monitoring_only when permissionLevel is read_only", () => {
    const result = computeEnforcementMode(
      tradovateAccount("connected_live", "read_only"),
      false,
    );
    assert.equal(result.mode, "monitoring_only");
  });

  it("label says 'Limited permissions — alerts only' when probed as read_only", () => {
    const result = computeEnforcementMode(
      tradovateAccount("connected_live", "read_only"),
      false,
    );
    assert.equal(result.label, "Limited permissions — alerts only");
  });

  it("detail mentions Account Risk Settings: Full Access requirement", () => {
    const result = computeEnforcementMode(
      tradovateAccount("connected_readonly", "read_only"),
      false,
    );
    assert.ok(result.detail.includes("Account Risk Settings: Full Access"));
  });
});

describe("computeEnforcementMode — Tradovate permission_level=full_access", () => {
  it("returns broker_enforcement_pending when probed as full_access", () => {
    const result = computeEnforcementMode(
      tradovateAccount("connected_live", "full_access"),
      false,
    );
    assert.equal(result.mode, "broker_enforcement_pending");
  });

  it("label says 'Broker enforcement available' for probed full_access", () => {
    const result = computeEnforcementMode(
      tradovateAccount("connected_live", "full_access"),
      false,
    );
    assert.equal(result.label, "Broker enforcement available");
  });

  it("upgrades label even when connection still labelled connected_readonly (probe overrides legacy status)", () => {
    // This is the real-world bug case: the parent BrokerConnection.connectionStatus
    // never flipped from "connected_readonly" because that field is set by the OAuth
    // callback and only by the per-account webhook handler — not by the connection
    // itself. With the probe, we can correctly classify these accounts.
    const result = computeEnforcementMode(
      tradovateAccount("connected_readonly", "full_access"),
      false,
    );
    assert.equal(result.mode, "broker_enforcement_pending");
    assert.equal(result.label, "Broker enforcement available");
  });

  it("detail mentions daily loss limit and daily profit target", () => {
    const result = computeEnforcementMode(
      tradovateAccount("connected_live", "full_access"),
      false,
    );
    assert.ok(result.detail.includes("daily loss limit or daily profit target"));
  });
});

describe("computeEnforcementMode — Tradovate permission probe not yet run", () => {
  it("returns permission_unverified when permissionLevel is null", () => {
    const result = computeEnforcementMode(
      tradovateAccount("connected_live", null),
      false,
    );
    assert.equal(result.mode, "permission_unverified");
  });

  it("label says 'Permission level not yet verified'", () => {
    const result = computeEnforcementMode(
      tradovateAccount("connected_live", null),
      false,
    );
    assert.equal(result.label, "Permission level not yet verified");
  });

  it("detail explains the probe will run on next sync", () => {
    const result = computeEnforcementMode(
      tradovateAccount("connected_live", null),
      false,
    );
    assert.ok(result.detail.includes("next sync"));
  });

  it("returns permission_unverified when permissionLevel is unknown string", () => {
    const result = computeEnforcementMode(
      tradovateAccount("connected_readonly", "unknown"),
      false,
    );
    assert.equal(result.mode, "permission_unverified");
  });
});

describe("computeEnforcementMode — non-Tradovate platform", () => {
  it("returns monitoring_only for non-Tradovate connected account", () => {
    const result = computeEnforcementMode(
      {
        platform: "tradingview",
        brokerConnectionId: "conn-2",
        brokerConnection: {
          platform: "tradingview",
          connectionStatus: "connected_live",
          permissionLevel: null,
        },
      },
      false,
    );
    assert.equal(result.mode, "monitoring_only");
    assert.equal(result.label, "Monitoring only");
  });

  it("detail says broker-side blocking is not active for the platform", () => {
    const result = computeEnforcementMode(
      {
        platform: "manual",
        brokerConnectionId: "conn-3",
        brokerConnection: {
          platform: "manual",
          connectionStatus: "connected_live",
          permissionLevel: null,
        },
      },
      false,
    );
    assert.ok(result.detail.includes("Broker-side blocking is not active for this platform"));
  });
});
