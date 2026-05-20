import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { simulateBrokerEnforcement } from "./broker-enforcement-simulation.ts";
import type { SimulationInput } from "./broker-enforcement-simulation.ts";

const root = resolve(import.meta.dirname, "../../..");

function readSrc(rel: string) {
  return readFileSync(resolve(root, rel), "utf8");
}

// ---------------------------------------------------------------------------
// Base valid input — daily_loss_limit on a demo account with full_access
// ---------------------------------------------------------------------------

const BASE_INPUT: SimulationInput = {
  accountId: "acc1",
  internalLockEventId: "lock1",
  ruleType: "daily_loss_limit",
  env: "demo",
  connectionStatus: "connected",
  permissionLevel: "full_access",
  externalAccountId: "123456",
  observedAmount: 250.5,
  tradingDay: "2026-05-15",
};

// ---------------------------------------------------------------------------
// Pure helper: simulateBrokerEnforcement
// ---------------------------------------------------------------------------

describe("simulateBrokerEnforcement — broker-eligible cases", () => {
  it("daily_loss_limit demo full_access is broker-eligible", () => {
    const result = simulateBrokerEnforcement(BASE_INPUT);
    assert.equal(result.brokerEligible, true);
    assert.equal(result.ruleType, "daily_loss_limit");
    assert.ok(result.wouldBrokerActionType?.includes("userAccountAutoLiq"));
    assert.equal(result.skipReason, null);
    assert.equal(result.brokerActionTaken, false);
    assert.equal(result.simulationOnly, true);
  });

  it("simulatedPayloadPreview includes dailyLossAutoLiq from observedAmount", () => {
    const result = simulateBrokerEnforcement(BASE_INPUT);
    assert.ok(result.simulatedPayloadPreview != null);
    assert.equal(result.simulatedPayloadPreview.dailyLossAutoLiq, 250.5);
    assert.equal(result.simulatedPayloadPreview.changesLocked, true);
  });

  it("simulatedPayloadPreview has _note field confirming simulation", () => {
    const result = simulateBrokerEnforcement(BASE_INPUT);
    assert.ok(typeof result.simulatedPayloadPreview?._note === "string");
    assert.ok(result.simulatedPayloadPreview._note.toLowerCase().includes("simulation"));
  });

  it("simulatedPayloadPreview does not include doNotUnlock", () => {
    const result = simulateBrokerEnforcement(BASE_INPUT);
    assert.ok(!("doNotUnlock" in (result.simulatedPayloadPreview ?? {})));
  });

  it("dedup key follows broker_enforcement format", () => {
    const result = simulateBrokerEnforcement(BASE_INPUT);
    assert.equal(result.listenerBrokerDedupKey, "acc1:daily_loss_limit:2026-05-15:broker_enforcement");
  });

  it("observedAmount=null produces lossAmountToSet=0", () => {
    const result = simulateBrokerEnforcement({ ...BASE_INPUT, observedAmount: null });
    assert.equal(result.simulatedPayloadPreview?.dailyLossAutoLiq, 0);
  });

  it("negative observedAmount is converted to positive", () => {
    const result = simulateBrokerEnforcement({ ...BASE_INPUT, observedAmount: -150 });
    assert.equal(result.simulatedPayloadPreview?.dailyLossAutoLiq, 150);
  });
});

describe("simulateBrokerEnforcement — live account gate", () => {
  it("live env is skipped", () => {
    const result = simulateBrokerEnforcement({ ...BASE_INPUT, env: "live" });
    assert.equal(result.brokerEligible, false);
    assert.ok(result.skipReason?.toLowerCase().includes("not demo") || result.skipReason?.toLowerCase().includes("live"));
    assert.equal(result.simulatedPayloadPreview, null);
    assert.equal(result.brokerActionTaken, false);
    assert.equal(result.simulationOnly, true);
  });

  it("unknown env is skipped", () => {
    const result = simulateBrokerEnforcement({ ...BASE_INPUT, env: "unknown" });
    assert.equal(result.brokerEligible, false);
    assert.equal(result.simulatedPayloadPreview, null);
  });
});

