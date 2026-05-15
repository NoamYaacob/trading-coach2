/**
 * Phase 2C-C: unit tests for evaluateBrokerEnforcementGates — pure gate helper.
 *
 * Safety properties verified:
 *   - BROKER_ENFORCEMENT_ENABLED=false → every call blocked (feature flag gate)
 *   - Live listener enabled → blocked (Phase 2C demo-only gate)
 *   - Non-demo env → blocked
 *   - Account not in allowlist → blocked
 *   - Non-eligible rule (trade_limit, max_loss_streak) → blocked
 *   - Inactive / missing-from-broker account → blocked
 *   - Non-live connection status → blocked
 *   - permissionLevel != "full_access" → blocked
 *   - No active InternalLockEvent → blocked
 *   - Duplicate dedup key → blocked
 *   - All gates pass → allowed with correct payload preview
 *   - Source-scan: no flatten, cancel, order, broker write calls anywhere
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  evaluateBrokerEnforcementGates,
  parseBrokerEnforcementAllowlist,
  type BrokerEnforcementGateInput,
} from "./broker-enforcement-gate.ts";

const root = resolve(import.meta.dirname, "../../..");
function readSrc(rel: string) {
  return readFileSync(resolve(root, rel), "utf8");
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<BrokerEnforcementGateInput> = {}): BrokerEnforcementGateInput {
  return {
    brokerEnforcementEnabled: true,
    listenerLiveEnabled: false,
    allowlistAccountIds: ["acc1"],
    accountId: "acc1",
    env: "demo",
    isActive: true,
    missingFromBroker: false,
    connectionStatus: "connected",
    permissionLevel: "full_access",
    activeInternalLockEventId: "lock-event-99",
    ruleType: "daily_loss_limit",
    observedAmount: -250.0,
    tradingDay: "2026-05-15",
    existingInterventionWithDedupKey: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Gate 1: BROKER_ENFORCEMENT_ENABLED flag
// ---------------------------------------------------------------------------

describe("Gate 1 — BROKER_ENFORCEMENT_ENABLED", () => {
  it("blocks when flag is false", () => {
    const result = evaluateBrokerEnforcementGates(makeInput({ brokerEnforcementEnabled: false }));
    assert.equal(result.allowed, false);
    assert.ok(result.skipReason?.includes("BROKER_ENFORCEMENT_ENABLED"), `skipReason: ${result.skipReason}`);
  });

  it("flag=false overrides all other passing conditions", () => {
    const result = evaluateBrokerEnforcementGates(makeInput({
      brokerEnforcementEnabled: false,
      env: "demo",
      ruleType: "daily_loss_limit",
      permissionLevel: "full_access",
    }));
    assert.equal(result.allowed, false);
    assert.equal(result.brokerActionType, null);
    assert.equal(result.payloadPreview, null);
  });

  it("dedupKey is always present even when blocked", () => {
    const result = evaluateBrokerEnforcementGates(makeInput({ brokerEnforcementEnabled: false }));
    assert.ok(result.dedupKey.length > 0);
    assert.ok(result.dedupKey.endsWith(":broker_enforcement"), `dedupKey: ${result.dedupKey}`);
  });
});

// ---------------------------------------------------------------------------
// Gate 2: TRADOVATE_LISTENER_ENABLE_LIVE must be false
// ---------------------------------------------------------------------------

describe("Gate 2 — TRADOVATE_LISTENER_ENABLE_LIVE must be false", () => {
  it("blocks when live listener is enabled", () => {
    const result = evaluateBrokerEnforcementGates(makeInput({ listenerLiveEnabled: true }));
    assert.equal(result.allowed, false);
    assert.ok(result.skipReason?.includes("TRADOVATE_LISTENER_ENABLE_LIVE"), `skipReason: ${result.skipReason}`);
  });

  it("live listener enabled overrides demo env", () => {
    const result = evaluateBrokerEnforcementGates(makeInput({
      listenerLiveEnabled: true,
      env: "demo",
    }));
    assert.equal(result.allowed, false);
  });
});

// ---------------------------------------------------------------------------
// Gate 3: env must be "demo"
// ---------------------------------------------------------------------------

describe("Gate 3 — env must be demo", () => {
  it("blocks live accounts", () => {
    const result = evaluateBrokerEnforcementGates(makeInput({ env: "live" }));
    assert.equal(result.allowed, false);
    assert.ok(result.skipReason?.includes("live"), `skipReason: ${result.skipReason}`);
  });

  it("blocks unknown env", () => {
    const result = evaluateBrokerEnforcementGates(makeInput({ env: "staging" }));
    assert.equal(result.allowed, false);
    assert.ok(result.skipReason?.includes("staging"), `skipReason: ${result.skipReason}`);
  });

  it("blocks empty string env", () => {
    const result = evaluateBrokerEnforcementGates(makeInput({ env: "" }));
    assert.equal(result.allowed, false);
  });
});

// ---------------------------------------------------------------------------
// Gate 4: account must be in allowlist
// ---------------------------------------------------------------------------

describe("Gate 4 — allowlist", () => {
  it("blocks accounts not in the allowlist", () => {
    const result = evaluateBrokerEnforcementGates(makeInput({
      allowlistAccountIds: ["other-account"],
      accountId: "acc1",
    }));
    assert.equal(result.allowed, false);
    assert.ok(result.skipReason?.includes("acc1"), `skipReason: ${result.skipReason}`);
    assert.ok(result.skipReason?.includes("BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST"), `skipReason: ${result.skipReason}`);
  });

  it("blocks when allowlist is empty", () => {
    const result = evaluateBrokerEnforcementGates(makeInput({ allowlistAccountIds: [] }));
    assert.equal(result.allowed, false);
  });

  it("passes when account is in the allowlist", () => {
    const result = evaluateBrokerEnforcementGates(makeInput({
      allowlistAccountIds: ["acc1", "acc2"],
      accountId: "acc1",
    }));
    assert.equal(result.allowed, true);
  });
});

// ---------------------------------------------------------------------------
// Gate 5: rule eligibility
// ---------------------------------------------------------------------------

describe("Gate 5 — rule eligibility (trade_limit and max_loss_streak are internal-only)", () => {
  it("blocks trade_limit — no Tradovate API endpoint", () => {
    const result = evaluateBrokerEnforcementGates(makeInput({ ruleType: "trade_limit" }));
    assert.equal(result.allowed, false);
    assert.ok(result.skipReason?.includes("trade_limit"), `skipReason: ${result.skipReason}`);
    assert.ok(result.skipReason?.includes("internal lock only"), `skipReason: ${result.skipReason}`);
  });

  it("blocks max_loss_streak — no Tradovate API endpoint", () => {
    const result = evaluateBrokerEnforcementGates(makeInput({ ruleType: "max_loss_streak" }));
    assert.equal(result.allowed, false);
    assert.ok(result.skipReason?.includes("max_loss_streak"), `skipReason: ${result.skipReason}`);
  });

  it("blocks unknown rule types", () => {
    const result = evaluateBrokerEnforcementGates(makeInput({ ruleType: "unknown_rule" }));
    assert.equal(result.allowed, false);
  });

  it("allows daily_loss_limit — the only eligible rule in Phase 2C", () => {
    const result = evaluateBrokerEnforcementGates(makeInput({ ruleType: "daily_loss_limit" }));
    assert.equal(result.allowed, true);
  });
});

// ---------------------------------------------------------------------------
// Gate 6: account availability
// ---------------------------------------------------------------------------

describe("Gate 6 — account availability", () => {
  it("blocks inactive accounts", () => {
    const result = evaluateBrokerEnforcementGates(makeInput({ isActive: false }));
    assert.equal(result.allowed, false);
    assert.ok(result.skipReason?.includes("inactive"), `skipReason: ${result.skipReason}`);
  });

  it("blocks accounts missing from broker", () => {
    const result = evaluateBrokerEnforcementGates(makeInput({ missingFromBroker: true }));
    assert.equal(result.allowed, false);
    assert.ok(result.skipReason?.includes("missingFromBrokerSince"), `skipReason: ${result.skipReason}`);
  });

  it("inactive + missing both block", () => {
    // isActive=false is checked first
    const result = evaluateBrokerEnforcementGates(makeInput({ isActive: false, missingFromBroker: true }));
    assert.equal(result.allowed, false);
  });
});

// ---------------------------------------------------------------------------
// Gate 7: connection liveness
// ---------------------------------------------------------------------------

describe("Gate 7 — connection liveness", () => {
  const nonLiveStatuses = [
    "expired",
    "connection_error",
    "not_connected",
    "pending_webhook",
    "oauth_pending_storage",
  ];

  for (const status of nonLiveStatuses) {
    it(`blocks status '${status}'`, () => {
      const result = evaluateBrokerEnforcementGates(makeInput({ connectionStatus: status }));
      assert.equal(result.allowed, false);
      assert.ok(result.skipReason?.includes(status), `skipReason: ${result.skipReason}`);
    });
  }

  it("blocks null connectionStatus (treated as not_connected)", () => {
    const result = evaluateBrokerEnforcementGates(makeInput({ connectionStatus: null }));
    assert.equal(result.allowed, false);
  });

  it("allows 'connected' status", () => {
    const result = evaluateBrokerEnforcementGates(makeInput({ connectionStatus: "connected" }));
    assert.equal(result.allowed, true);
  });

  it("allows 'live' status", () => {
    const result = evaluateBrokerEnforcementGates(makeInput({ connectionStatus: "live" }));
    assert.equal(result.allowed, true);
  });
});

// ---------------------------------------------------------------------------
// Gate 8: permission level
// ---------------------------------------------------------------------------

describe("Gate 8 — permissionLevel must be full_access", () => {
  it("blocks read_only permission", () => {
    const result = evaluateBrokerEnforcementGates(makeInput({ permissionLevel: "read_only" }));
    assert.equal(result.allowed, false);
    assert.ok(result.skipReason?.includes("read_only"), `skipReason: ${result.skipReason}`);
    assert.ok(result.skipReason?.includes("insufficient"), `skipReason: ${result.skipReason}`);
  });

  it("blocks null permission", () => {
    const result = evaluateBrokerEnforcementGates(makeInput({ permissionLevel: null }));
    assert.equal(result.allowed, false);
    assert.ok(result.skipReason?.includes("unknown"), `skipReason: ${result.skipReason}`);
  });

  it("blocks unknown permission level", () => {
    const result = evaluateBrokerEnforcementGates(makeInput({ permissionLevel: "partial" }));
    assert.equal(result.allowed, false);
  });

  it("allows full_access", () => {
    const result = evaluateBrokerEnforcementGates(makeInput({ permissionLevel: "full_access" }));
    assert.equal(result.allowed, true);
  });
});

// ---------------------------------------------------------------------------
// Gate 9: active InternalLockEvent must exist
// ---------------------------------------------------------------------------

describe("Gate 9 — active InternalLockEvent must exist", () => {
  it("blocks when no active lock event", () => {
    const result = evaluateBrokerEnforcementGates(makeInput({ activeInternalLockEventId: null }));
    assert.equal(result.allowed, false);
    assert.ok(result.skipReason?.includes("InternalLockEvent"), `skipReason: ${result.skipReason}`);
    assert.ok(result.skipReason?.includes("Phase 2B precondition"), `skipReason: ${result.skipReason}`);
  });

  it("allows when active lock event exists", () => {
    const result = evaluateBrokerEnforcementGates(makeInput({ activeInternalLockEventId: "lock-99" }));
    assert.equal(result.allowed, true);
  });
});

// ---------------------------------------------------------------------------
// Gate 10: idempotency — no duplicate GuardianIntervention
// ---------------------------------------------------------------------------

describe("Gate 10 — idempotency", () => {
  it("blocks duplicate GuardianIntervention with same dedup key", () => {
    const result = evaluateBrokerEnforcementGates(makeInput({ existingInterventionWithDedupKey: true }));
    assert.equal(result.allowed, false);
    assert.ok(result.skipReason?.includes("already exists"), `skipReason: ${result.skipReason}`);
    assert.ok(result.skipReason?.includes("at-most-once"), `skipReason: ${result.skipReason}`);
  });

  it("allowed = true blocks broker write for duplicate — idempotency gate protects at-most-once invariant", () => {
    const result = evaluateBrokerEnforcementGates(makeInput({ existingInterventionWithDedupKey: true }));
    assert.equal(result.allowed, false);
    assert.equal(result.brokerActionType, null);
  });

  it("allows when no existing intervention", () => {
    const result = evaluateBrokerEnforcementGates(makeInput({ existingInterventionWithDedupKey: false }));
    assert.equal(result.allowed, true);
  });
});

// ---------------------------------------------------------------------------
// All gates pass — happy path
// ---------------------------------------------------------------------------

describe("All gates pass", () => {
  it("returns allowed=true with payload preview", () => {
    const result = evaluateBrokerEnforcementGates(makeInput());
    assert.equal(result.allowed, true);
    assert.equal(result.skipReason, null);
    assert.ok(result.payloadPreview != null, "payloadPreview must not be null when allowed");
    assert.ok(result.brokerActionType != null, "brokerActionType must not be null when allowed");
  });

  it("payload preview contains dailyLossAutoLiq", () => {
    const result = evaluateBrokerEnforcementGates(makeInput({ observedAmount: -300 }));
    assert.ok(result.allowed);
    assert.ok("dailyLossAutoLiq" in (result.payloadPreview ?? {}));
    const lossAmount = result.payloadPreview?.dailyLossAutoLiq as number;
    assert.ok(lossAmount >= 0, "dailyLossAutoLiq must be non-negative");
    assert.equal(lossAmount, 300);
  });

  it("payload preview contains changesLocked: true", () => {
    const result = evaluateBrokerEnforcementGates(makeInput());
    assert.equal(result.payloadPreview?.changesLocked, true);
  });

  it("payload preview does NOT contain doNotUnlock (would permanently trap account)", () => {
    const result = evaluateBrokerEnforcementGates(makeInput());
    assert.ok(!("doNotUnlock" in (result.payloadPreview ?? {})), "doNotUnlock must not be set — it would permanently trap the account");
  });

  it("payload preview _note confirms no request was sent", () => {
    const result = evaluateBrokerEnforcementGates(makeInput());
    const note = result.payloadPreview?._note as string;
    assert.ok(typeof note === "string" && note.length > 0, "_note must be present");
    assert.ok(note.includes("no Tradovate request sent"), `_note: ${note}`);
  });

  it("brokerActionType references userAccountAutoLiq", () => {
    const result = evaluateBrokerEnforcementGates(makeInput());
    assert.ok(result.brokerActionType?.includes("userAccountAutoLiq"), `brokerActionType: ${result.brokerActionType}`);
  });

  it("dedupKey ends with :broker_enforcement suffix", () => {
    const result = evaluateBrokerEnforcementGates(makeInput());
    assert.ok(result.dedupKey.endsWith(":broker_enforcement"), `dedupKey: ${result.dedupKey}`);
    assert.ok(result.dedupKey.includes("acc1"), `dedupKey: ${result.dedupKey}`);
    assert.ok(result.dedupKey.includes("daily_loss_limit"), `dedupKey: ${result.dedupKey}`);
    assert.ok(result.dedupKey.includes("2026-05-15"), `dedupKey: ${result.dedupKey}`);
  });

  it("dailyLossAutoLiq is 0 when observedAmount is null", () => {
    const result = evaluateBrokerEnforcementGates(makeInput({ observedAmount: null }));
    assert.ok(result.allowed);
    assert.equal(result.payloadPreview?.dailyLossAutoLiq, 0);
  });

  it("dailyLossAutoLiq is 0 when observedAmount is 0 (no loss)", () => {
    const result = evaluateBrokerEnforcementGates(makeInput({ observedAmount: 0 }));
    assert.ok(result.allowed);
    assert.equal(result.payloadPreview?.dailyLossAutoLiq, 0);
  });

  it("dailyLossAutoLiq takes absolute value (observedAmount may be negative)", () => {
    const result = evaluateBrokerEnforcementGates(makeInput({ observedAmount: -500 }));
    assert.ok(result.allowed);
    assert.equal(result.payloadPreview?.dailyLossAutoLiq, 500);
  });
});

// ---------------------------------------------------------------------------
// parseBrokerEnforcementAllowlist
// ---------------------------------------------------------------------------

describe("parseBrokerEnforcementAllowlist", () => {
  it("parses comma-separated account ids", () => {
    const result = parseBrokerEnforcementAllowlist("acc1,acc2,acc3");
    assert.deepEqual(result, ["acc1", "acc2", "acc3"]);
  });

  it("trims whitespace", () => {
    const result = parseBrokerEnforcementAllowlist(" acc1 , acc2 ");
    assert.deepEqual(result, ["acc1", "acc2"]);
  });

  it("returns empty array for undefined", () => {
    assert.deepEqual(parseBrokerEnforcementAllowlist(undefined), []);
  });

  it("returns empty array for empty string", () => {
    assert.deepEqual(parseBrokerEnforcementAllowlist(""), []);
  });

  it("returns empty array for whitespace-only string", () => {
    assert.deepEqual(parseBrokerEnforcementAllowlist("  "), []);
  });

  it("handles single entry", () => {
    assert.deepEqual(parseBrokerEnforcementAllowlist("acc1"), ["acc1"]);
  });

  it("filters empty segments from double-comma", () => {
    const result = parseBrokerEnforcementAllowlist("acc1,,acc2");
    assert.deepEqual(result, ["acc1", "acc2"]);
  });
});

// ---------------------------------------------------------------------------
// Source-scan: gate helper is pure — no Prisma, no broker calls, no I/O
// ---------------------------------------------------------------------------

describe("broker-enforcement-gate source scan — pure helper contract", () => {
  const gateSrc = readSrc("src/lib/guardian-engine/broker-enforcement-gate.ts");

  it("does not import prisma (no DB calls)", () => {
    assert.ok(
      !gateSrc.includes("@/lib/db") && !gateSrc.includes("from \"prisma\""),
      "gate helper must be pure — no Prisma imports",
    );
  });

  it("does not import TradovateClient (no broker calls)", () => {
    assert.ok(
      !gateSrc.includes("TradovateClient"),
      "gate helper must be pure — no TradovateClient",
    );
  });

  it("does not call fetch (no HTTP)", () => {
    assert.ok(
      !gateSrc.includes("fetch("),
      "gate helper must be pure — no fetch() calls",
    );
  });

  it("does not import next/server (no Next.js coupling)", () => {
    assert.ok(
      !gateSrc.includes("next/server"),
      "gate helper must be pure — no Next.js imports",
    );
  });
});

// ---------------------------------------------------------------------------
// Source-scan: broker-enforcement-service — no direct broker calls,
// must go through triggerEnforcement only
// ---------------------------------------------------------------------------

describe("broker-enforcement-service source scan — no direct broker calls", () => {
  const serviceSrc = readSrc("src/lib/guardian-engine/broker-enforcement-service.ts");

  it("does not call userAccountAutoLiq directly", () => {
    assert.ok(
      !serviceSrc.includes("userAccountAutoLiq"),
      "service must not call Tradovate API directly — only via triggerEnforcement",
    );
  });

  it("does not flatten positions", () => {
    assert.ok(
      !serviceSrc.includes("liquidate") && !serviceSrc.includes("flatten"),
      "service must not flatten positions",
    );
  });

  it("does not cancel orders", () => {
    assert.ok(
      !serviceSrc.includes("cancelOrder") && !serviceSrc.includes("cancel_order"),
      "service must not cancel orders",
    );
  });

  it("does not place orders", () => {
    assert.ok(
      !serviceSrc.includes("placeOrder") && !serviceSrc.includes("place_order"),
      "service must not place orders",
    );
  });

  it("calls evaluateBrokerEnforcementGates", () => {
    assert.ok(
      serviceSrc.includes("evaluateBrokerEnforcementGates"),
      "service must use the gate helper before any broker action",
    );
  });

  it("calls triggerEnforcement only when gateResult.allowed is true", () => {
    assert.ok(
      serviceSrc.includes("triggerEnforcement"),
      "service must call triggerEnforcement (not a direct Tradovate call)",
    );
    assert.ok(
      serviceSrc.includes("gateResult.allowed"),
      "service must check gateResult.allowed before calling triggerEnforcement",
    );
  });
});

// ---------------------------------------------------------------------------
// Source-scan: listener worker still has no broker write path
// ---------------------------------------------------------------------------

describe("listener worker source scan — no broker write unless gate helper passes", () => {
  const listenerSrc = readSrc("scripts/tradovate-listener-worker.ts");

  it("does not call applyBrokerDayLockout directly", () => {
    assert.ok(
      !listenerSrc.includes("applyBrokerDayLockout("),
      "listener must not call applyBrokerDayLockout directly",
    );
  });

  it("does not call userAccountAutoLiq", () => {
    assert.ok(
      !listenerSrc.includes("userAccountAutoLiq"),
      "listener must not call Tradovate userAccountAutoLiq endpoint",
    );
  });

  it("does not flatten positions", () => {
    assert.ok(
      !listenerSrc.includes("liquidate") && !listenerSrc.includes("flattenPositions"),
      "listener must not flatten positions",
    );
  });

  it("does not cancel orders", () => {
    assert.ok(
      !listenerSrc.includes("cancelOrder"),
      "listener must not cancel orders",
    );
  });
});
