import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildListenerBrokerDedupKey } from "./broker-enforcement-dedup.ts";

const root = resolve(import.meta.dirname, "../../..");

function readSrc(rel: string) {
  return readFileSync(resolve(root, rel), "utf8");
}

// ---------------------------------------------------------------------------
// Pure helper: buildListenerBrokerDedupKey
// ---------------------------------------------------------------------------

describe("buildListenerBrokerDedupKey", () => {
  it("produces the expected key format", () => {
    const key = buildListenerBrokerDedupKey("acc1", "daily_loss_limit", "2026-05-15");
    assert.equal(key, "acc1:daily_loss_limit:2026-05-15:broker_enforcement");
  });

  it("ends with :broker_enforcement suffix", () => {
    const key = buildListenerBrokerDedupKey("acc1", "trade_limit", "2026-05-15");
    assert.ok(key.endsWith(":broker_enforcement"), `key did not end with :broker_enforcement — got ${key}`);
  });

  it("is deterministic — same inputs produce same key", () => {
    const a = buildListenerBrokerDedupKey("acc99", "daily_loss_limit", "2026-05-15");
    const b = buildListenerBrokerDedupKey("acc99", "daily_loss_limit", "2026-05-15");
    assert.equal(a, b);
  });

  it("differs across accounts", () => {
    const a = buildListenerBrokerDedupKey("acc1", "daily_loss_limit", "2026-05-15");
    const b = buildListenerBrokerDedupKey("acc2", "daily_loss_limit", "2026-05-15");
    assert.notEqual(a, b);
  });

  it("differs across trigger types", () => {
    const a = buildListenerBrokerDedupKey("acc1", "daily_loss_limit", "2026-05-15");
    const b = buildListenerBrokerDedupKey("acc1", "trade_limit", "2026-05-15");
    assert.notEqual(a, b);
  });

  it("differs across trading days", () => {
    const a = buildListenerBrokerDedupKey("acc1", "daily_loss_limit", "2026-05-14");
    const b = buildListenerBrokerDedupKey("acc1", "daily_loss_limit", "2026-05-15");
    assert.notEqual(a, b);
  });

  it("does not collide with Phase 2A dry-run keys", () => {
    // Phase 2A dry-run key format: "${accountId}:${ruleType}:${tradingDay}:dry_run"
    const phaseCAKey = buildListenerBrokerDedupKey("acc1", "daily_loss_limit", "2026-05-15");
    const dryRunKey = "acc1:daily_loss_limit:2026-05-15:dry_run";
    assert.notEqual(phaseCAKey, dryRunKey);
  });
});

// ---------------------------------------------------------------------------
// Source-scan: listener worker safety invariants
// ---------------------------------------------------------------------------

describe("listener worker — no broker writes", () => {
  const listenerSrc = readSrc("scripts/tradovate-listener-worker.ts");

  it("does not call applyBrokerDayLockout", () => {
    assert.ok(
      !listenerSrc.includes("applyBrokerDayLockout"),
      "listener worker must not call applyBrokerDayLockout",
    );
  });

  it("does not call userAccountAutoLiq", () => {
    assert.ok(
      !listenerSrc.includes("userAccountAutoLiq"),
      "listener worker must not call userAccountAutoLiq",
    );
  });

  it("does not call liquidatepositions", () => {
    assert.ok(
      !listenerSrc.includes("liquidatepositions"),
      "listener worker must not call liquidatepositions",
    );
  });

  it("does not call cancelorder", () => {
    assert.ok(
      !listenerSrc.includes("cancelorder"),
      "listener worker must not call cancelorder",
    );
  });

  it("does not import triggerEnforcement directly (routes through broker-enforcement-service)", () => {
    assert.ok(
      !listenerSrc.includes("triggerEnforcement"),
      "listener worker must not reference triggerEnforcement directly — broker writes go through maybeAttemptBrokerDailyLossLockoutForInternalLock which applies all 10 gates",
    );
  });
});

