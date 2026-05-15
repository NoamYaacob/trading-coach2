import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  deriveOverallSeverity,
  deriveSafetyAlerts,
  isAccountRolloutRelevant,
  isConnectionRolloutRelevant,
  readEnforcementFlagsFromEnv,
  resolveListenerFlags,
  type EnforcementFlags,
  type ListenerWorkerStatusRecord,
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
