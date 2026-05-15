import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  deriveOverallSeverity,
  deriveSafetyAlerts,
  isConnectionRolloutRelevant,
  readEnforcementFlagsFromEnv,
  type EnforcementFlags,
  type SafetyAlertInput,
} from "./safety-console-helpers.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const SAFE_FLAGS: EnforcementFlags = {
  brokerEnforcementEnabled: false,
  listenerLiveEnabled: false,
  internalLockEnabled: false,
  dryRunEnabled: true,
  simulationEnabled: true,
  allowlist: ["cmottd1z200020do1knjxq582"],
};

function makeInput(overrides: Partial<SafetyAlertInput> = {}): SafetyAlertInput {
  return {
    flags: SAFE_FLAGS,
    activeLocks: [],
    historicalBrokerEnforcements: [],
    listeners: [],
    listenerStaleThresholdMs: 60_000,
    now: new Date("2026-05-15T12:00:00Z"),
    ...overrides,
  };
}

// ── readEnforcementFlagsFromEnv ───────────────────────────────────────────────

describe("readEnforcementFlagsFromEnv", () => {
  it("reads the canonical safe-mode env state", () => {
    const flags = readEnforcementFlagsFromEnv({
      BROKER_ENFORCEMENT_ENABLED: "false",
      TRADOVATE_LISTENER_ENABLE_LIVE: "false",
      GUARDRAIL_INTERNAL_LOCK_ENABLED: "false",
      ENFORCEMENT_DRY_RUN: "true",
      BROKER_ENFORCEMENT_SIMULATION_ENABLED: "true",
      BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST: "cmottd1z200020do1knjxq582",
    });
    assert.equal(flags.brokerEnforcementEnabled, false);
    assert.equal(flags.listenerLiveEnabled, false);
    assert.equal(flags.dryRunEnabled, true);
    assert.equal(flags.simulationEnabled, true);
    assert.deepEqual(flags.allowlist, ["cmottd1z200020do1knjxq582"]);
  });

  it("trims and filters empty allowlist entries", () => {
    const flags = readEnforcementFlagsFromEnv({
      BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST: " a , , b , c ",
    });
    assert.deepEqual(flags.allowlist, ["a", "b", "c"]);
  });

  it("absent env vars default to false / empty", () => {
    const flags = readEnforcementFlagsFromEnv({});
    assert.equal(flags.brokerEnforcementEnabled, false);
    assert.equal(flags.listenerLiveEnabled, false);
    assert.equal(flags.dryRunEnabled, false);
    assert.deepEqual(flags.allowlist, []);
  });
});

// ── deriveSafetyAlerts ────────────────────────────────────────────────────────

describe("deriveSafetyAlerts — safe state", () => {
  it("safe state produces zero alerts", () => {
    const alerts = deriveSafetyAlerts(makeInput());
    assert.equal(alerts.length, 0);
  });

  it("safe state overall severity is 'safe'", () => {
    assert.equal(deriveOverallSeverity(deriveSafetyAlerts(makeInput())), "safe");
  });
});

