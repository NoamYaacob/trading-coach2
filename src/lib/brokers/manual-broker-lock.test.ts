/**
 * Contract tests for the manual broker-lock orchestrator (applyManualBrokerLock).
 *
 * Source-scan approach: the module instantiates the TradovateClient and writes
 * to the broker, so it cannot be import-and-called without a DB + live broker.
 * These tests pin the safety invariants of the user-initiated manual broker
 * lock:
 *   - reuses the EXISTING userAccountAutoLiq risk-setting write (no new path)
 *   - NEVER places / cancels / flattens orders
 *   - uses the MANUAL authorization policy: no BROKER_ENFORCEMENT_ENABLED,
 *     demo-only, or allowlist gating (the explicit click is the authorization)
 *   - still requires a live connection + full_access (via shouldSkipManualBrokerLock)
 *   - connected_readonly + full_access is ALLOWED (not blocked by readonly status)
 *   - honors ENFORCEMENT_DRY_RUN
 *   - sends changesLocked:false — NOT true — so Tradovate's daily session reset
 *     can clear dailyLossAutoLiq at 6 PM ET and the user can reset from the UI
 *   - refuses write when accountType/BrokerConnection.env are mismatched
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd(), "src");
const raw = readFileSync(resolve(ROOT, "lib/brokers/manual-broker-lock.ts"), "utf8");
/** Code with comments stripped — negative ("must not reference") assertions
 *  inspect executable code only, not the explanatory doc comments. */
const mod = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("applyManualBrokerLock — reuses the safe risk-setting write only", () => {
  it("calls the existing applyDailyLossLock (userAccountAutoLiq) write path", () => {
    assert.ok(
      mod.includes("applyDailyLossLock"),
      "must reuse TradovateClient.applyDailyLossLock (userAccountAutoLiq write)",
    );
  });

  it("never places, cancels, or flattens orders", () => {
    for (const path of [
      "applyFlattenOpenPositions",
      "flattenPositions",
      "liquidatepositions",
      "placeOrder",
      "cancelOrder",
      "order/",
    ]) {
      assert.ok(!mod.includes(path), `manual broker lock must never reference an order path: ${path}`);
    }
  });

  it("locks immediately by setting the loss threshold to 0", () => {
    assert.ok(
      /MANUAL_LOCK_LOSS_THRESHOLD\s*=\s*0/.test(mod),
      "manual lock must set the daily-loss threshold to 0 to lock immediately",
    );
    assert.ok(
      mod.includes("lossAmountToSet: MANUAL_LOCK_LOSS_THRESHOLD"),
      "the write must pass the manual lock threshold",
    );
  });
});

describe("applyManualBrokerLock — changesLocked must be false", () => {
  it("defines MANUAL_LOCK_CHANGES_LOCKED = false", () => {
    assert.ok(
      /MANUAL_LOCK_CHANGES_LOCKED\s*=\s*false/.test(mod),
      "MANUAL_LOCK_CHANGES_LOCKED must be false — changesLocked:true causes the lock to " +
        "persist beyond the CME session reset and cannot be cleared without Tradovate support",
    );
  });

  it("passes MANUAL_LOCK_CHANGES_LOCKED (false) to applyDailyLossLock — not a literal true", () => {
    assert.ok(
      mod.includes("changesLocked: MANUAL_LOCK_CHANGES_LOCKED"),
      "must pass MANUAL_LOCK_CHANGES_LOCKED to changesLocked, not a hardcoded literal",
    );
  });

  it("does NOT send changesLocked:true in the live write or dry-run payload", () => {
    // Strip the constant definition line so we only check usage sites.
    const noConst = mod.replace(/MANUAL_LOCK_CHANGES_LOCKED\s*=\s*false[^\n]*\n/, "");
    assert.ok(
      !noConst.includes("changesLocked: true"),
      "must not send changesLocked:true anywhere in the manual lock path",
    );
  });
});