describe("simulateBrokerEnforcement — rule type gate", () => {
  it("trade_limit is not broker-eligible", () => {
    const result = simulateBrokerEnforcement({ ...BASE_INPUT, ruleType: "trade_limit" });
    assert.equal(result.brokerEligible, false);
    assert.ok(result.skipReason?.includes("trade_limit"));
    assert.ok(result.skipReason?.includes("internal lock only") || result.skipReason?.includes("no applicable"));
    assert.equal(result.simulatedPayloadPreview, null);
    assert.equal(result.brokerActionTaken, false);
  });

  it("max_loss_streak is not broker-eligible", () => {
    const result = simulateBrokerEnforcement({ ...BASE_INPUT, ruleType: "max_loss_streak" });
    assert.equal(result.brokerEligible, false);
    assert.ok(result.skipReason?.includes("max_loss_streak"));
    assert.equal(result.simulatedPayloadPreview, null);
  });

  it("consecutive_losses is not broker-eligible", () => {
    const result = simulateBrokerEnforcement({ ...BASE_INPUT, ruleType: "consecutive_losses" });
    assert.equal(result.brokerEligible, false);
    assert.equal(result.simulatedPayloadPreview, null);
  });

  it("manual is not broker-eligible", () => {
    const result = simulateBrokerEnforcement({ ...BASE_INPUT, ruleType: "manual" });
    assert.equal(result.brokerEligible, false);
    assert.equal(result.simulatedPayloadPreview, null);
  });
});

describe("simulateBrokerEnforcement — connection status gate", () => {
  const NON_LIVE = ["expired", "connection_error", "not_connected", "pending_webhook", "oauth_pending_storage"];
  for (const status of NON_LIVE) {
    it(`connectionStatus '${status}' is skipped`, () => {
      const result = simulateBrokerEnforcement({ ...BASE_INPUT, connectionStatus: status });
      assert.equal(result.brokerEligible, false);
      assert.ok(result.skipReason?.includes(status));
      assert.equal(result.simulatedPayloadPreview, null);
    });
  }

  it("null connectionStatus is skipped", () => {
    const result = simulateBrokerEnforcement({ ...BASE_INPUT, connectionStatus: null });
    assert.equal(result.brokerEligible, false);
    assert.equal(result.simulatedPayloadPreview, null);
  });
});

describe("simulateBrokerEnforcement — permission gate", () => {
  it("read_only permission is skipped", () => {
    const result = simulateBrokerEnforcement({ ...BASE_INPUT, permissionLevel: "read_only" });
    assert.equal(result.brokerEligible, false);
    assert.ok(result.skipReason?.toLowerCase().includes("permission") || result.skipReason?.toLowerCase().includes("insufficient"));
    assert.equal(result.simulatedPayloadPreview, null);
  });

  it("null permissionLevel is skipped", () => {
    const result = simulateBrokerEnforcement({ ...BASE_INPUT, permissionLevel: null });
    assert.equal(result.brokerEligible, false);
    assert.equal(result.simulatedPayloadPreview, null);
  });

  it("unknown permissionLevel is skipped", () => {
    const result = simulateBrokerEnforcement({ ...BASE_INPUT, permissionLevel: "connected_readonly" });
    assert.equal(result.brokerEligible, false);
    assert.equal(result.simulatedPayloadPreview, null);
  });
});

describe("simulateBrokerEnforcement — output invariants", () => {
  it("brokerActionTaken is always false regardless of eligibility", () => {
    const eligible = simulateBrokerEnforcement(BASE_INPUT);
    const ineligible = simulateBrokerEnforcement({ ...BASE_INPUT, ruleType: "trade_limit" });
    assert.equal(eligible.brokerActionTaken, false);
    assert.equal(ineligible.brokerActionTaken, false);
  });

  it("simulationOnly is always true regardless of eligibility", () => {
    const eligible = simulateBrokerEnforcement(BASE_INPUT);
    const ineligible = simulateBrokerEnforcement({ ...BASE_INPUT, env: "live" });
    assert.equal(eligible.simulationOnly, true);
    assert.equal(ineligible.simulationOnly, true);
  });

  it("dedup key is stable across calls", () => {
    const a = simulateBrokerEnforcement(BASE_INPUT);
    const b = simulateBrokerEnforcement(BASE_INPUT);
    assert.equal(a.listenerBrokerDedupKey, b.listenerBrokerDedupKey);
  });

  it("dedup key differs from Phase 2A dry-run key", () => {
    const result = simulateBrokerEnforcement(BASE_INPUT);
    const dryRunKey = `acc1:daily_loss_limit:2026-05-15:dry_run`;
    assert.notEqual(result.listenerBrokerDedupKey, dryRunKey);
  });

  it("gate order: live check before rule check", () => {
    // live + ineligible rule → still skipped as live (live check fires first)
    const result = simulateBrokerEnforcement({ ...BASE_INPUT, env: "live", ruleType: "trade_limit" });
    assert.equal(result.brokerEligible, false);
    assert.ok(result.skipReason?.toLowerCase().includes("not demo") || result.skipReason?.toLowerCase().includes("live"));
  });
});

// ---------------------------------------------------------------------------
// Source-scan: simulation helper — pure, no DB/broker
// ---------------------------------------------------------------------------