describe("deriveSafetyAlerts — critical env flags", () => {
  it("BROKER_ENFORCEMENT_ENABLED=true → critical", () => {
    const alerts = deriveSafetyAlerts(
      makeInput({
        flags: { ...SAFE_FLAGS, brokerEnforcementEnabled: true },
      }),
    );
    const a = alerts.find((x) => x.code === "broker_enforcement_enabled");
    assert.ok(a, "must emit broker_enforcement_enabled alert");
    assert.equal(a.severity, "critical");
  });

  it("TRADOVATE_LISTENER_ENABLE_LIVE=true → critical", () => {
    const alerts = deriveSafetyAlerts(
      makeInput({
        flags: { ...SAFE_FLAGS, listenerLiveEnabled: true },
      }),
    );
    const a = alerts.find((x) => x.code === "listener_live_enabled");
    assert.ok(a, "must emit listener_live_enabled alert");
    assert.equal(a.severity, "critical");
  });

  it("ENFORCEMENT_DRY_RUN=false + BROKER_ENFORCEMENT_ENABLED=true → critical", () => {
    const alerts = deriveSafetyAlerts(
      makeInput({
        flags: {
          ...SAFE_FLAGS,
          brokerEnforcementEnabled: true,
          dryRunEnabled: false,
        },
      }),
    );
    const a = alerts.find((x) => x.code === "dry_run_disabled_with_enforcement");
    assert.ok(a, "must emit dry_run_disabled_with_enforcement alert");
    assert.equal(a.severity, "critical");
  });

  it("ENFORCEMENT_DRY_RUN=false alone (enforcement off) does NOT raise critical", () => {
    const alerts = deriveSafetyAlerts(
      makeInput({
        flags: { ...SAFE_FLAGS, dryRunEnabled: false },
      }),
    );
    assert.equal(
      alerts.filter((x) => x.severity === "critical").length,
      0,
      "dry_run=false alone is not critical when enforcement is disabled",
    );
  });

  it("overall severity is critical when any critical alert is present", () => {
    const alerts = deriveSafetyAlerts(
      makeInput({
        flags: { ...SAFE_FLAGS, brokerEnforcementEnabled: true },
      }),
    );
    assert.equal(deriveOverallSeverity(alerts), "critical");
  });
});

describe("deriveSafetyAlerts — active locks", () => {
  it("active internal lock → warning", () => {
    const alerts = deriveSafetyAlerts(
      makeInput({
        activeLocks: [{ accountId: "acct-1", env: "demo" }],
      }),
    );
    const a = alerts.find((x) => x.code === "active_internal_lock");
    assert.ok(a, "must emit active_internal_lock warning");
    assert.equal(a.severity, "warning");
  });

  it("more than one active lock → multiple_broker_candidates warning", () => {
    const alerts = deriveSafetyAlerts(
      makeInput({
        activeLocks: [
          { accountId: "acct-1", env: "demo" },
          { accountId: "acct-2", env: "demo" },
        ],
      }),
    );
    assert.ok(alerts.find((x) => x.code === "multiple_broker_candidates"));
  });

  it("duplicate active locks on same account → duplicate_active_locks warning", () => {
    const alerts = deriveSafetyAlerts(
      makeInput({
        activeLocks: [
          { accountId: "acct-1", env: "demo" },
          { accountId: "acct-1", env: "demo" },
        ],
      }),
    );
    assert.ok(alerts.find((x) => x.code === "duplicate_active_locks"));
  });

  it("any active lock with env=live → critical live_candidate_env", () => {
    const alerts = deriveSafetyAlerts(
      makeInput({
        activeLocks: [{ accountId: "acct-1", env: "live" }],
      }),
    );
    const a = alerts.find((x) => x.code === "live_candidate_env");
    assert.ok(a);
    assert.equal(a.severity, "critical");
  });
});

describe("deriveSafetyAlerts — historical broker enforcement is not active danger", () => {
  it("historical broker_locked only (no active locks) does NOT produce active-lock warnings", () => {
    const alerts = deriveSafetyAlerts(
      makeInput({
        activeLocks: [],
        historicalBrokerEnforcements: [{ brokerLockStatus: "broker_locked" }],
      }),
    );
    assert.equal(alerts.length, 0, "post-canary safe state must produce no alerts");
    assert.equal(deriveOverallSeverity(alerts), "safe");
  });

  it("historical broker_lock_failed → broker_lock_failed warning", () => {
    const alerts = deriveSafetyAlerts(
      makeInput({
        historicalBrokerEnforcements: [
          { brokerLockStatus: "broker_lock_failed" },
        ],
      }),
    );
    assert.ok(alerts.find((x) => x.code === "broker_lock_failed"));
  });
});