// ---------------------------------------------------------------------------
// Source-scan: internal-lock-evaluator-db — no broker writes
// ---------------------------------------------------------------------------

describe("internal-lock-evaluator-db — no broker writes", () => {
  const dbSrc = readSrc("src/lib/guardian-engine/internal-lock-evaluator-db.ts");

  it("does not call applyBrokerDayLockout", () => {
    assert.ok(
      !dbSrc.includes("applyBrokerDayLockout"),
      "internal-lock-evaluator-db must not call applyBrokerDayLockout",
    );
  });

  it("does not call userAccountAutoLiq", () => {
    assert.ok(
      !dbSrc.includes("userAccountAutoLiq"),
      "internal-lock-evaluator-db must not call userAccountAutoLiq",
    );
  });

  it("does not call triggerEnforcement", () => {
    assert.ok(
      !dbSrc.includes("triggerEnforcement"),
      "internal-lock-evaluator-db must not call triggerEnforcement",
    );
  });
});

// ---------------------------------------------------------------------------
// Source-scan: broker-enforcement-dedup.ts — pure, no DB/broker
// ---------------------------------------------------------------------------

describe("broker-enforcement-dedup.ts — pure helper, no side effects", () => {
  const dedupSrc = readSrc("src/lib/guardian-engine/broker-enforcement-dedup.ts");

  it("does not import prisma", () => {
    assert.ok(!dedupSrc.includes("prisma"), "dedup helper must not import prisma");
  });

  it("does not import next/server", () => {
    assert.ok(!dedupSrc.includes("next/server"), "dedup helper must not import next/server");
  });

  it("does not call any broker API", () => {
    const brokerCalls = ["userAccountAutoLiq", "liquidatepositions", "cancelorder", "applyBrokerDayLockout"];
    for (const call of brokerCalls) {
      assert.ok(!dedupSrc.includes(call), `dedup helper must not call ${call}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Source-scan: debug route — read-only, no broker writes
// ---------------------------------------------------------------------------

describe("internal-lock-events debug route — read-only", () => {
  const routeSrc = readSrc("src/app/api/debug/internal-lock-events/route.ts");

  it("does not call any broker API", () => {
    const brokerCalls = ["userAccountAutoLiq", "liquidatepositions", "cancelorder", "applyBrokerDayLockout", "triggerEnforcement"];
    for (const call of brokerCalls) {
      assert.ok(!routeSrc.includes(call), `route must not call ${call}`);
    }
  });

  it("does not mutate InternalLockEvent rows", () => {
    assert.ok(
      !routeSrc.includes("internalLockEvent.update"),
      "route must not mutate InternalLockEvent rows",
    );
    assert.ok(
      !routeSrc.includes("internalLockEvent.create"),
      "route must not create InternalLockEvent rows",
    );
  });

  it("does not mutate GuardianIntervention rows", () => {
    assert.ok(
      !routeSrc.includes("guardianIntervention.update"),
      "route must not mutate GuardianIntervention rows",
    );
    assert.ok(
      !routeSrc.includes("guardianIntervention.create"),
      "route must not create GuardianIntervention rows",
    );
  });

  it("requires x-cron-secret auth", () => {
    assert.ok(
      routeSrc.includes("x-cron-secret"),
      "route must check x-cron-secret header",
    );
  });

  it("includes brokerEnforcements in response", () => {
    assert.ok(
      routeSrc.includes("brokerEnforcements"),
      "route must return brokerEnforcements field",
    );
  });

  it("includes hasAnyBrokerLocked in response", () => {
    assert.ok(
      routeSrc.includes("hasAnyBrokerLocked"),
      "route must return hasAnyBrokerLocked field",
    );
  });

  it("checks brokerLockStatus for broker_locked", () => {
    assert.ok(
      routeSrc.includes("broker_locked"),
      "route must check brokerLockStatus === 'broker_locked'",
    );
  });
});