describe("applyManualBrokerLock — env/accountType safety guard", () => {
  it("fetches BrokerConnection.env (bcEnv) from the account query", () => {
    assert.ok(
      mod.includes("bcEnv"),
      "must read bcEnv from BrokerConnection — needed for env/accountType mismatch check",
    );
  });

  it("fetches accountType from the account query", () => {
    assert.ok(
      mod.includes("accountType"),
      "must read accountType — needed for env/accountType mismatch check",
    );
  });

  it("refuses write when demo account has live BrokerConnection env", () => {
    assert.ok(
      mod.includes("demo account with live connection"),
      "must log and refuse: demo account + live connection mismatch",
    );
    assert.ok(
      mod.includes("account is demo but BrokerConnection.env is live"),
      "must return an explanatory message for demo+live mismatch",
    );
  });

  it("refuses write when live/personal account has demo BrokerConnection env", () => {
    assert.ok(
      mod.includes("live account with demo connection"),
      "must log and refuse: live account + demo connection mismatch",
    );
    assert.ok(
      mod.includes("account is live/personal but BrokerConnection.env is demo"),
      "must return an explanatory message for live+demo mismatch",
    );
  });

  it("env mismatch returns broker_lock_failed before any TradovateClient is instantiated", () => {
    const mismatchDemoIdx = mod.indexOf("account is demo but BrokerConnection.env is live");
    const clientIdx = mod.indexOf("new TradovateClient");
    assert.ok(mismatchDemoIdx > -1 && clientIdx > -1, "both must be present");
    assert.ok(
      mismatchDemoIdx < clientIdx,
      "env mismatch guard must short-circuit before the TradovateClient is instantiated",
    );
  });
});

describe("applyManualBrokerLock — manual authorization gating", () => {
  it("does NOT require the automatic-enforcement env gates", () => {
    for (const gate of [
      "BROKER_ENFORCEMENT_ENABLED",
      "BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST",
      "allowlist",
      "evaluateBrokerEnforcementGates",
    ]) {
      assert.ok(
        !mod.includes(gate),
        `manual lock is user-authorized — it must not gate on ${gate}`,
      );
    }
  });

  it("uses the manual-specific gate shouldSkipManualBrokerLock (not the shared automatic gate)", () => {
    assert.ok(
      mod.includes("shouldSkipManualBrokerLock"),
      "must use the manual-specific gate — never blocks on connected_readonly + full_access",
    );
    assert.ok(
      !mod.includes("shouldSkipBrokerEnforcement"),
      "must NOT use the shared automatic-enforcement gate (it has the connected_readonly legacy fallback)",
    );
  });

  it("honors ENFORCEMENT_DRY_RUN (simulates, no client instantiation in dry-run)", () => {
    assert.ok(mod.includes("isEnforcementDryRun"), "must check dry-run mode");
    const dryIdx = mod.indexOf("isEnforcementDryRun()");
    const clientIdx = mod.indexOf("new TradovateClient");
    assert.ok(dryIdx > -1 && clientIdx > -1, "both must be present");
    assert.ok(dryIdx < clientIdx, "dry-run must short-circuit before the client is instantiated");
  });
});

describe("applyManualBrokerLock — outcome classification", () => {
  it("maps a 403 to unavailable_permission", () => {
    assert.ok(
      mod.includes("unavailable_permission"),
      "a 403 must classify as unavailable_permission",
    );
    assert.ok(/statusCode\s*===\s*403/.test(mod), "must detect the 403 status code");
  });

  it("returns broker_locked only when the write is confirmed", () => {
    assert.ok(mod.includes("result.confirmed"), "must check the confirmed flag");
    assert.ok(mod.includes('"broker_locked"'), "confirmed write → broker_locked");
    assert.ok(mod.includes('"broker_lock_failed"'), "unconfirmed/error → broker_lock_failed");
  });

  it("does not leak the raw broker response body in the failure message", () => {
    assert.ok(!mod.includes("bodyExcerpt"), "must not surface the raw response body excerpt");
  });
});