describe("deriveSafetyAlerts — listener health (rollout-relevant only)", () => {
  it("rollout-relevant listener status=error → warning", () => {
    const alerts = deriveSafetyAlerts(
      makeInput({
        listeners: [
          {
            connectionId: "conn-abcdefghij",
            env: "demo",
            status: "error",
            lastHeartbeatAt: null,
            isRolloutRelevant: true,
          },
        ],
      }),
    );
    assert.ok(alerts.find((x) => x.code === "listener_unhealthy"));
  });

  it("rollout-relevant listener status=closed → warning", () => {
    const alerts = deriveSafetyAlerts(
      makeInput({
        listeners: [
          {
            connectionId: "conn-abcdefghij",
            env: "demo",
            status: "closed",
            lastHeartbeatAt: null,
            isRolloutRelevant: true,
          },
        ],
      }),
    );
    assert.ok(alerts.find((x) => x.code === "listener_unhealthy"));
  });

  it("non-rollout listener status=error does NOT produce a warning", () => {
    const alerts = deriveSafetyAlerts(
      makeInput({
        listeners: [
          {
            connectionId: "old-expired",
            env: "demo",
            status: "error",
            lastHeartbeatAt: null,
            isRolloutRelevant: false,
          },
        ],
      }),
    );
    assert.equal(
      alerts.length,
      0,
      "old non-rollout listener errors must not generate alerts",
    );
  });

  it("mix: only rollout-relevant listener error counts; old errors are ignored", () => {
    const alerts = deriveSafetyAlerts(
      makeInput({
        listeners: [
          {
            connectionId: "old-1",
            env: "demo",
            status: "error",
            lastHeartbeatAt: null,
            isRolloutRelevant: false,
          },
          {
            connectionId: "old-2",
            env: "demo",
            status: "error",
            lastHeartbeatAt: null,
            isRolloutRelevant: false,
          },
          {
            connectionId: "rollout-target",
            env: "demo",
            status: "error",
            lastHeartbeatAt: null,
            isRolloutRelevant: true,
          },
        ],
      }),
    );
    const unhealthy = alerts.filter((x) => x.code === "listener_unhealthy");
    assert.equal(unhealthy.length, 1, "only the rollout-target listener alert should fire");
    assert.ok(unhealthy[0].message.includes("rollout-target".slice(-10)));
  });

  it("rollout-relevant stale heartbeat → listener_stale warning", () => {
    const now = new Date("2026-05-15T12:00:00Z");
    const oldHb = new Date(now.getTime() - 120_000).toISOString();
    const alerts = deriveSafetyAlerts(
      makeInput({
        listeners: [
          {
            connectionId: "conn-abcdefghij",
            env: "demo",
            status: "open",
            lastHeartbeatAt: oldHb,
            isRolloutRelevant: true,
          },
        ],
        listenerStaleThresholdMs: 60_000,
        now,
      }),
    );
    assert.ok(alerts.find((x) => x.code === "listener_stale"));
  });

  it("non-rollout stale heartbeat does NOT produce a warning", () => {
    const now = new Date("2026-05-15T12:00:00Z");
    const oldHb = new Date(now.getTime() - 120_000).toISOString();
    const alerts = deriveSafetyAlerts(
      makeInput({
        listeners: [
          {
            connectionId: "conn-abcdefghij",
            env: "demo",
            status: "open",
            lastHeartbeatAt: oldHb,
            isRolloutRelevant: false,
          },
        ],
        listenerStaleThresholdMs: 60_000,
        now,
      }),
    );
    assert.equal(alerts.length, 0);
  });

  it("listener with fresh heartbeat produces no warning", () => {
    const now = new Date("2026-05-15T12:00:00Z");
    const freshHb = new Date(now.getTime() - 5_000).toISOString();
    const alerts = deriveSafetyAlerts(
      makeInput({
        listeners: [
          {
            connectionId: "conn-abcdefghij",
            env: "demo",
            status: "open",
            lastHeartbeatAt: freshHb,
            isRolloutRelevant: true,
          },
        ],
        listenerStaleThresholdMs: 60_000,
        now,
      }),
    );
    assert.equal(alerts.length, 0);
  });
});

// ── isConnectionRolloutRelevant ──────────────────────────────────────────────

