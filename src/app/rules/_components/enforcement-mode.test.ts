import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { computeEnforcementMode } from "./enforcement-mode.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

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
  it("hasFullAccessAccount=true → 'Default template'", () => {
    const result = computeEnforcementMode(null, true, { hasFullAccessAccount: true });
    assert.equal(result.mode, "monitoring_only");
    assert.equal(result.label, "Default template");
    assert.ok(result.detail.includes("Rules are saved in Guardrail"));
    assert.ok(result.detail.includes("Eligible Tradovate accounts"));
  });

  it("hasFullAccessAccount=false → 'Default template'", () => {
    const result = computeEnforcementMode(null, true, { hasFullAccessAccount: false });
    assert.equal(result.mode, "monitoring_only");
    assert.equal(result.label, "Default template");
    assert.ok(result.detail.includes("Rules are saved in Guardrail"));
    assert.ok(result.detail.includes("Broker-side behavior depends on each account"));
  });

  it("default scope omits hasFullAccessAccount → conservative copy", () => {
    const result = computeEnforcementMode(null, true);
    assert.equal(result.label, "Default template");
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

  it("label says 'Full access connected' for probed full_access (not 'Broker risk settings enabled' — enforcement off in beta)", () => {
    const result = computeEnforcementMode(
      tradovateAccount("connected_live", "full_access"),
      false,
    );
    assert.equal(result.label, "Full access connected");
  });

  it("upgrades label even when connection still labelled connected_readonly (probe overrides legacy status)", () => {
    const result = computeEnforcementMode(
      tradovateAccount("connected_readonly", "full_access"),
      false,
    );
    assert.equal(result.mode, "broker_enforcement_pending");
    assert.equal(result.label, "Full access connected");
  });

  it("detail uses the concise capability copy", () => {
    const result = computeEnforcementMode(
      tradovateAccount("connected_live", "full_access"),
      false,
    );
    assert.equal(
      result.detail,
      "Daily loss can be protected through Tradovate broker risk settings. " +
        "Profit targets are monitored in Guardrail.",
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

// ── Regression: never leak raw enum strings into user-facing copy ─────────────

describe("computeEnforcementMode — regression: no raw enum strings in label/detail", () => {
  const FORBIDDEN = [
    "monitoring_only",
    "internal_app_lock",
    "broker_enforcement_pending",
    "broker_enforced_active",
    "broker_enforcement_failed",
    "permission_unverified",
    "broker_readonly",
    "dry_run",
  ];

  type Case = {
    name: string;
    account: Parameters<typeof computeEnforcementMode>[0];
    isDefault: boolean;
    options?: Parameters<typeof computeEnforcementMode>[2];
  };

  const cases: Case[] = [
    { name: "default · hasFullAccessAccount=true", account: null, isDefault: true, options: { hasFullAccessAccount: true } },
    { name: "default · hasFullAccessAccount=false", account: null, isDefault: true, options: { hasFullAccessAccount: false } },
    { name: "default · no options", account: null, isDefault: true },
    { name: "no account", account: null, isDefault: false },
    {
      name: "no broker connection",
      account: { platform: "tradovate", brokerConnectionId: null, brokerConnection: null },
      isDefault: false,
    },
    { name: "expired connection", account: tradovateAccount("expired", "full_access"), isDefault: false },
    { name: "connection_error", account: tradovateAccount("connection_error", "full_access"), isDefault: false },
    { name: "tradovate read_only", account: tradovateAccount("connected_live", "read_only"), isDefault: false },
    { name: "tradovate full_access", account: tradovateAccount("connected_live", "full_access"), isDefault: false },
    { name: "tradovate full_access via connected_readonly status", account: tradovateAccount("connected_readonly", "full_access"), isDefault: false },
    { name: "tradovate permissionLevel=null (probe pending)", account: tradovateAccount("connected_live", null), isDefault: false },
    { name: "tradovate permissionLevel=unknown", account: tradovateAccount("connected_readonly", "unknown"), isDefault: false },
    {
      name: "non-tradovate connected (tradingview)",
      account: {
        platform: "tradingview",
        brokerConnectionId: "conn-tv",
        brokerConnection: { platform: "tradingview", connectionStatus: "connected_live", permissionLevel: null },
      },
      isDefault: false,
    },
  ];

  for (const c of cases) {
    it(`${c.name}: label and detail contain no raw enum strings`, () => {
      const result = computeEnforcementMode(c.account, c.isDefault, c.options);
      for (const forbidden of FORBIDDEN) {
        assert.ok(
          !result.label.toLowerCase().includes(forbidden),
          `label "${result.label}" must not contain raw enum "${forbidden}"`,
        );
        assert.ok(
          !result.detail.toLowerCase().includes(forbidden),
          `detail "${result.detail}" must not contain raw enum "${forbidden}"`,
        );
      }
    });
  }
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

// ── Source-scan: no customer-facing copy claims profit target → broker enforcement ──

describe("profit-target broker-enforcement honesty guard", () => {
  const RULES_COMPONENTS_DIR = __dirname;
  const REPO_ROOT = join(__dirname, "../../../..");

  const SCAN_FILES = [
    join(RULES_COMPONENTS_DIR, "enforcement-mode.ts"),
    join(RULES_COMPONENTS_DIR, "rules-form.tsx"),
    join(RULES_COMPONENTS_DIR, "account-rules-form.tsx"),
    join(REPO_ROOT, "src/app/terms/page.tsx"),
  ];

  const FORBIDDEN_PHRASES = [
    "profit target can be enforced through Tradovate",
    "profit target.*trigger broker",
    "profit target.*broker risk settings on breach",
    "profit target.*can trigger",
    "daily profit target.*can be enforced",
  ];

  for (const filePath of SCAN_FILES) {
    const shortName = filePath.slice(REPO_ROOT.length + 1);
    it(`${shortName} contains no false claim that profit target triggers broker enforcement`, () => {
      const src = readFileSync(filePath, "utf8").toLowerCase();
      for (const phrase of FORBIDDEN_PHRASES) {
        const re = new RegExp(phrase, "i");
        assert.ok(
          !re.test(src),
          `${shortName} must not claim profit target triggers broker enforcement (matched: "${phrase}")`,
        );
      }
    });
  }
});
