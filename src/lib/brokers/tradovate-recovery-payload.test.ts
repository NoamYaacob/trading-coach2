/**
 * Unit tests for tradovate-recovery-payload — pure helpers for the Daily Loss
 * recovery probe payload builders.
 *
 * No DB, no network, no TradovateClient. Verifies the structural safety
 * contract (doNotUnlock never present, changesLocked behaviour explicit,
 * dailyProfitAutoLiq never written from this path).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  RECOVERY_HIGH_THRESHOLD,
  RECOVERY_CONFIRM_PHRASE,
  RECOVERY_MODES,
  buildRecoveryPayload,
  isRecoveryMode,
  isRecoveryReadbackConfirmed,
  type ExistingAutoLiqRecord,
} from "./tradovate-recovery-payload.ts";

const existing: ExistingAutoLiqRecord = {
  id: 4242,
  dailyLossAutoLiq: 500,
  changesLocked: true,
};

describe("RECOVERY_HIGH_THRESHOLD", () => {
  it("is a finite positive integer comfortably above any plausible loss", () => {
    assert.ok(Number.isFinite(RECOVERY_HIGH_THRESHOLD));
    assert.ok(Number.isInteger(RECOVERY_HIGH_THRESHOLD));
    assert.ok(RECOVERY_HIGH_THRESHOLD >= 1_000_000);
  });

  it("is below 2^31-1 (within int32 to be safe for backends with int32 bounds)", () => {
    assert.ok(RECOVERY_HIGH_THRESHOLD < 2 ** 31 - 1);
  });
});

describe("RECOVERY_CONFIRM_PHRASE", () => {
  it("is the exact ASCII phrase callers must supply for apply=true", () => {
    assert.equal(RECOVERY_CONFIRM_PHRASE, "I_UNDERSTAND_THIS_WRITES_TO_TRADOVATE_DEMO");
  });
});

describe("RECOVERY_MODES enumeration", () => {
  it("contains exactly the four modes — no extras", () => {
    assert.deepEqual(
      [...RECOVERY_MODES].sort(),
      ["raise_and_unlock", "raise_threshold", "read_only", "unlock_only"],
    );
  });

  it("isRecoveryMode accepts valid modes and rejects everything else", () => {
    for (const m of RECOVERY_MODES) assert.equal(isRecoveryMode(m), true);
    for (const bad of [null, undefined, "", "Read_Only", "delete", "create", 1, true, {}]) {
      assert.equal(isRecoveryMode(bad), false, `expected ${JSON.stringify(bad)} to be rejected`);
    }
  });
});

describe("buildRecoveryPayload — read_only", () => {
  it("returns null for read_only (no write payload)", () => {
    assert.equal(buildRecoveryPayload("read_only", existing), null);
  });
});

describe("buildRecoveryPayload — raise_threshold", () => {
  const payload = buildRecoveryPayload("raise_threshold", existing)!;

  it("sets dailyLossAutoLiq to RECOVERY_HIGH_THRESHOLD", () => {
    assert.equal(payload.dailyLossAutoLiq, RECOVERY_HIGH_THRESHOLD);
  });

  it("preserves existing changesLocked (true → true)", () => {
    assert.equal(payload.changesLocked, true);
  });

  it("includes the existing record id (update, never create)", () => {
    assert.equal(payload.id, 4242);
  });

  it("does NOT include doNotUnlock", () => {
    assert.ok(!("doNotUnlock" in payload), "doNotUnlock must never appear");
  });

  it("does NOT include dailyProfitAutoLiq (Daily Loss only)", () => {
    assert.ok(!("dailyProfitAutoLiq" in payload), "dailyProfitAutoLiq must not appear");
  });

  it("does NOT include accountId (update never sends accountId, only create)", () => {
    assert.ok(!("accountId" in payload), "accountId is for /create; recovery uses /update only");
  });

  it("exact key set", () => {
    assert.deepEqual(Object.keys(payload).sort(), ["changesLocked", "dailyLossAutoLiq", "id"]);
  });
});

describe("buildRecoveryPayload — unlock_only", () => {
  const payload = buildRecoveryPayload("unlock_only", existing)!;

  it("sets changesLocked to false", () => {
    assert.equal(payload.changesLocked, false);
  });

  it("preserves existing dailyLossAutoLiq (500 → 500)", () => {
    assert.equal(payload.dailyLossAutoLiq, 500);
  });

  it("does NOT include doNotUnlock", () => {
    assert.ok(!("doNotUnlock" in payload));
  });

  it("does NOT raise the threshold", () => {
    assert.notEqual(payload.dailyLossAutoLiq, RECOVERY_HIGH_THRESHOLD);
  });

  it("includes the existing record id", () => {
    assert.equal(payload.id, 4242);
  });
});

describe("buildRecoveryPayload — raise_and_unlock", () => {
  const payload = buildRecoveryPayload("raise_and_unlock", existing)!;

  it("sets dailyLossAutoLiq to RECOVERY_HIGH_THRESHOLD", () => {
    assert.equal(payload.dailyLossAutoLiq, RECOVERY_HIGH_THRESHOLD);
  });

  it("sets changesLocked to false", () => {
    assert.equal(payload.changesLocked, false);
  });

  it("does NOT include doNotUnlock", () => {
    assert.ok(!("doNotUnlock" in payload));
  });

  it("includes the existing record id", () => {
    assert.equal(payload.id, 4242);
  });

  it("does NOT include dailyProfitAutoLiq (Daily Loss only)", () => {
    assert.ok(!("dailyProfitAutoLiq" in payload));
  });
});

describe("buildRecoveryPayload — null/missing existing values", () => {
  const existingWithNulls: ExistingAutoLiqRecord = {
    id: 99,
    dailyLossAutoLiq: null,
    changesLocked: null,
  };

  it("unlock_only with null threshold: coerces dailyLossAutoLiq to 0 (safe default, not null)", () => {
    const payload = buildRecoveryPayload("unlock_only", existingWithNulls)!;
    assert.equal(payload.dailyLossAutoLiq, 0);
    assert.equal(payload.changesLocked, false);
    assert.notEqual(payload.dailyLossAutoLiq, null);
  });

  it("raise_threshold with null lock: coerces changesLocked to true (conservative)", () => {
    const payload = buildRecoveryPayload("raise_threshold", existingWithNulls)!;
    assert.equal(payload.changesLocked, true);
    assert.equal(payload.dailyLossAutoLiq, RECOVERY_HIGH_THRESHOLD);
  });
});

describe("isRecoveryReadbackConfirmed", () => {
  it("read_only: confirmed when readBack is non-null", () => {
    assert.equal(
      isRecoveryReadbackConfirmed("read_only", { dailyLossAutoLiq: 100, changesLocked: true }),
      true,
    );
  });

  it("read_only: not confirmed when readBack is null", () => {
    assert.equal(isRecoveryReadbackConfirmed("read_only", null), false);
  });

  it("raise_threshold: confirmed only when dailyLossAutoLiq matches RECOVERY_HIGH_THRESHOLD", () => {
    assert.equal(
      isRecoveryReadbackConfirmed("raise_threshold", {
        dailyLossAutoLiq: RECOVERY_HIGH_THRESHOLD,
        changesLocked: true,
      }),
      true,
    );
    assert.equal(
      isRecoveryReadbackConfirmed("raise_threshold", {
        dailyLossAutoLiq: 500,
        changesLocked: true,
      }),
      false,
    );
  });

  it("raise_threshold: does not require changesLocked to be false", () => {
    // The mode does not unlock — leave changesLocked alone, still confirmed.
    assert.equal(
      isRecoveryReadbackConfirmed("raise_threshold", {
        dailyLossAutoLiq: RECOVERY_HIGH_THRESHOLD,
        changesLocked: true,
      }),
      true,
    );
  });

  it("unlock_only: confirmed only when changesLocked === false", () => {
    assert.equal(
      isRecoveryReadbackConfirmed("unlock_only", {
        dailyLossAutoLiq: 500,
        changesLocked: false,
      }),
      true,
    );
    assert.equal(
      isRecoveryReadbackConfirmed("unlock_only", {
        dailyLossAutoLiq: 500,
        changesLocked: true,
      }),
      false,
    );
  });

  it("raise_and_unlock: requires BOTH high threshold AND changesLocked=false", () => {
    assert.equal(
      isRecoveryReadbackConfirmed("raise_and_unlock", {
        dailyLossAutoLiq: RECOVERY_HIGH_THRESHOLD,
        changesLocked: false,
      }),
      true,
    );
    assert.equal(
      isRecoveryReadbackConfirmed("raise_and_unlock", {
        dailyLossAutoLiq: RECOVERY_HIGH_THRESHOLD,
        changesLocked: true,
      }),
      false,
    );
    assert.equal(
      isRecoveryReadbackConfirmed("raise_and_unlock", {
        dailyLossAutoLiq: 500,
        changesLocked: false,
      }),
      false,
    );
  });

  it("any mode with null readBack: not confirmed", () => {
    for (const m of RECOVERY_MODES) {
      assert.equal(isRecoveryReadbackConfirmed(m, null), false, `mode ${m} must not confirm null readBack`);
    }
  });
});