describe("broker-enforcement-simulation.ts — pure helper, no side effects", () => {
  const src = readSrc("src/lib/guardian-engine/broker-enforcement-simulation.ts");

  it("does not import prisma", () => {
    assert.ok(!src.includes("prisma"), "simulation helper must not import prisma");
  });

  it("does not import next/server", () => {
    assert.ok(!src.includes("next/server"), "simulation helper must not import next/server");
  });

  it("does not import enforcement functions (applyBrokerDayLockout, triggerEnforcement)", () => {
    // Verify the broker enforcement orchestration module is not imported at all.
    // Function names may legitimately appear in comments; importing the module is what enables calls.
    assert.ok(
      !src.includes("from \"../../brokers/enforcement\"") &&
      !src.includes("from '../brokers/enforcement'") &&
      !src.includes("from \"../brokers/enforcement\"") &&
      !src.includes("brokers/enforcement"),
      "simulation helper must not import from brokers/enforcement",
    );
  });

  it("does not call userAccountAutoLiq as a function", () => {
    // The endpoint name string may appear as a return value label — that is expected.
    // What must not happen is a direct function call: applyDailyLossLock() requires TradovateClient.
    // We verify TradovateClient is absent (it is the only way to reach the Tradovate API).
    assert.ok(!src.includes("TradovateClient"), "simulation helper must not import TradovateClient");
    // Also verify no direct HTTP call patterns
    assert.ok(!src.includes("fetch(") && !src.includes(".post("), "simulation helper must not make HTTP calls");
  });

  it("does not import TradovateClient", () => {
    assert.ok(!src.includes("TradovateClient"), "simulation helper must not import TradovateClient");
  });
});

// ---------------------------------------------------------------------------
// Source-scan: simulation route — read-only, no broker writes
// ---------------------------------------------------------------------------

describe("broker-enforcement-simulation route — read-only", () => {
  const routeSrc = readSrc("src/app/api/debug/broker-enforcement-simulation/route.ts");

  it("checks BROKER_ENFORCEMENT_SIMULATION_ENABLED flag", () => {
    assert.ok(
      routeSrc.includes("BROKER_ENFORCEMENT_SIMULATION_ENABLED"),
      "route must check BROKER_ENFORCEMENT_SIMULATION_ENABLED",
    );
  });

  it("requires x-cron-secret auth", () => {
    assert.ok(routeSrc.includes("x-cron-secret"), "route must check x-cron-secret header");
  });

  it("does not call any broker API", () => {
    for (const call of ["applyBrokerDayLockout", "triggerEnforcement", "userAccountAutoLiq(", "liquidatepositions", "cancelorder"]) {
      assert.ok(!routeSrc.includes(call), `route must not call ${call}`);
    }
  });

  it("does not create GuardianIntervention rows", () => {
    assert.ok(
      !routeSrc.includes("guardianIntervention.create"),
      "route must not create GuardianIntervention rows",
    );
  });

  it("does not update GuardianIntervention rows", () => {
    assert.ok(
      !routeSrc.includes("guardianIntervention.update"),
      "route must not update GuardianIntervention rows",
    );
  });

  it("does not create InternalLockEvent rows", () => {
    assert.ok(
      !routeSrc.includes("internalLockEvent.create"),
      "route must not create InternalLockEvent rows",
    );
  });

  it("response says simulation only and no broker action", () => {
    assert.ok(routeSrc.includes("simulationOnly"), "route must indicate simulationOnly in response");
    assert.ok(routeSrc.includes("no Tradovate request was sent"), "route note must state no broker action");
  });

  it("brokerEnforcementEnabled is reported as false", () => {
    assert.ok(
      routeSrc.includes("brokerEnforcementEnabled: false"),
      "route must report brokerEnforcementEnabled=false",
    );
  });
});

// ---------------------------------------------------------------------------
// Source-scan: listener worker still has no broker enforcement
// ---------------------------------------------------------------------------

describe("listener worker — still no broker enforcement after Phase 2C-B", () => {
  const listenerSrc = readSrc("scripts/tradovate-listener-worker.ts");

  it("does not call applyBrokerDayLockout", () => {
    assert.ok(!listenerSrc.includes("applyBrokerDayLockout"));
  });

  it("does not call triggerEnforcement", () => {
    assert.ok(!listenerSrc.includes("triggerEnforcement"));
  });

  it("does not call userAccountAutoLiq", () => {
    assert.ok(!listenerSrc.includes("userAccountAutoLiq"));
  });

  it("does not call simulateBrokerEnforcement from the listener", () => {
    assert.ok(
      !listenerSrc.includes("simulateBrokerEnforcement"),
      "simulation is for the debug endpoint only — not wired into the listener",
    );
  });
});
