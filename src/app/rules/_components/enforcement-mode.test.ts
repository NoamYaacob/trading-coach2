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

describe("computeEnforcementMode — capability-driven copy (no Protection test mode override)", () => {
  it("full_access account never returns 'Protection test mode' or 'No broker actions are sent'", () => {
    const result = computeEnforcementMode(
      tradovateAccount("connected_live", "full_access"),
      false,
    );
    assert.ok(!result.label.includes("Protection test mode"), `label leak: ${result.label}`);
    assert.ok(!result.detail.includes("Protection test mode"), `detail leak: ${result.detail}`);
    assert.ok(!result.detail.includes("No broker actions are sent"), `detail leak: ${result.detail}`);
    assert.ok(
      !result.detail.includes("broker actions are simulated"),
      `detail leak: ${result.detail}`,
    );
    assert.ok(!result.detail.includes("Tradovate writes are sent"), `detail leak: ${result.detail}`);
  });

  it("default template never returns 'Protection test mode'", () => {
    const withFullAccess = computeEnforcementMode(null, true, { hasFullAccessAccount: true });
    const withoutFullAccess = computeEnforcementMode(null, true, { hasFullAccessAccount: false });
    for (const result of [withFullAccess, withoutFullAccess]) {
      assert.ok(!result.label.includes("Protection test mode"));
      assert.ok(!result.detail.includes("Protection test mode"));
      assert.ok(!result.detail.includes("No broker actions are sent"));
    }
  });
});

describe("computeEnforcementMode — default template", () => {
  it("hasFullAccessAccount=true → 'Default template · Broker risk settings available'", () => {
    const result = computeEnforcementMode(null, true, { hasFullAccessAccount: true });
    assert.equal(result.mode, "monitoring_only");
    assert.equal(result.label, "Default template · Broker risk settings available");
    assert.ok(result.detail.includes("Rules are saved in Guardrail"));
    assert.ok(result.detail.includes("Account Risk Settings"));
  });

  it("hasFullAccessAccount=false → 'Default template · Guardrail rules'", () => {
    const result = computeEnforcementMode(null, true, { hasFullAccessAccount: false });
    assert.equal(result.mode, "monitoring_only");
    assert.equal(result.label, "Default template · Guardrail rules");
    assert.ok(result.detail.includes("Rules are saved in Guardrail"));
    assert.ok(result.detail.includes("Broker-side behavior depends on each account"));
  });

  it("default scope omits hasFullAccessAccount → conservative copy", () => {
    const result = computeEnforcementMode(null, true);
    assert.equal(result.label, "Default template · Guardrail rules");
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

  it("label says 'Broker risk settings enabled' for probed full_access", () => {
    const result = computeEnforcementMode(
      tradovateAccount("connected_live", "full_access"),
      false,
    );
    assert.equal(result.label, "Broker risk settings enabled");
  });

  it("upgrades label even when connection still labelled connected_readonly (probe overrides legacy status)", () => {
    const result = computeEnforcementMode(
      tradovateAccount("connected_readonly", "full_access"),
      false,
    );
    assert.equal(result.mode, "broker_enforcement_pending");
    assert.equal(result.label, "Broker risk settings enabled");
  });

  it("detail uses the concise capability copy", () => {
    const result = computeEnforcementMode(
      tradovateAccount("connected_live", "full_access"),
      false,
    );
    assert.equal(
      result.detail,
      "Daily loss and profit target can trigger Tradovate risk settings on breach. " +
        "Other rules are enforced by Guardrail. Order actions are not enabled yet.",
    );
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
