/**
 * Tests for the real-time enforcement decision module.
 *
 * All tests are pure — no network, no DB, no tokens.
 * Verifies the standard-equivalent exposure logic (1 NQ = 10 MNQ) and
 * the enforcement decision struct for the live WebSocket enforcement path.
 *
 * Run: npm run test:unit
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  decideRealtimeEnforcement,
  buildEventContextFromPropsEvent,
  buildCronEventContext,
  type RealtimeEnforcementInput,
} from "./tradovate-realtime-enforcement.ts";

// ── Helpers ──────────────────────────────────────────────────────────────────

function wsContext() {
  return buildCronEventContext("cron_sync");
}

function realtimeContext() {
  return {
    triggerSource: "tradovate_user_sync_websocket" as const,
    eventType: "Updated" as const,
    entityType: "Position" as const,
    contractId: 1,
    contractName: "NQZ4",
    symbolRoot: "NQ",
  };
}

// ── max=null: no rule ────────────────────────────────────────────────────────

describe("decideRealtimeEnforcement: no rule (maxContracts=null)", () => {
  it("shouldLock=false when maxContracts is null", () => {
    const result = decideRealtimeEnforcement({
      positions: [{ symbol: "NQZ4", netPos: 10 }],
      maxContracts: null,
      alreadyStopped: false,
      eventContext: wsContext(),
    });
    assert.equal(result.shouldLock, false);
    assert.equal(result.shouldCreateViolation, false);
    assert.equal(result.diagnostics.breachKind, "no_rule");
  });

  it("shouldLock=false when maxContracts is 0", () => {
    const result = decideRealtimeEnforcement({
      positions: [{ symbol: "NQZ4", netPos: 5 }],
      maxContracts: 0,
      alreadyStopped: false,
      eventContext: wsContext(),
    });
    assert.equal(result.shouldLock, false);
  });

  it("returns 0 exposure when no rule", () => {
    const result = decideRealtimeEnforcement({
      positions: [{ symbol: "NQZ4", netPos: 2 }],
      maxContracts: null,
      alreadyStopped: false,
      eventContext: wsContext(),
    });
    assert.equal(result.standardEquivalentExposure, 0);
  });
});

// ── max=1 standard-equivalent: NQ/MNQ ratio ──────────────────────────────────

describe("decideRealtimeEnforcement: max=1 NQ/MNQ equivalence (Apex 1:10 model)", () => {
  it("1 NQ = exactly 1 standard-equivalent → no breach at max=1", () => {
    const result = decideRealtimeEnforcement({
      positions: [{ symbol: "NQZ4", netPos: 1 }],
      maxContracts: 1,
      alreadyStopped: false,
      eventContext: wsContext(),
    });
    assert.equal(result.shouldLock, false, "1 NQ must not breach a limit of 1 standard-equivalent");
    assert.equal(result.diagnostics.breachKind, "no_breach");
  });

  it("2 NQ > 1 standard-equivalent → breach at max=1", () => {
    const result = decideRealtimeEnforcement({
      positions: [{ symbol: "NQZ4", netPos: 2 }],
      maxContracts: 1,
      alreadyStopped: false,
      eventContext: wsContext(),
    });
    assert.equal(result.shouldLock, true, "2 NQ must breach a limit of 1 standard-equivalent");
    assert.equal(result.diagnostics.breachKind, "exceeded");
  });

  it("10 MNQ = 1 standard-equivalent → no breach at max=1", () => {
    const result = decideRealtimeEnforcement({
      positions: [{ symbol: "MNQZ4", netPos: 10 }],
      maxContracts: 1,
      alreadyStopped: false,
      eventContext: wsContext(),
    });
    assert.equal(result.shouldLock, false, "10 MNQ (= 1 NQ-equivalent) must not breach a limit of 1");
    assert.equal(result.standardEquivalentExposure, 1);
  });

  it("11 MNQ > 1 standard-equivalent → breach at max=1", () => {
    const result = decideRealtimeEnforcement({
      positions: [{ symbol: "MNQZ4", netPos: 11 }],
      maxContracts: 1,
      alreadyStopped: false,
      eventContext: wsContext(),
    });
    assert.equal(result.shouldLock, true, "11 MNQ (= 1.1 NQ-equivalent) must breach a limit of 1");
    assert.equal(result.diagnostics.breachKind, "exceeded");
  });

  it("2 MNQ = 0.2 standard-equivalent → no breach at max=1", () => {
    const result = decideRealtimeEnforcement({
      positions: [{ symbol: "MNQZ4", netPos: 2 }],
      maxContracts: 1,
      alreadyStopped: false,
      eventContext: wsContext(),
    });
    assert.equal(
      result.shouldLock,
      false,
      "2 MNQ (0.2 NQ-equivalent) must NOT breach max=1 in standard-equivalent mode",
    );
  });

  it("NQ=1 + MNQ=10 combined = 2 standard-equivalent → breach at max=1", () => {
    const result = decideRealtimeEnforcement({
      positions: [
        { symbol: "NQZ4", netPos: 1 },
        { symbol: "MNQZ4", netPos: 10 },
      ],
      maxContracts: 1,
      alreadyStopped: false,
      eventContext: wsContext(),
    });
    assert.equal(result.shouldLock, true, "NQ=1 + MNQ=10 = 2 NQ-equivalent, breach at max=1");
    assert.equal(result.standardEquivalentExposure, 2);
  });
});

// ── max=2 (common eval account limit) ───────────────────────────────────────

describe("decideRealtimeEnforcement: max=2", () => {
  it("MNQ=20 = 2 standard-equivalent → no breach at max=2", () => {
    const result = decideRealtimeEnforcement({
      positions: [{ symbol: "MNQZ4", netPos: 20 }],
      maxContracts: 2,
      alreadyStopped: false,
      eventContext: wsContext(),
    });
    assert.equal(result.shouldLock, false, "20 MNQ = 2 NQ-equivalent, at the limit exactly");
    assert.equal(result.standardEquivalentExposure, 2);
  });

  it("MNQ=21 > 2 standard-equivalent → breach at max=2", () => {
    const result = decideRealtimeEnforcement({
      positions: [{ symbol: "MNQZ4", netPos: 21 }],
      maxContracts: 2,
      alreadyStopped: false,
      eventContext: wsContext(),
    });
    assert.equal(result.shouldLock, true);
  });
});

// ── Cross-product: ES/MES ────────────────────────────────────────────────────

describe("decideRealtimeEnforcement: ES/MES pairs", () => {
  it("10 MES = 1 ES-equivalent → no breach at max=1", () => {
    const result = decideRealtimeEnforcement({
      positions: [{ symbol: "MESZ4", netPos: 10 }],
      maxContracts: 1,
      alreadyStopped: false,
      eventContext: wsContext(),
    });
    assert.equal(result.shouldLock, false, "10 MES must not breach max=1");
  });

  it("NQ=1 + ES=1 combined = 2 standard-equivalent → breach at max=1", () => {
    const result = decideRealtimeEnforcement({
      positions: [
        { symbol: "NQZ4", netPos: 1 },
        { symbol: "ESZ4", netPos: 1 },
      ],
      maxContracts: 1,
      alreadyStopped: false,
      eventContext: wsContext(),
    });
    assert.equal(result.shouldLock, true, "NQ=1 + ES=1 = 2 standard-equivalent");
    assert.equal(result.standardEquivalentExposure, 2);
  });
});

// ── alreadyStopped: violation deduplication ──────────────────────────────────

describe("decideRealtimeEnforcement: alreadyStopped dedup", () => {
  it("shouldLock=true but shouldCreateViolation=false when already stopped", () => {
    const result = decideRealtimeEnforcement({
      positions: [{ symbol: "NQZ4", netPos: 5 }],
      maxContracts: 1,
      alreadyStopped: true,
      eventContext: wsContext(),
    });
    assert.equal(result.shouldLock, true, "should still lock (state is correct)");
    assert.equal(result.shouldCreateViolation, false, "must not create duplicate violation");
  });

  it("shouldCreateViolation=true when breach and not yet stopped", () => {
    const result = decideRealtimeEnforcement({
      positions: [{ symbol: "NQZ4", netPos: 5 }],
      maxContracts: 1,
      alreadyStopped: false,
      eventContext: wsContext(),
    });
    assert.equal(result.shouldCreateViolation, true);
  });
});

// ── No open positions ────────────────────────────────────────────────────────

describe("decideRealtimeEnforcement: no open positions", () => {
  it("shouldFlattenIfGated=false when no positions", () => {
    const result = decideRealtimeEnforcement({
      positions: [],
      maxContracts: 1,
      alreadyStopped: false,
      eventContext: wsContext(),
    });
    // No positions → no breach
    assert.equal(result.shouldLock, false);
    assert.equal(result.shouldFlattenIfGated, false);
  });
});

// ── Unsupported symbols (conservative: fail-safe) ───────────────────────────

describe("decideRealtimeEnforcement: unsupported symbols", () => {
  it("locks when position is in an unrecognized symbol (fail-safe)", () => {
    const result = decideRealtimeEnforcement({
      positions: [{ symbol: "UNKNOWN_FUTURES", netPos: 1 }],
      maxContracts: 5,
      alreadyStopped: false,
      eventContext: wsContext(),
    });
    assert.equal(
      result.shouldLock,
      true,
      "unrecognized symbol must cause lock (Guardrail cannot verify exposure — safe direction)",
    );
    assert.equal(result.diagnostics.breachKind, "unsupported_symbol");
    assert.ok(result.diagnostics.hasUnsupportedPositions);
  });
});

// ── shouldFlattenIfGated: gated on open positions ───────────────────────────

describe("decideRealtimeEnforcement: shouldFlattenIfGated", () => {
  it("true when breach AND has open positions", () => {
    const result = decideRealtimeEnforcement({
      positions: [{ symbol: "NQZ4", netPos: 3 }],
      maxContracts: 1,
      alreadyStopped: false,
      eventContext: wsContext(),
    });
    assert.equal(result.shouldFlattenIfGated, true);
  });
});

// ── Diagnostics: eventContext is preserved ───────────────────────────────────

describe("decideRealtimeEnforcement: diagnostics", () => {
  it("diagnostics include triggerSource from event context", () => {
    const result = decideRealtimeEnforcement({
      positions: [{ symbol: "MNQZ4", netPos: 2 }],
      maxContracts: 1,
      alreadyStopped: false,
      eventContext: realtimeContext(),
    });
    assert.equal(result.diagnostics.triggerSource, "tradovate_user_sync_websocket");
    assert.equal(result.diagnostics.contractName, "NQZ4");
    assert.equal(result.diagnostics.symbolRoot, "NQ");
    assert.equal(result.diagnostics.entityType, "Position");
  });

  it("diagnostics include maxContracts and exposure", () => {
    const result = decideRealtimeEnforcement({
      positions: [{ symbol: "MNQZ4", netPos: 5 }],
      maxContracts: 2,
      alreadyStopped: false,
      eventContext: wsContext(),
    });
    assert.equal(result.diagnostics.maxContracts, 2);
    assert.equal(result.diagnostics.standardEquivalentExposure, 0.5);
  });
});

// ── buildEventContextFromPropsEvent ─────────────────────────────────────────

describe("buildEventContextFromPropsEvent", () => {
  it("extracts contractId from entity when numeric", () => {
    const props = {
      entityType: "Position",
      entity: { id: 1, accountId: 2, contractId: 789, netPos: 1 },
      eventType: "Updated",
    };
    const ctx = buildEventContextFromPropsEvent(
      props,
      "tradovate_user_sync_websocket",
      "MNQZ4",
      "NQ",
    );
    assert.equal(ctx.contractId, 789);
    assert.equal(ctx.contractName, "MNQZ4");
    assert.equal(ctx.symbolRoot, "NQ");
    assert.equal(ctx.triggerSource, "tradovate_user_sync_websocket");
  });

  it("sets contractId=null when entity has no numeric contractId", () => {
    const props = {
      entityType: "Fill",
      entity: { id: 1, fillQty: 1 },
      eventType: "Created",
    };
    const ctx = buildEventContextFromPropsEvent(props, "tradovate_user_sync_websocket", null, null);
    assert.equal(ctx.contractId, null);
  });
});

// ── buildCronEventContext ────────────────────────────────────────────────────

describe("buildCronEventContext", () => {
  it("produces context with cron_sync trigger and all nulls", () => {
    const ctx = buildCronEventContext("cron_sync");
    assert.equal(ctx.triggerSource, "cron_sync");
    assert.equal(ctx.eventType, null);
    assert.equal(ctx.entityType, null);
    assert.equal(ctx.contractId, null);
    assert.equal(ctx.contractName, null);
    assert.equal(ctx.symbolRoot, null);
  });
});
