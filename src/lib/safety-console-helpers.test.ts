import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  deriveOverallSeverity,
  deriveRolloutReadiness,
  deriveSafetyAlerts,
  isAccountRolloutRelevant,
  isConnectionRolloutRelevant,
  readEnforcementFlagsFromEnv,
  resolveListenerFlags,
  type EnforcementFlags,
  type ListenerWorkerStatusRecord,
  type RolloutAccountInput,
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

/** Default: web env in safe mode, listener-worker env exposed and safe. */
function makeInput(overrides: Partial<SafetyAlertInput> = {}): SafetyAlertInput {
  return {
    webFlags: SAFE_FLAGS,
    listenerFlags: SAFE_FLAGS,
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

// ── resolveListenerFlags ──────────────────────────────────────────────────────

describe("resolveListenerFlags", () => {
  const NOW = new Date("2026-05-15T12:00:00Z");
  const STALE_MS = 5 * 60_000;

  function record(
    overrides: Partial<ListenerWorkerStatusRecord> = {},
  ): ListenerWorkerStatusRecord {
    return {
      brokerEnforcementEnabled: false,
      listenerLiveEnabled: false,
      internalLockEnabled: false,
      dryRunEnabled: true,
      simulationEnabled: true,
      allowlist: ["cmottd1z200020do1knjxq582"],
      reportedAt: new Date(NOW.getTime() - 30_000).toISOString(),
      ...overrides,
    };
  }

  it("null record → null (listener-worker has never reported)", () => {
    assert.equal(
      resolveListenerFlags({ record: null, now: NOW, staleThresholdMs: STALE_MS }),
      null,
    );
  });

  it("fresh record → EnforcementFlags mirroring the listener-worker", () => {
    const flags = resolveListenerFlags({
      record: record(),
      now: NOW,
      staleThresholdMs: STALE_MS,
    });
    assert.ok(flags, "fresh record must resolve to flags");
    assert.equal(flags.brokerEnforcementEnabled, false);
    assert.equal(flags.listenerLiveEnabled, false);
    assert.equal(flags.dryRunEnabled, true);
    assert.deepEqual(flags.allowlist, ["cmottd1z200020do1knjxq582"]);
  });

  it("stale record → null (worker stopped; old flags must not be trusted)", () => {
    const stale = record({
      reportedAt: new Date(NOW.getTime() - STALE_MS - 1_000).toISOString(),
    });
    assert.equal(
      resolveListenerFlags({ record: stale, now: NOW, staleThresholdMs: STALE_MS }),
      null,
    );
  });

  it("unparseable reportedAt → null", () => {
    const bad = record({ reportedAt: "not-a-date" });
    assert.equal(
      resolveListenerFlags({ record: bad, now: NOW, staleThresholdMs: STALE_MS }),
      null,
    );
  });

  it("dangerous fresh record resolves to flags that drive critical alerts", () => {
    const flags = resolveListenerFlags({
      record: record({ brokerEnforcementEnabled: true, dryRunEnabled: false }),
      now: NOW,
      staleThresholdMs: STALE_MS,
    });
    assert.ok(flags);
    const alerts = deriveSafetyAlerts(makeInput({ listenerFlags: flags }));
    assert.ok(
      alerts.find((a) => a.code === "broker_enforcement_enabled"),
      "resolved dangerous flags must drive a critical alert",
    );
    assert.equal(deriveOverallSeverity(alerts), "critical");
  });

  it("fresh SAFE record → no listener_flags_unexposed alert, overall safe", () => {
    const flags = resolveListenerFlags({
      record: record(),
      now: NOW,
      staleThresholdMs: STALE_MS,
    });
    const alerts = deriveSafetyAlerts(makeInput({ listenerFlags: flags }));
    assert.equal(
      alerts.find((a) => a.code === "listener_flags_unexposed"),
      undefined,
      "verified safe listener flags must suppress the unexposed info alert",
    );
    assert.equal(deriveOverallSeverity(alerts), "safe");
  });

  it("stale record falls back to listener_flags_unexposed info alert", () => {
    const stale = record({
      reportedAt: new Date(NOW.getTime() - STALE_MS - 1_000).toISOString(),
    });
    const flags = resolveListenerFlags({
      record: stale,
      now: NOW,
      staleThresholdMs: STALE_MS,
    });
    const alerts = deriveSafetyAlerts(makeInput({ listenerFlags: flags }));
    assert.ok(
      alerts.find((a) => a.code === "listener_flags_unexposed"),
      "a stale row must behave like 'not exposed'",
    );
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

describe("deriveSafetyAlerts — critical env flags (LISTENER-WORKER source only)", () => {
  it("listener-worker BROKER_ENFORCEMENT_ENABLED=true → critical", () => {
    const alerts = deriveSafetyAlerts(
      makeInput({
        listenerFlags: { ...SAFE_FLAGS, brokerEnforcementEnabled: true },
      }),
    );
    const a = alerts.find((x) => x.code === "broker_enforcement_enabled");
    assert.ok(a, "must emit broker_enforcement_enabled alert");
    assert.equal(a.severity, "critical");
  });

  it("listener-worker TRADOVATE_LISTENER_ENABLE_LIVE=true → critical", () => {
    const alerts = deriveSafetyAlerts(
      makeInput({
        listenerFlags: { ...SAFE_FLAGS, listenerLiveEnabled: true },
      }),
    );
    const a = alerts.find((x) => x.code === "listener_live_enabled");
    assert.ok(a, "must emit listener_live_enabled alert");
    assert.equal(a.severity, "critical");
  });

  it("listener-worker ENFORCEMENT_DRY_RUN=false + BROKER_ENFORCEMENT_ENABLED=true → critical", () => {
    const alerts = deriveSafetyAlerts(
      makeInput({
        listenerFlags: {
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

  it("listener-worker ENFORCEMENT_DRY_RUN=false alone (enforcement off) does NOT raise critical", () => {
    const alerts = deriveSafetyAlerts(
      makeInput({
        listenerFlags: { ...SAFE_FLAGS, dryRunEnabled: false },
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
        listenerFlags: { ...SAFE_FLAGS, brokerEnforcementEnabled: true },
      }),
    );
    assert.equal(deriveOverallSeverity(alerts), "critical");
  });
});

// ── Web/app env values must NOT be a source for listener-worker safety alerts ─

describe("deriveSafetyAlerts — web env never triggers listener-worker critical alerts", () => {
  it("web ENFORCEMENT_DRY_RUN=false does NOT imply listener-worker dry-run is off", () => {
    const alerts = deriveSafetyAlerts(
      makeInput({
        webFlags: {
          ...SAFE_FLAGS,
          brokerEnforcementEnabled: true,
          dryRunEnabled: false,
        },
        listenerFlags: SAFE_FLAGS, // listener is actually safe
      }),
    );
    const a = alerts.find((x) => x.code === "dry_run_disabled_with_enforcement");
    assert.equal(
      a,
      undefined,
      "must not raise dry_run_disabled_with_enforcement based on web env when listener says safe",
    );
    const enforcementAlert = alerts.find(
      (x) => x.code === "broker_enforcement_enabled",
    );
    assert.equal(
      enforcementAlert,
      undefined,
      "must not raise broker_enforcement_enabled based on web env when listener says safe",
    );
  });

  it("web BROKER_ENFORCEMENT_ENABLED=true does NOT trigger critical when listener is safe", () => {
    const alerts = deriveSafetyAlerts(
      makeInput({
        webFlags: { ...SAFE_FLAGS, brokerEnforcementEnabled: true, dryRunEnabled: false },
        listenerFlags: SAFE_FLAGS,
      }),
    );
    assert.equal(
      alerts.filter((x) => x.severity === "critical").length,
      0,
      "web env alone cannot produce listener-worker critical alerts",
    );
  });

  it("web TRADOVATE_LISTENER_ENABLE_LIVE=true does NOT trigger listener_live_enabled when listener is safe", () => {
    const alerts = deriveSafetyAlerts(
      makeInput({
        webFlags: { ...SAFE_FLAGS, listenerLiveEnabled: true },
        listenerFlags: SAFE_FLAGS,
      }),
    );
    assert.equal(
      alerts.find((x) => x.code === "listener_live_enabled"),
      undefined,
    );
  });
});

// ── When listener-worker env is not exposed at all ────────────────────────────

describe("deriveSafetyAlerts — listener-worker flags unexposed (listenerFlags === null)", () => {
  it("emits an info alert telling the admin to verify listener-worker env", () => {
    const alerts = deriveSafetyAlerts(
      makeInput({
        webFlags: SAFE_FLAGS,
        listenerFlags: null,
      }),
    );
    const a = alerts.find((x) => x.code === "listener_flags_unexposed");
    assert.ok(a, "must surface listener_flags_unexposed when listener env is null");
    assert.equal(a.severity, "info");
  });

  it("does NOT raise listener-worker critical alerts from web env when listener flags are null", () => {
    const alerts = deriveSafetyAlerts(
      makeInput({
        webFlags: {
          ...SAFE_FLAGS,
          brokerEnforcementEnabled: true,
          listenerLiveEnabled: true,
          dryRunEnabled: false,
        },
        listenerFlags: null,
      }),
    );
    assert.equal(
      alerts.filter((x) => x.severity === "critical").length,
      0,
      "no critical env alerts when listener-worker env is not exposed",
    );
  });

  it("overall severity is 'info' (not critical) when only the unexposed-info alert fires", () => {
    const alerts = deriveSafetyAlerts(
      makeInput({
        webFlags: SAFE_FLAGS,
        listenerFlags: null,
      }),
    );
    assert.equal(deriveOverallSeverity(alerts), "info");
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

// ── isAccountRolloutRelevant ─────────────────────────────────────────────────

describe("isAccountRolloutRelevant", () => {
  it("allowlisted account → true regardless of lock/history", () => {
    assert.equal(
      isAccountRolloutRelevant({ isInAllowlist: true, activeLockCount: 0, historicalEnforcementCount: 0 }),
      true,
    );
  });

  it("account with active lock → true", () => {
    assert.equal(
      isAccountRolloutRelevant({ isInAllowlist: false, activeLockCount: 1, historicalEnforcementCount: 0 }),
      true,
    );
  });

  it("account with historical enforcement → true", () => {
    assert.equal(
      isAccountRolloutRelevant({ isInAllowlist: false, activeLockCount: 0, historicalEnforcementCount: 3 }),
      true,
    );
  });

  it("active protected account with no allowlist/lock/history → false", () => {
    assert.equal(
      isAccountRolloutRelevant({ isInAllowlist: false, activeLockCount: 0, historicalEnforcementCount: 0 }),
      false,
    );
  });
});

// ── isConnectionRolloutRelevant ──────────────────────────────────────────────

describe("isConnectionRolloutRelevant", () => {
  it("expired connection → false even when it has rollout-relevant accounts", () => {
    assert.equal(
      isConnectionRolloutRelevant({ connectionStatus: "expired", hasRolloutRelevantAccount: true }),
      false,
    );
  });

  it("connection with a rollout-relevant account → true", () => {
    assert.equal(
      isConnectionRolloutRelevant({ connectionStatus: "connected_readonly", hasRolloutRelevantAccount: true }),
      true,
    );
  });

  it("connection with no rollout-relevant accounts → false", () => {
    assert.equal(
      isConnectionRolloutRelevant({ connectionStatus: "connected_readonly", hasRolloutRelevantAccount: false }),
      false,
    );
  });

  it("connected_live with no rollout-relevant accounts → false (protected-only does not qualify)", () => {
    assert.equal(
      isConnectionRolloutRelevant({ connectionStatus: "connected_live", hasRolloutRelevantAccount: false }),
      false,
    );
  });

  it("not_connected with no rollout-relevant accounts → false", () => {
    assert.equal(
      isConnectionRolloutRelevant({ connectionStatus: "not_connected", hasRolloutRelevantAccount: false }),
      false,
    );
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

  it("labels env source: 'Web/app runtime env' and 'Listener-worker env'", () => {
    assert.ok(
      PAGE_SRC.includes("Web/app runtime env"),
      "env section must clearly label the web/app source",
    );
    assert.ok(
      PAGE_SRC.includes("Listener-worker env"),
      "env section must clearly label the listener-worker source",
    );
  });

  it("section description does not claim env values cover all services", () => {
    assert.ok(
      !PAGE_SRC.includes("Current process env state across services"),
      "old misleading description must be removed",
    );
    assert.ok(
      PAGE_SRC.includes("Listener-worker env values are shown only when explicitly exposed"),
      "section description must disclose that listener-worker env is shown only when exposed",
    );
  });

  it("shows 'Not exposed by listener status' when listener-worker env is unavailable", () => {
    assert.ok(
      PAGE_SRC.includes("Not exposed by listener status"),
      "page must show 'Not exposed by listener status' for listener-worker env when not available",
    );
  });

  it("passes both webFlags and listenerFlags to deriveSafetyAlerts", () => {
    assert.ok(
      PAGE_SRC.includes("webFlags:"),
      "page must pass webFlags to deriveSafetyAlerts",
    );
    assert.ok(
      PAGE_SRC.includes("listenerFlags"),
      "page must pass listenerFlags to deriveSafetyAlerts",
    );
  });

  it("labels last-close field as 'lastCloseCode/Reason' (historical, not current state)", () => {
    assert.ok(
      PAGE_SRC.includes("lastCloseCode/Reason"),
      "listener row must use 'lastCloseCode/Reason' label to clarify the value is historical",
    );
    assert.ok(
      !PAGE_SRC.includes('"closeCode/Reason"'),
      "ambiguous 'closeCode/Reason' label must not appear — use 'lastCloseCode/Reason'",
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

// ── Source-scan: Safety Console reads listener-worker flags from the DB ───────

describe("source-scan: safety console reads persisted listener-worker flags", () => {
  const PAGE_SRC = readFileSync(
    resolve(__dirname, "../app/debug/safety-console/page.tsx"),
    "utf8",
  );

  it("reads the ListenerWorkerStatus singleton row", () => {
    assert.ok(
      PAGE_SRC.includes("listenerWorkerStatus.findUnique"),
      "page must read the persisted listener-worker status row",
    );
  });

  it("resolves listener flags via resolveListenerFlags (with staleness)", () => {
    assert.ok(
      PAGE_SRC.includes("resolveListenerFlags"),
      "page must resolve listener flags through resolveListenerFlags",
    );
  });

  it("no longer hardcodes listenerFlags = null", () => {
    assert.ok(
      !/const listenerFlags = null/.test(PAGE_SRC),
      "page must compute listenerFlags, not hardcode null",
    );
  });

  it("shows 'Listener-worker env verified' when flags are exposed", () => {
    assert.ok(
      PAGE_SRC.includes("Listener-worker env verified"),
      "page must show a verified state for exposed listener-worker flags",
    );
  });

  it("keeps 'Not exposed by listener status' as the fallback", () => {
    assert.ok(
      PAGE_SRC.includes("Not exposed by listener status"),
      "page must keep the not-exposed fallback copy",
    );
  });

  it("is still read-only — no prisma writes", () => {
    assert.ok(!/prisma\.[a-zA-Z]+\.create\(/.test(PAGE_SRC));
    assert.ok(!/prisma\.[a-zA-Z]+\.update\(/.test(PAGE_SRC));
    assert.ok(!/prisma\.[a-zA-Z]+\.upsert\(/.test(PAGE_SRC));
    assert.ok(!/prisma\.[a-zA-Z]+\.delete/.test(PAGE_SRC));
  });
});

// ── Source-scan: listener-worker status write is diagnostics-only ────────────

describe("source-scan: listener-worker persists its flags without broker writes", () => {
  const WORKER_SRC = readFileSync(
    resolve(__dirname, "../../scripts/tradovate-listener-worker.ts"),
    "utf8",
  );

  it("defines writeListenerWorkerStatus", () => {
    assert.ok(
      WORKER_SRC.includes("async function writeListenerWorkerStatus"),
      "listener-worker must define writeListenerWorkerStatus",
    );
  });

  it("writeListenerWorkerStatus upserts the ListenerWorkerStatus singleton", () => {
    assert.ok(
      WORKER_SRC.includes('listenerWorkerStatus.upsert'),
      "worker must upsert the listenerWorkerStatus row",
    );
    assert.ok(
      WORKER_SRC.includes('where: { id: "singleton" }'),
      "worker must target the singleton row",
    );
  });

  it("calls writeListenerWorkerStatus from the reconcile loop", () => {
    const reconcileIdx = WORKER_SRC.indexOf(
      "async function reconcileListeners",
    );
    assert.ok(reconcileIdx >= 0, "reconcileListeners must exist");
    const reconcileBody = WORKER_SRC.slice(reconcileIdx, reconcileIdx + 600);
    assert.ok(
      reconcileBody.includes("writeListenerWorkerStatus()"),
      "reconcile loop must refresh the worker status row",
    );
  });

  it("writeListenerWorkerStatus performs no broker / Tradovate writes", () => {
    const fnIdx = WORKER_SRC.indexOf(
      "async function writeListenerWorkerStatus",
    );
    const fnEnd = WORKER_SRC.indexOf("\nfunction errMessage", fnIdx);
    assert.ok(fnIdx >= 0 && fnEnd > fnIdx, "must locate the function body");
    const body = WORKER_SRC.slice(fnIdx, fnEnd);
    for (const forbidden of [
      "liquidatepositions",
      "cancelorder",
      "placeorder",
      "flatten",
      "tradovate.com",
      "maybeAttemptBroker",
      "fetch(",
    ]) {
      assert.ok(
        !body.includes(forbidden),
        `worker status write must not contain '${forbidden}'`,
      );
    }
  });
});

// ── deriveRolloutReadiness ────────────────────────────────────────────────────

/** Safe DEMO account used as the baseline for rollout readiness tests. */
const DEMO_ACCOUNT: RolloutAccountInput = {
  accountId: "cmottd1z200020do1knjxq582",
  label: "DEMO7433035",
  connectionEnv: "demo",
  isInAllowlist: true,
  activeLockCount: 0,
  brokerLockFailedCount: 0,
  listenerStatus: "connected",
  lastReconciliationStatus: "success",
};

describe("deriveRolloutReadiness — ready state", () => {
  it("DEMO safe state with historical broker_locked only → ready", () => {
    // brokerLockFailedCount=0 (only broker_locked history, not broker_lock_failed)
    const result = deriveRolloutReadiness({
      account: { ...DEMO_ACCOUNT, brokerLockFailedCount: 0 },
      listenerFlags: SAFE_FLAGS,
    });
    assert.equal(result.status, "ready");
    assert.equal(result.accountId, DEMO_ACCOUNT.accountId);
    assert.equal(result.accountLabel, "DEMO7433035");
  });

  it("historical broker_locked only does NOT block (brokerLockFailedCount stays 0)", () => {
    // The historical broker_locked status does not increment brokerLockFailedCount —
    // only broker_lock_failed events do. Verify ready state holds.
    const result = deriveRolloutReadiness({
      account: { ...DEMO_ACCOUNT, brokerLockFailedCount: 0 },
      listenerFlags: SAFE_FLAGS,
    });
    assert.equal(result.status, "ready");
    const lockFailCheck = result.checks.find((c) => c.label === "No broker_lock_failed history");
    assert.ok(lockFailCheck, "check must exist");
    assert.equal(lockFailCheck.pass, true);
  });

  it("all checks pass → every check has pass=true", () => {
    const result = deriveRolloutReadiness({
      account: DEMO_ACCOUNT,
      listenerFlags: SAFE_FLAGS,
    });
    assert.equal(result.status, "ready");
    const failing = result.checks.filter((c) => !c.pass);
    assert.equal(failing.length, 0, `unexpected failing checks: ${failing.map((c) => c.label).join(", ")}`);
  });
});

describe("deriveRolloutReadiness — blocked states", () => {
  it("active internal lock → blocked", () => {
    const result = deriveRolloutReadiness({
      account: { ...DEMO_ACCOUNT, activeLockCount: 1 },
      listenerFlags: SAFE_FLAGS,
    });
    assert.equal(result.status, "blocked");
    const lockCheck = result.checks.find((c) => c.label === "No active internal lock");
    assert.ok(lockCheck && !lockCheck.pass && lockCheck.blocking);
  });

  it("live connectionEnv → blocked", () => {
    const result = deriveRolloutReadiness({
      account: { ...DEMO_ACCOUNT, connectionEnv: "live" },
      listenerFlags: SAFE_FLAGS,
    });
    assert.equal(result.status, "blocked");
    const envCheck = result.checks.find((c) => c.label === "Connection env is demo (not live)");
    assert.ok(envCheck && !envCheck.pass && envCheck.blocking);
  });

  it("listener status=closed → blocked", () => {
    const result = deriveRolloutReadiness({
      account: { ...DEMO_ACCOUNT, listenerStatus: "closed" },
      listenerFlags: SAFE_FLAGS,
    });
    assert.equal(result.status, "blocked");
    const listenerCheck = result.checks.find((c) => c.label === "listener.status=connected");
    assert.ok(listenerCheck && !listenerCheck.pass && listenerCheck.blocking);
  });

  it("listener status=error → blocked", () => {
    const result = deriveRolloutReadiness({
      account: { ...DEMO_ACCOUNT, listenerStatus: "error" },
      listenerFlags: SAFE_FLAGS,
    });
    assert.equal(result.status, "blocked");
    const listenerCheck = result.checks.find((c) => c.label === "listener.status=connected");
    assert.ok(listenerCheck && !listenerCheck.pass && listenerCheck.blocking);
  });

  it("reconciliation failed → blocked", () => {
    const result = deriveRolloutReadiness({
      account: { ...DEMO_ACCOUNT, lastReconciliationStatus: "failed" },
      listenerFlags: SAFE_FLAGS,
    });
    assert.equal(result.status, "blocked");
    const reconCheck = result.checks.find((c) => c.label === "Reconciliation status=success");
    assert.ok(reconCheck && !reconCheck.pass && reconCheck.blocking);
  });

  it("broker_lock_failed history → blocked", () => {
    const result = deriveRolloutReadiness({
      account: { ...DEMO_ACCOUNT, brokerLockFailedCount: 2 },
      listenerFlags: SAFE_FLAGS,
    });
    assert.equal(result.status, "blocked");
    const check = result.checks.find((c) => c.label === "No broker_lock_failed history");
    assert.ok(check && !check.pass && check.blocking);
  });

  it("BROKER_ENFORCEMENT_ENABLED=true in listener flags → blocked", () => {
    const result = deriveRolloutReadiness({
      account: DEMO_ACCOUNT,
      listenerFlags: { ...SAFE_FLAGS, brokerEnforcementEnabled: true },
    });
    assert.equal(result.status, "blocked");
    const check = result.checks.find((c) => c.label === "BROKER_ENFORCEMENT_ENABLED=false");
    assert.ok(check && !check.pass && check.blocking);
  });

  it("TRADOVATE_LISTENER_ENABLE_LIVE=true in listener flags → blocked", () => {
    const result = deriveRolloutReadiness({
      account: DEMO_ACCOUNT,
      listenerFlags: { ...SAFE_FLAGS, listenerLiveEnabled: true },
    });
    assert.equal(result.status, "blocked");
    const check = result.checks.find((c) => c.label === "TRADOVATE_LISTENER_ENABLE_LIVE=false");
    assert.ok(check && !check.pass && check.blocking);
  });
});

describe("deriveRolloutReadiness — needs_review states", () => {
  it("missing listener flags (null) → needs_review (env not verified)", () => {
    const result = deriveRolloutReadiness({
      account: DEMO_ACCOUNT,
      listenerFlags: null,
    });
    assert.equal(result.status, "needs_review");
    const envCheck = result.checks.find((c) => c.label === "Listener-worker env verified");
    assert.ok(envCheck && !envCheck.pass && !envCheck.blocking);
  });

  it("missing listener flags: flag-dependent checks also fail but are not blocking", () => {
    const result = deriveRolloutReadiness({
      account: DEMO_ACCOUNT,
      listenerFlags: null,
    });
    assert.equal(result.status, "needs_review");
    // Flag-dependent checks fail when flags unknown but are non-blocking
    const dryRunCheck = result.checks.find((c) => c.label === "ENFORCEMENT_DRY_RUN=true");
    assert.ok(dryRunCheck && !dryRunCheck.pass && !dryRunCheck.blocking);
  });

  it("not in allowlist → needs_review (non-blocking)", () => {
    const result = deriveRolloutReadiness({
      account: { ...DEMO_ACCOUNT, isInAllowlist: false },
      listenerFlags: SAFE_FLAGS,
    });
    assert.equal(result.status, "needs_review");
    const allowlistCheck = result.checks.find((c) => c.label === "Account in demo allowlist");
    assert.ok(allowlistCheck && !allowlistCheck.pass && !allowlistCheck.blocking);
  });

  it("reconciliation skipped (null status) → needs_review", () => {
    const result = deriveRolloutReadiness({
      account: { ...DEMO_ACCOUNT, lastReconciliationStatus: null },
      listenerFlags: SAFE_FLAGS,
    });
    assert.equal(result.status, "needs_review");
    const reconCheck = result.checks.find((c) => c.label === "Reconciliation status=success");
    assert.ok(reconCheck && !reconCheck.pass && !reconCheck.blocking);
  });

  it("listener status=reconnecting → needs_review (not blocked)", () => {
    const result = deriveRolloutReadiness({
      account: { ...DEMO_ACCOUNT, listenerStatus: "reconnecting" },
      listenerFlags: SAFE_FLAGS,
    });
    assert.equal(result.status, "needs_review");
    const listenerCheck = result.checks.find((c) => c.label === "listener.status=connected");
    assert.ok(listenerCheck && !listenerCheck.pass && !listenerCheck.blocking);
  });

  it("listener status=null → needs_review (not blocked)", () => {
    const result = deriveRolloutReadiness({
      account: { ...DEMO_ACCOUNT, listenerStatus: null },
      listenerFlags: SAFE_FLAGS,
    });
    assert.equal(result.status, "needs_review");
  });

  it("ENFORCEMENT_DRY_RUN=false alone (enforcement off) → needs_review, not blocked", () => {
    const result = deriveRolloutReadiness({
      account: DEMO_ACCOUNT,
      listenerFlags: { ...SAFE_FLAGS, dryRunEnabled: false },
    });
    assert.equal(result.status, "needs_review");
    const dryRunCheck = result.checks.find((c) => c.label === "ENFORCEMENT_DRY_RUN=true");
    assert.ok(dryRunCheck && !dryRunCheck.pass && !dryRunCheck.blocking);
  });
});

// ── Source-scan: rollout readiness is admin-only ──────────────────────────────

describe("source-scan: normal customer UI does not expose rollout readiness checklist", () => {
  const DASHBOARD_SRC = readFileSync(
    resolve(__dirname, "../app/dashboard/_components/command-center/command-center.tsx"),
    "utf8",
  );

  it("customer command-center does not render 'Rollout readiness' label", () => {
    assert.ok(
      !DASHBOARD_SRC.includes("Rollout readiness"),
      "customer dashboard must not expose the admin rollout readiness section",
    );
  });

  it("customer command-center does not render rollout checklist statuses", () => {
    assert.ok(
      !DASHBOARD_SRC.includes("needs_review") && !DASHBOARD_SRC.includes("Needs review"),
      "customer dashboard must not surface needs_review rollout status",
    );
  });

  it("customer command-center does not import deriveRolloutReadiness", () => {
    assert.ok(
      !DASHBOARD_SRC.includes("deriveRolloutReadiness"),
      "customer dashboard must not import or call the rollout readiness helper",
    );
  });
});

// ── Source-scan: Trading Plan page does not expose internal terms ─────────────

describe("source-scan: Trading Plan page does not expose internal terms", () => {
  const RULES_PAGE_SRC = readFileSync(
    resolve(__dirname, "../app/rules/page.tsx"),
    "utf8",
  );

  it("does not expose 'InternalLockEvent' to customers", () => {
    assert.ok(
      !RULES_PAGE_SRC.includes("InternalLockEvent"),
      "Trading Plan page must not reference InternalLockEvent",
    );
  });

  it("does not expose 'Safety Console' to customers", () => {
    assert.ok(
      !RULES_PAGE_SRC.includes("Safety Console"),
      "Trading Plan page must not mention Safety Console",
    );
  });

  it("does not expose 'rollout readiness' to customers", () => {
    assert.ok(
      !RULES_PAGE_SRC.includes("rollout readiness"),
      "Trading Plan page must not mention rollout readiness",
    );
  });

  it("does not expose 'listenerBrokerDedupKey' to customers", () => {
    assert.ok(
      !RULES_PAGE_SRC.includes("listenerBrokerDedupKey"),
      "Trading Plan page must not reference the internal listenerBrokerDedupKey field",
    );
  });

  it("does not expose 'reconciliation' to customers", () => {
    assert.ok(
      !RULES_PAGE_SRC.includes("reconciliation"),
      "Trading Plan page must not mention the internal reconciliation process",
    );
  });

  it("does not expose 'listener-worker' to customers", () => {
    assert.ok(
      !RULES_PAGE_SRC.includes("listener-worker"),
      "Trading Plan page must not reference the internal listener-worker term",
    );
  });

  it("does not expose 'broker_locked' as visible text to customers", () => {
    const renderedAsLabel = />\s*broker_locked\s*</.test(RULES_PAGE_SRC);
    assert.ok(!renderedAsLabel, "Trading Plan page must not render raw 'broker_locked' enum value");
  });

  it("does not expose 'Intervention ID' to customers", () => {
    assert.ok(
      !RULES_PAGE_SRC.includes("Intervention ID"),
      "Trading Plan page must not show internal Intervention IDs",
    );
  });

  it("does not expose 'Internal lock ID' to customers", () => {
    assert.ok(
      !RULES_PAGE_SRC.includes("Internal lock ID"),
      "Trading Plan page must not show internal lock IDs",
    );
  });

  it("does not expose 'dedup key' to customers", () => {
    assert.ok(
      !RULES_PAGE_SRC.includes("dedup key"),
      "Trading Plan page must not reference internal dedup keys",
    );
  });

  it("shows 'How enforcement works' user education section", () => {
    assert.ok(
      RULES_PAGE_SRC.includes("How enforcement works"),
      "Trading Plan page must include the 'How enforcement works' education section",
    );
  });

  it("shows 'These are the rules Guardrail watches' copy", () => {
    assert.ok(
      RULES_PAGE_SRC.includes("These are the rules Guardrail watches"),
      "Trading Plan page must include the rule-session context copy",
    );
  });

  it("uses 'Monitoring:' label in enforcement explanation", () => {
    assert.ok(
      RULES_PAGE_SRC.includes("Monitoring:"),
      "enforcement section must use the 'Monitoring:' label",
    );
  });

  it("uses 'App lock:' label in enforcement explanation", () => {
    assert.ok(
      RULES_PAGE_SRC.includes("App lock:"),
      "enforcement section must use the 'App lock:' label",
    );
  });

  it("uses 'Broker risk settings:' label in enforcement explanation", () => {
    assert.ok(
      RULES_PAGE_SRC.includes("Broker risk settings:"),
      "enforcement section must use the 'Broker risk settings:' label",
    );
  });
});

// ── Source-scan: account detail page does not expose internal terms ────────────

describe("source-scan: account detail page does not expose internal terms to customers", () => {
  const ACCOUNT_PAGE_SRC = readFileSync(
    resolve(__dirname, "../app/accounts/[id]/edit/page.tsx"),
    "utf8",
  );

  it("does not show 'Safety Console' to customers", () => {
    assert.ok(
      !ACCOUNT_PAGE_SRC.includes("Safety Console"),
      "account detail page must not mention Safety Console",
    );
  });

  it("does not show 'rollout readiness' to customers", () => {
    assert.ok(
      !ACCOUNT_PAGE_SRC.includes("rollout readiness"),
      "account detail page must not expose rollout readiness",
    );
  });

  it("does not show 'listener-worker' to customers", () => {
    assert.ok(
      !ACCOUNT_PAGE_SRC.includes("listener-worker"),
      "account detail page must not expose the listener-worker internal term",
    );
  });

  it("does not show 'reconciliation' to customers", () => {
    assert.ok(
      !ACCOUNT_PAGE_SRC.includes("reconciliation"),
      "account detail page must not expose the internal reconciliation process",
    );
  });

  it("shows customer-safe 'No active Guardrail lock' copy", () => {
    assert.ok(
      ACCOUNT_PAGE_SRC.includes("No active Guardrail lock"),
      "account detail page must show 'No active Guardrail lock' for customer-safe lock status",
    );
  });

  it("shows 'Broker protection status' section header", () => {
    assert.ok(
      ACCOUNT_PAGE_SRC.includes("Broker protection status"),
      "account detail page must show the 'Broker protection status' section",
    );
  });

  it("shows 'Guardrail checks every fill' session monitoring copy", () => {
    assert.ok(
      ACCOUNT_PAGE_SRC.includes("Guardrail checks every fill"),
      "account detail page must explain that Guardrail monitors every fill",
    );
  });
});

// ── Source-scan: onboarding page does not expose internal terms ───────────────

describe("source-scan: onboarding page does not expose internal terms to customers", () => {
  const ONBOARDING_SRC = readFileSync(
    resolve(__dirname, "../app/onboarding/page.tsx"),
    "utf8",
  );

  it("does not expose 'InternalLockEvent'", () => {
    assert.ok(
      !ONBOARDING_SRC.includes("InternalLockEvent"),
      "onboarding must not reference InternalLockEvent",
    );
  });

  it("does not expose 'Safety Console'", () => {
    assert.ok(
      !ONBOARDING_SRC.includes("Safety Console"),
      "onboarding must not mention Safety Console",
    );
  });

  it("does not expose 'rollout readiness'", () => {
    assert.ok(
      !ONBOARDING_SRC.includes("rollout readiness"),
      "onboarding must not mention rollout readiness",
    );
  });

  it("does not expose 'reconciliation'", () => {
    assert.ok(
      !ONBOARDING_SRC.includes("reconciliation"),
      "onboarding must not mention the internal reconciliation process",
    );
  });

  it("uses customer-friendly monitoring copy", () => {
    assert.ok(
      ONBOARDING_SRC.includes("monitoring"),
      "onboarding must explain monitoring to the customer",
    );
  });

  it("links to Connect Tradovate flow", () => {
    assert.ok(
      ONBOARDING_SRC.includes("Connect Tradovate"),
      "onboarding must have the Connect Tradovate step",
    );
  });

  it("uses 'real-time monitoring' in the connect step", () => {
    assert.ok(
      ONBOARDING_SRC.includes("real-time monitoring"),
      "connect step must describe real-time monitoring",
    );
  });
});

// ── Source-scan: dashboard data-helpers uses customer-safe protection copy ────

describe("source-scan: dashboard data-helpers uses customer-safe protection copy", () => {
  const DATA_HELPERS_SRC = readFileSync(
    resolve(__dirname, "../app/dashboard/_components/command-center/data-helpers.ts"),
    "utf8",
  );

  it("dry-run banner copy says 'Protection test mode'", () => {
    assert.ok(
      DATA_HELPERS_SRC.includes("Protection test mode"),
      "dry-run copy must use 'Protection test mode' not raw 'dry_run'",
    );
  });

  it("dry-run banner copy does not say 'until live enforcement is enabled'", () => {
    assert.ok(
      !DATA_HELPERS_SRC.includes("until live enforcement is enabled"),
      "dry-run copy must not forward-reference 'live enforcement is enabled'",
    );
  });

  it("dry-run banner copy says 'No broker actions are sent'", () => {
    assert.ok(
      DATA_HELPERS_SRC.includes("No broker actions are sent"),
      "dry-run banner must confirm no broker actions are sent",
    );
  });

  it("maps enforcement state to 'Broker risk settings enabled' — not raw enum", () => {
    assert.ok(
      DATA_HELPERS_SRC.includes("Broker risk settings enabled"),
      "data-helpers must use 'Broker risk settings enabled' label, not raw enum values",
    );
  });

  it("does not expose 'Safety Console' in customer copy", () => {
    assert.ok(
      !DATA_HELPERS_SRC.includes("Safety Console"),
      "dashboard data-helpers must not mention Safety Console",
    );
  });

  it("does not expose 'rollout readiness' in customer copy", () => {
    assert.ok(
      !DATA_HELPERS_SRC.includes("rollout readiness"),
      "dashboard data-helpers must not mention rollout readiness",
    );
  });

  it("weekend-close badge uses 'Market closed', not 'Session closed' or plain 'Closed'", () => {
    assert.ok(
      DATA_HELPERS_SRC.includes("Market closed"),
      "weekend-close row status must say 'Market closed'",
    );
    assert.ok(
      !DATA_HELPERS_SRC.includes('"Session closed"'),
      "'Session closed' enum value must no longer appear — replaced by 'Market closed'",
    );
    assert.ok(
      !DATA_HELPERS_SRC.includes('"Closed"'),
      "plain 'Closed' enum value must no longer appear",
    );
  });
});

// ── Source-scan: enforcement-mode copy is customer-safe ───────────────────────

describe("source-scan: enforcement-mode copy does not expose internal terms", () => {
  const ENFORCEMENT_MODE_SRC = readFileSync(
    resolve(__dirname, "../app/rules/_components/enforcement-mode.ts"),
    "utf8",
  );

  it("does not say 'Order actions are not enabled yet'", () => {
    assert.ok(
      !ENFORCEMENT_MODE_SRC.includes("Order actions are not enabled yet"),
      "enforcement-mode must not say 'Order actions are not enabled yet'",
    );
  });

  it("uses simplified Tradovate enforcement copy instead", () => {
    assert.ok(
      ENFORCEMENT_MODE_SRC.includes("Daily loss and profit target can be enforced through Tradovate"),
      "enforcement-mode must use the simplified Tradovate enforcement copy",
    );
  });

  it("does not expose 'Safety Console'", () => {
    assert.ok(
      !ENFORCEMENT_MODE_SRC.includes("Safety Console"),
      "enforcement-mode must not mention Safety Console",
    );
  });
});

// ── Source-scan: broker-listener-status does not expose jargon ────────────────

describe("source-scan: broker-listener-status component uses customer-safe copy", () => {
  const LISTENER_STATUS_SRC = readFileSync(
    resolve(__dirname, "../app/dashboard/_components/broker-listener-status.tsx"),
    "utf8",
  );

  it("does not expose 'detection-response' jargon to customers", () => {
    assert.ok(
      !LISTENER_STATUS_SRC.includes("detection-response"),
      "broker-listener-status must not expose 'detection-response' to customers",
    );
  });

  it("does not expose 'GUARDRAIL DETECTION-RESPONSE' or similar", () => {
    assert.ok(
      !LISTENER_STATUS_SRC.toUpperCase().includes("GUARDRAIL DETECTION"),
      "broker-listener-status must not expose Guardrail detection jargon",
    );
  });

  it("uses 'Guardrail monitors position size after sync' for standard mode", () => {
    assert.ok(
      LISTENER_STATUS_SRC.includes("Guardrail monitors position size after sync"),
      "standard-equiv mode must use customer-safe monitoring copy",
    );
  });

  it("uses 'Broker cap active' for raw broker mode", () => {
    assert.ok(
      LISTENER_STATUS_SRC.includes("Broker cap active"),
      "raw broker mode must use 'Broker cap active' label",
    );
  });
});

// ── Source-scan: max-position-size-conversion-table hides jargon ─────────────

describe("source-scan: position-size conversion table does not expose internal jargon", () => {
  const TABLE_SRC = readFileSync(
    resolve(__dirname, "../app/rules/_components/max-position-size-conversion-table.tsx"),
    "utf8",
  );

  it("does not expose 'Guardrail detection-response' as a header", () => {
    assert.ok(
      !TABLE_SRC.includes("Guardrail detection-response"),
      "conversion table must not use 'Guardrail detection-response' as a visible label",
    );
  });

  it("uses 'Contract limits per product' header", () => {
    assert.ok(
      TABLE_SRC.includes("Contract limits per product"),
      "conversion table must use the customer-friendly 'Contract limits per product' header",
    );
  });
});

// ── Source-scan: account-rules-form uses customer-safe advanced section ───────

describe("source-scan: account-rules-form uses customer-safe copy for advanced section", () => {
  const FORM_SRC = readFileSync(
    resolve(__dirname, "../app/rules/_components/account-rules-form.tsx"),
    "utf8",
  );

  it("does not expose 'detection-response mode' as customer copy", () => {
    assert.ok(
      !FORM_SRC.includes("detection-response mode"),
      "account-rules-form must not say 'detection-response mode' to customers",
    );
  });

  it("does not expose 'raw global contract cap' to customers", () => {
    assert.ok(
      !FORM_SRC.includes("raw global contract cap"),
      "account-rules-form must not say 'raw global contract cap' to customers",
    );
  });

  it("uses 'Advanced broker-side contract cap' as the section header", () => {
    assert.ok(
      FORM_SRC.includes("Advanced broker-side contract cap"),
      "form must use 'Advanced broker-side contract cap' header, not 'Broker raw hard limit'",
    );
  });

  it("does not expose 'Advanced: Broker raw hard limit' to customers", () => {
    assert.ok(
      !FORM_SRC.includes("Advanced: Broker raw hard limit"),
      "form must not expose 'Advanced: Broker raw hard limit' — replaced by cleaner copy",
    );
  });
});

// ── Source-scan: account detail page no longer shows testing language ─────────

describe("source-scan: account detail page does not show testing/audit language to customers", () => {
  const ACCOUNT_EDIT_SRC = readFileSync(
    resolve(__dirname, "../app/accounts/[id]/edit/page.tsx"),
    "utf8",
  );

  it("does not show 'Demo broker protection test completed'", () => {
    assert.ok(
      !ACCOUNT_EDIT_SRC.includes("Demo broker protection test completed"),
      "account page must not show testing language 'Demo broker protection test completed'",
    );
  });

  it("shows 'Supported rules can be protected through broker risk settings' instead", () => {
    assert.ok(
      ACCOUNT_EDIT_SRC.includes("Supported rules can be protected through broker risk settings"),
      "account page must show 'Supported rules can be protected through broker risk settings'",
    );
  });

  it("shows 'No active Guardrail lock right now' as customer-safe status", () => {
    assert.ok(
      ACCOUNT_EDIT_SRC.includes("No active Guardrail lock right now"),
      "account page must confirm no active lock with customer-safe copy",
    );
  });

  it("does not expose 'broker_locked' as a visible label to customers", () => {
    // Code comparisons like `=== "broker_locked"` are fine; JSX text rendering is not.
    const renderedAsLabel = />\s*broker_locked\s*</.test(ACCOUNT_EDIT_SRC);
    assert.ok(
      !renderedAsLabel,
      "account page must not render raw 'broker_locked' enum value as visible JSX text",
    );
  });
});

// ── Source-scan: Phase 2F-2 — customer copy final cleanup ────────────────────

import { resolve as resolve2 } from "node:path";

describe("source-scan: dashboard uses 'Live monitoring' label", () => {
  const LOGIC_SRC = readFileSync(
    resolve2(__dirname, "../app/dashboard/_components/broker-listener-status-logic.ts"),
    "utf8",
  );

  it("freshness label says 'Live monitoring ·' (not bare 'Live ·')", () => {
    assert.ok(
      LOGIC_SRC.includes("Live monitoring ·"),
      "broker-listener-status-logic must use 'Live monitoring ·' prefix",
    );
    assert.ok(
      !LOGIC_SRC.includes("`Live · "),
      "broker-listener-status-logic must not use bare 'Live · ' prefix",
    );
  });
});

describe("source-scan: position-size copy does not expose internal terms", () => {
  const POS_SIZE_SRC = readFileSync(
    resolve2(__dirname, "../app/rules/_components/position-size-copy.ts"),
    "utf8",
  );
  // Scope checks to the exported constant value only (after the JSDoc comment).
  const exportStart = POS_SIZE_SRC.indexOf("export const MAX_POSITION_SIZE_COPY");
  const EXPORTED_VALUES = POS_SIZE_SRC.slice(exportStart);

  it("hint does not mention 'order actions'", () => {
    assert.ok(
      !EXPORTED_VALUES.includes("order actions"),
      "position-size hint must not mention 'order actions'",
    );
  });

  it("hint does not mention 'detection' jargon", () => {
    assert.ok(
      !EXPORTED_VALUES.includes("detection"),
      "position-size hint must not mention 'detection'",
    );
  });

  it("hint does not mention 'sync' as a visible explanation", () => {
    assert.ok(
      !EXPORTED_VALUES.includes("during sync"),
      "position-size hint must not expose 'during sync' as customer copy",
    );
  });

  it("hint does not mention 'flatten'", () => {
    assert.ok(
      !EXPORTED_VALUES.includes("flatten"),
      "position-size hint must not mention 'flatten'",
    );
  });

  it("hint does not mention 'broker-level pre-trade block'", () => {
    assert.ok(
      !EXPORTED_VALUES.includes("broker-level pre-trade block"),
      "position-size hint must not expose 'broker-level pre-trade block'",
    );
  });

  it("hint does not mention \"Tradovate's position limit API\"", () => {
    assert.ok(
      !EXPORTED_VALUES.includes("Tradovate's position limit API"),
      "position-size hint must not expose 'Tradovate\\'s position limit API'",
    );
  });

  it("hint does not mention 'raw global contract counts'", () => {
    assert.ok(
      !EXPORTED_VALUES.includes("raw global contract counts"),
      "position-size hint must not expose 'raw global contract counts'",
    );
  });

  it("hint contains the simplified standard-equivalent explanation", () => {
    assert.ok(
      EXPORTED_VALUES.includes("Guardrail uses this limit to monitor position size"),
      "position-size hint must contain the simplified explanation",
    );
    assert.ok(
      EXPORTED_VALUES.includes("Standard-equivalent sizing lets 1 NQ equal 10 MNQ"),
      "position-size hint must explain the 1 NQ = 10 MNQ sizing",
    );
  });
});

describe("source-scan: rules forms do not expose 'Flatten' or 'order actions' as labels", () => {
  const ACCOUNT_FORM_SRC = readFileSync(
    resolve2(__dirname, "../app/rules/_components/account-rules-form.tsx"),
    "utf8",
  );
  const DEFAULT_FORM_SRC = readFileSync(
    resolve2(__dirname, "../app/rules/_components/rules-form.tsx"),
    "utf8",
  );

  for (const [name, src] of [["account form", ACCOUNT_FORM_SRC], ["default form", DEFAULT_FORM_SRC]] as const) {
    it(`${name}: cutoff label says 'Close open positions at cutoff, then lock' (not 'Flatten')`, () => {
      assert.ok(
        src.includes("Close open positions at cutoff, then lock"),
        `${name} must use 'Close open positions at cutoff, then lock'`,
      );
      assert.ok(
        !src.includes("Flatten at cutoff, then lock"),
        `${name} must not use 'Flatten at cutoff, then lock' as a visible label`,
      );
    });

    it(`${name}: cutoff hint does not say 'order actions'`, () => {
      assert.ok(
        !src.includes("order actions"),
        `${name} must not expose 'order actions' in customer copy`,
      );
    });

    it(`${name}: cutoff hint uses 'This action is not active yet'`, () => {
      assert.ok(
        src.includes("This action is not active yet"),
        `${name} must say 'This action is not active yet'`,
      );
    });
  }
});

describe("source-scan: enforcement-mode contains simplified broker risk settings copy", () => {
  const EM_SRC = readFileSync(
    resolve2(__dirname, "../app/rules/_components/enforcement-mode.ts"),
    "utf8",
  );

  it("full_access detail contains simplified Tradovate enforcement copy", () => {
    assert.ok(
      EM_SRC.includes("Daily loss and profit target can be enforced through Tradovate"),
      "enforcement-mode must contain the simplified Tradovate copy",
    );
    assert.ok(
      EM_SRC.includes("Other rules are monitored and enforced by Guardrail"),
      "enforcement-mode must contain the simplified Guardrail copy",
    );
  });

  it("full_access detail does not contain old verbose copy", () => {
    assert.ok(
      !EM_SRC.includes("can trigger Tradovate risk settings on breach"),
      "enforcement-mode must not contain old verbose trigger copy",
    );
    assert.ok(
      !EM_SRC.includes("Supported money limits can use broker risk settings"),
      "enforcement-mode must not contain repetitive 'Supported money limits' copy",
    );
  });
});

// ── Source-scan: Polish pass — account detail, dashboard, Trading Plan ─────────

import { resolve as resolve3 } from "node:path";

describe("source-scan: account detail page — final polish", () => {
  const EDIT_SRC = readFileSync(
    resolve3(__dirname, "../app/accounts/[id]/edit/page.tsx"),
    "utf8",
  );

  it("shows 'Supported rules can be protected through broker risk settings.'", () => {
    assert.ok(
      EDIT_SRC.includes("Supported rules can be protected through broker risk settings"),
      "account detail must say 'Supported rules can be protected through broker risk settings'",
    );
  });

  it("does not show old 'Broker risk settings are available for this account'", () => {
    assert.ok(
      !EDIT_SRC.includes("Broker risk settings are available for this account"),
      "old copy must be replaced",
    );
  });

  const ACCOUNT_INTERNAL_TERMS = [
    "Safety Console",
    "reconciliation",
    "InternalLockEvent",
    "listenerBrokerDedupKey",
    "rollout readiness",
    "listener-worker",
    "dedup key",
    "Intervention ID",
    "Internal lock ID",
  ];

  for (const term of ACCOUNT_INTERNAL_TERMS) {
    it(`does not expose '${term}' as visible copy`, () => {
      // Code-level identifiers (e.g. in a query variable name) are allowed;
      // check that it's not in a JSX text rendering position.
      const renderedAsText = new RegExp(`>\\s*${term}\\s*<`).test(EDIT_SRC);
      assert.ok(
        !renderedAsText,
        `account detail must not render '${term}' as visible JSX text`,
      );
    });
  }
});

describe("source-scan: dashboard uses 'Market closed' for weekend-close pill", () => {
  const CC_SRC = readFileSync(
    resolve3(__dirname, "../app/dashboard/_components/command-center/command-center.tsx"),
    "utf8",
  );

  it("isClosed checks for 'Market closed' label", () => {
    assert.ok(
      CC_SRC.includes('label === "Market closed"'),
      "command-center must compare to 'Market closed', not 'Session closed'",
    );
    assert.ok(
      !CC_SRC.includes('label === "Session closed"'),
      "command-center must not compare to old 'Session closed' label",
    );
  });
});

describe("source-scan: account rules form hides advanced block by default", () => {
  const ACCOUNT_FORM_SRC = readFileSync(
    resolve3(__dirname, "../app/rules/_components/account-rules-form.tsx"),
    "utf8",
  );

  it("Advanced broker-side contract cap block is still present in source", () => {
    assert.ok(
      ACCOUNT_FORM_SRC.includes("Advanced broker-side contract cap"),
      "advanced block must still exist in source (just collapsed by default)",
    );
  });

  it("advanced block is guarded by showAdvancedBrokerCap state (not shown by default)", () => {
    assert.ok(
      ACCOUNT_FORM_SRC.includes("showAdvancedBrokerCap"),
      "advanced block must be gated by showAdvancedBrokerCap state",
    );
    assert.ok(
      ACCOUNT_FORM_SRC.includes("Advanced options"),
      "a collapsed 'Advanced options' expand trigger must exist",
    );
  });
});

describe("source-scan: rules forms can show 'No changes to save.'", () => {
  const ACCOUNT_FORM_SRC = readFileSync(
    resolve3(__dirname, "../app/rules/_components/account-rules-form.tsx"),
    "utf8",
  );
  const DEFAULT_FORM_SRC = readFileSync(
    resolve3(__dirname, "../app/rules/_components/rules-form.tsx"),
    "utf8",
  );

  it("account form includes 'No changes to save.' helper text", () => {
    assert.ok(
      ACCOUNT_FORM_SRC.includes("No changes to save."),
      "account form must include 'No changes to save.' helper text",
    );
  });

  it("default form includes 'No changes to save.' helper text", () => {
    assert.ok(
      DEFAULT_FORM_SRC.includes("No changes to save."),
      "default form must include 'No changes to save.' helper text",
    );
  });
});

// ── Source-scan: Phase 2G beta readiness copy ─────────────────────────────────

import { resolve as resolve4 } from "node:path";

describe("source-scan: Tradovate connect page — OAuth redirect warning", () => {
  const CONNECT_CLIENT_SRC = readFileSync(
    resolve4(
      __dirname,
      "../app/accounts/connect/tradovate/_components/connect-tradovate-client.tsx",
    ),
    "utf8",
  );

  it("includes explicit redirect-to-Tradovate warning near the submit button", () => {
    assert.ok(
      CONNECT_CLIENT_SRC.includes("redirected to Tradovate"),
      "connect page must warn the user they will be redirected to Tradovate before they click",
    );
  });

  it("includes return-to-Guardrail copy after authorization", () => {
    assert.ok(
      CONNECT_CLIENT_SRC.includes("return here to choose which accounts"),
      "connect page must explain the user returns to Guardrail after authorization",
    );
  });
});

describe("source-scan: Tradovate connect page — monitoring-first disclosure", () => {
  const CONNECT_CLIENT_SRC = readFileSync(
    resolve4(
      __dirname,
      "../app/accounts/connect/tradovate/_components/connect-tradovate-client.tsx",
    ),
    "utf8",
  );

  it("says Guardrail starts in monitoring mode", () => {
    assert.ok(
      CONNECT_CLIENT_SRC.includes("starts in monitoring mode"),
      "connect page must say Guardrail starts in monitoring mode before showing access level options",
    );
  });

  it("says advanced protections are only used when explicitly turned on", () => {
    assert.ok(
      CONNECT_CLIENT_SRC.includes("only used when you explicitly turn them on"),
      "connect page must state broker-side protections are opt-in, not on by default",
    );
  });

  it("does not use the word 'flatten'", () => {
    assert.ok(
      !CONNECT_CLIENT_SRC.includes("flatten"),
      "connect page must not use internal 'flatten' term in customer copy",
    );
  });
});

describe("source-scan: Tradovate rules assignment page — simplified broker disclosure", () => {
  const RULES_ASSIGN_SRC = readFileSync(
    resolve4(__dirname, "../app/accounts/connect/tradovate/rules/page.tsx"),
    "utf8",
  );

  it("says broker actions are never on by default", () => {
    assert.ok(
      RULES_ASSIGN_SRC.includes("never on by default"),
      "rules assignment footer must say broker actions are not on by default",
    );
  });

  it("does not say 'close open positions'", () => {
    assert.ok(
      !RULES_ASSIGN_SRC.includes("close open positions"),
      "rules assignment footer must not use scary position-closing language",
    );
  });

  it("does not say 'daily lockout'", () => {
    assert.ok(
      !RULES_ASSIGN_SRC.includes("daily lockout"),
      "rules assignment footer must not use internal 'daily lockout' jargon",
    );
  });

  it("does not use the word 'flatten'", () => {
    assert.ok(
      !RULES_ASSIGN_SRC.includes("flatten"),
      "rules assignment page must not expose 'flatten' to customers",
    );
  });
});

describe("source-scan: webhook setup — beta-friendly secret copy", () => {
  const DIAGNOSTICS_SRC = readFileSync(
    resolve4(
      __dirname,
      "../app/accounts/[id]/edit/_components/diagnostics-panel.tsx",
    ),
    "utf8",
  );

  it("does not say 'Ask your administrator'", () => {
    assert.ok(
      !DIAGNOSTICS_SRC.includes("Ask your administrator"),
      "webhook setup must not tell solo beta users to ask an administrator",
    );
  });

  it("references 'contact support' for webhook secret help", () => {
    assert.ok(
      DIAGNOSTICS_SRC.includes("contact support"),
      "webhook setup must point users to support if they don't have the secret",
    );
  });

  it("includes beta-friendly guidance about confirming the secret", () => {
    assert.ok(
      DIAGNOSTICS_SRC.includes("beta"),
      "webhook setup must include beta-specific guidance about the secret",
    );
  });
});