describe("isConnectionRolloutRelevant", () => {
  it("expired connection → false even when allowlisted", () => {
    const r = isConnectionRolloutRelevant({
      connectionStatus: "expired",
      activeProtectedAccountCount: 1,
      hasAllowlistedAccount: true,
    });
    assert.equal(r, false);
  });

  it("active protected account → true", () => {
    const r = isConnectionRolloutRelevant({
      connectionStatus: "connected_live",
      activeProtectedAccountCount: 1,
      hasAllowlistedAccount: false,
    });
    assert.equal(r, true);
  });

  it("no active accounts but allowlisted → true", () => {
    const r = isConnectionRolloutRelevant({
      connectionStatus: "connected_readonly",
      activeProtectedAccountCount: 0,
      hasAllowlistedAccount: true,
    });
    assert.equal(r, true);
  });

  it("no active accounts and not allowlisted → false", () => {
    const r = isConnectionRolloutRelevant({
      connectionStatus: "connection_error",
      activeProtectedAccountCount: 0,
      hasAllowlistedAccount: false,
    });
    assert.equal(r, false);
  });

  it("not_connected with no active accounts → false", () => {
    const r = isConnectionRolloutRelevant({
      connectionStatus: "not_connected",
      activeProtectedAccountCount: 0,
      hasAllowlistedAccount: false,
    });
    assert.equal(r, false);
  });
});

// ── Source-scan: page admin auth gate ─────────────────────────────────────────

describe("source-scan: safety console page is admin-gated and read-only", () => {
  const PAGE_SRC = readFileSync(
    resolve(__dirname, "../app/debug/safety-console/page.tsx"),
    "utf8",
  );

  it("requires authenticated user", () => {
    assert.ok(
      PAGE_SRC.includes("getCurrentUser()"),
      "safety console page must call getCurrentUser()",
    );
  });

  it("gates access with isAdminEmail", () => {
    assert.ok(
      PAGE_SRC.includes("isAdminEmail"),
      "safety console page must gate non-admin users with isAdminEmail",
    );
  });

  it("returns notFound() for non-admins (hides existence)", () => {
    assert.ok(
      PAGE_SRC.includes("notFound()"),
      "safety console page must call notFound() for non-admin users",
    );
  });

  it("does not call any Tradovate broker endpoint", () => {
    assert.ok(
      !PAGE_SRC.includes("tradovate.com") && !PAGE_SRC.includes("liquidatepositions"),
      "safety console page must not call any Tradovate broker endpoint",
    );
  });

  it("does not write — no prisma.*.create/update/delete", () => {
    assert.ok(
      !/prisma\.[a-zA-Z]+\.create\(/.test(PAGE_SRC),
      "safety console page must not perform any prisma create",
    );
    assert.ok(
      !/prisma\.[a-zA-Z]+\.update\(/.test(PAGE_SRC),
      "safety console page must not perform any prisma update",
    );
    assert.ok(
      !/prisma\.[a-zA-Z]+\.delete/.test(PAGE_SRC),
      "safety console page must not perform any prisma delete",
    );
  });

  it("uses deriveSafetyAlerts from the helpers module", () => {
    assert.ok(
      PAGE_SRC.includes("deriveSafetyAlerts"),
      "safety console page must compute alerts via deriveSafetyAlerts",
    );
  });
});

// ── Source-scan: normal customer dashboard hides audit details ───────────────

describe("source-scan: normal customer dashboard does not expose technical audit details", () => {
  const DASHBOARD_SRC = readFileSync(
    resolve(__dirname, "../app/dashboard/_components/command-center/command-center.tsx"),
    "utf8",
  );

  it("dashboard does not render Intervention ID label", () => {
    assert.ok(
      !DASHBOARD_SRC.includes("Intervention ID"),
      "customer dashboard must not show intervention IDs",
    );
  });

  it("dashboard does not render Internal lock ID label", () => {
    assert.ok(
      !DASHBOARD_SRC.includes("Internal lock ID"),
      "customer dashboard must not show internal lock IDs",
    );
  });

  it("dashboard does not render Dedup key label", () => {
    assert.ok(
      !DASHBOARD_SRC.includes("Dedup key"),
      "customer dashboard must not show dedup keys",
    );
  });

  it("dashboard does not render listenerBrokerDedupKey field", () => {
    assert.ok(
      !DASHBOARD_SRC.includes("listenerBrokerDedupKey"),
      "customer dashboard must not surface the raw listenerBrokerDedupKey field",
    );
  });
});
