import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { computeEnforcementMode } from "./enforcement-mode.ts";

const tradovateAccount = (connStatus: string) => ({
  platform: "tradovate",
  brokerConnectionId: "conn-1",
  brokerConnection: { platform: "tradovate", connectionStatus: connStatus },
});

describe("computeEnforcementMode — default template", () => {
  it("returns monitoring_only mode for default scope", () => {
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
    const result = computeEnforcementMode(
      { platform: "tradovate", brokerConnectionId: "conn-1", brokerConnection: { platform: "tradovate", connectionStatus: "expired" } },
      false,
    );
    assert.equal(result.mode, "monitoring_only");
  });

  it("label says 'Unavailable — reconnect required' for expired connection", () => {
    const result = computeEnforcementMode(
      { platform: "tradovate", brokerConnectionId: "conn-1", brokerConnection: { platform: "tradovate", connectionStatus: "expired" } },
      false,
    );
    assert.equal(result.label, "Unavailable — reconnect required");
  });

  it("label says 'Unavailable — reconnect required' for connection_error", () => {
    const result = computeEnforcementMode(
      { platform: "tradovate", brokerConnectionId: "conn-1", brokerConnection: { platform: "tradovate", connectionStatus: "connection_error" } },
      false,
    );
    assert.equal(result.label, "Unavailable — reconnect required");
  });
});

describe("computeEnforcementMode — Tradovate read-only", () => {
  it("returns monitoring_only for connected_readonly", () => {
    const result = computeEnforcementMode(tradovateAccount("connected_readonly"), false);
    assert.equal(result.mode, "monitoring_only");
  });

  it("label says 'Limited permissions — alerts only'", () => {
    const result = computeEnforcementMode(tradovateAccount("connected_readonly"), false);
    assert.equal(result.label, "Limited permissions — alerts only");
  });

  it("detail explains re-authorize path", () => {
    const result = computeEnforcementMode(tradovateAccount("connected_readonly"), false);
    assert.ok(result.detail.includes("re-authorize"));
  });
});

describe("computeEnforcementMode — Tradovate full access", () => {
  it("returns broker_enforcement_pending for connected_live", () => {
    const result = computeEnforcementMode(tradovateAccount("connected_live"), false);
    assert.equal(result.mode, "broker_enforcement_pending");
  });

  it("label says 'Broker enforcement available' for connected_live", () => {
    const result = computeEnforcementMode(tradovateAccount("connected_live"), false);
    assert.equal(result.label, "Broker enforcement available");
  });

  it("detail mentions daily loss limit and daily profit target", () => {
    const result = computeEnforcementMode(tradovateAccount("connected_live"), false);
    assert.ok(result.detail.includes("daily loss limit or daily profit target"));
  });

  it("detail explains trade-count limits are alert-only", () => {
    const result = computeEnforcementMode(tradovateAccount("connected_live"), false);
    assert.ok(result.detail.includes("alert-only"));
  });
});

describe("computeEnforcementMode — non-Tradovate platform", () => {
  it("returns monitoring_only for non-Tradovate connected account", () => {
    const result = computeEnforcementMode(
      { platform: "tradingview", brokerConnectionId: "conn-2", brokerConnection: { platform: "tradingview", connectionStatus: "connected_live" } },
      false,
    );
    assert.equal(result.mode, "monitoring_only");
    assert.equal(result.label, "Monitoring only");
  });

  it("detail says broker-side blocking is not active for the platform", () => {
    const result = computeEnforcementMode(
      { platform: "manual", brokerConnectionId: "conn-3", brokerConnection: { platform: "manual", connectionStatus: "connected_live" } },
      false,
    );
    assert.ok(result.detail.includes("Broker-side blocking is not active for this platform"));
  });
});
