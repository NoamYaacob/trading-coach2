/**
 * Unit tests for Tradovate position-limit pure helpers.
 *
 * All assertions target the pure functions in tradovate-position-limit.ts —
 * no network calls, no database, no real credentials required.
 *
 * Test categories:
 *  1. findGuardrailPositionLimit — correct record selection by description
 *  2. buildCreatePositionLimitPayload — correct create payload shape
 *  3. buildUpdatePositionLimitPayload — correct update payload (active=true)
 *  4. buildDeactivatePositionLimitPayload — deactivate sets active=false
 *  5. buildCreateRiskParameterPayload — hardLimit=true on create
 *  6. buildUpdateRiskParameterPayload — hardLimit=true on update
 *  7. Smoke: GUARDRAIL_POSITION_LIMIT_DESCRIPTION constant is stable
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  GUARDRAIL_POSITION_LIMIT_DESCRIPTION,
  findGuardrailPositionLimit,
  buildCreatePositionLimitPayload,
  buildUpdatePositionLimitPayload,
  buildDeactivatePositionLimitPayload,
  buildCreateRiskParameterPayload,
  buildUpdateRiskParameterPayload,
  type TvUserAccountPositionLimit,
} from "./tradovate-position-limit.ts";

// ── 1. findGuardrailPositionLimit ────────────────────────────────────────────

describe("findGuardrailPositionLimit", () => {
  test("returns null when list is empty", () => {
    assert.equal(findGuardrailPositionLimit([]), null);
  });

  test("returns null when no record has the Guardrail description", () => {
    const limits: TvUserAccountPositionLimit[] = [
      { id: 1, description: "Prop firm limit", exposedLimit: 10 },
      { id: 2, description: "My custom limit", exposedLimit: 5 },
    ];
    assert.equal(findGuardrailPositionLimit(limits), null);
  });

  test("returns the matching record when it exists", () => {
    const guardrail: TvUserAccountPositionLimit = {
      id: 42,
      description: GUARDRAIL_POSITION_LIMIT_DESCRIPTION,
      exposedLimit: 3,
    };
    const limits: TvUserAccountPositionLimit[] = [
      { id: 1, description: "Prop firm limit", exposedLimit: 10 },
      guardrail,
    ];
    assert.deepEqual(findGuardrailPositionLimit(limits), guardrail);
  });

  test("does not return a record with a different description even if otherwise similar", () => {
    const limits: TvUserAccountPositionLimit[] = [
      { id: 1, description: "guardrail max position size", exposedLimit: 3 }, // lowercase
      { id: 2, description: "Guardrail Max Position Size (test)", exposedLimit: 3 }, // suffix
    ];
    assert.equal(findGuardrailPositionLimit(limits), null);
  });

  test("returns the first matching record when there are duplicates", () => {
    const first: TvUserAccountPositionLimit = {
      id: 10,
      description: GUARDRAIL_POSITION_LIMIT_DESCRIPTION,
      exposedLimit: 2,
    };
    const second: TvUserAccountPositionLimit = {
      id: 11,
      description: GUARDRAIL_POSITION_LIMIT_DESCRIPTION,
      exposedLimit: 5,
    };
    assert.deepEqual(findGuardrailPositionLimit([first, second]), first);
  });
});

// ── 2. buildCreatePositionLimitPayload ───────────────────────────────────────

describe("buildCreatePositionLimitPayload", () => {
  test("sets accountId from tvAccountId", () => {
    const payload = buildCreatePositionLimitPayload(12345, 4);
    assert.equal(payload.accountId, 12345);
  });

  test("sets exposedLimit from maxContracts", () => {
    const payload = buildCreatePositionLimitPayload(1, 7);
    assert.equal(payload.exposedLimit, 7);
  });

  test("totalBy is 'Overall'", () => {
    const payload = buildCreatePositionLimitPayload(1, 1);
    assert.equal(payload.totalBy, "Overall");
  });

  test("active is true", () => {
    const payload = buildCreatePositionLimitPayload(1, 1);
    assert.equal(payload.active, true);
  });

  test("description matches GUARDRAIL constant", () => {
    const payload = buildCreatePositionLimitPayload(1, 1);
    assert.equal(payload.description, GUARDRAIL_POSITION_LIMIT_DESCRIPTION);
  });
});

// ── 3. buildUpdatePositionLimitPayload ───────────────────────────────────────

describe("buildUpdatePositionLimitPayload", () => {
  test("sets id from existing record id", () => {
    const payload = buildUpdatePositionLimitPayload(99, 3);
    assert.equal(payload.id, 99);
  });

  test("sets exposedLimit from maxContracts", () => {
    const payload = buildUpdatePositionLimitPayload(1, 5);
    assert.equal(payload.exposedLimit, 5);
  });

  test("re-activates the record (active=true)", () => {
    const payload = buildUpdatePositionLimitPayload(1, 5);
    assert.equal(payload.active, true);
  });

  test("does not include accountId (update must not move the record to a different account)", () => {
    const payload = buildUpdatePositionLimitPayload(1, 5);
    assert.ok(!("accountId" in payload), "update payload must not include accountId");
  });
});

// ── 4. buildDeactivatePositionLimitPayload ───────────────────────────────────

describe("buildDeactivatePositionLimitPayload", () => {
  test("sets id", () => {
    const payload = buildDeactivatePositionLimitPayload(77);
    assert.equal(payload.id, 77);
  });

  test("sets active=false", () => {
    const payload = buildDeactivatePositionLimitPayload(77);
    assert.equal(payload.active, false);
  });

  test("does not change description or exposedLimit", () => {
    const payload = buildDeactivatePositionLimitPayload(77);
    assert.ok(!("description" in payload));
    assert.ok(!("exposedLimit" in payload));
  });
});

// ── 5. buildCreateRiskParameterPayload ───────────────────────────────────────

describe("buildCreateRiskParameterPayload", () => {
  test("links to the position limit by userAccountPositionLimitId", () => {
    const payload = buildCreateRiskParameterPayload(42);
    assert.equal(payload.userAccountPositionLimitId, 42);
  });

  test("sets hardLimit=true", () => {
    const payload = buildCreateRiskParameterPayload(42);
    assert.equal(payload.hardLimit, true);
  });
});

// ── 6. buildUpdateRiskParameterPayload ───────────────────────────────────────

describe("buildUpdateRiskParameterPayload", () => {
  test("sets id from existing risk parameter id", () => {
    const payload = buildUpdateRiskParameterPayload(55);
    assert.equal(payload.id, 55);
  });

  test("sets hardLimit=true", () => {
    const payload = buildUpdateRiskParameterPayload(55);
    assert.equal(payload.hardLimit, true);
  });

  test("does not include userAccountPositionLimitId (update must not re-link)", () => {
    const payload = buildUpdateRiskParameterPayload(55);
    assert.ok(
      !("userAccountPositionLimitId" in payload),
      "update payload must not include userAccountPositionLimitId",
    );
  });
});

// ── 7. Constant stability ────────────────────────────────────────────────────

test("GUARDRAIL_POSITION_LIMIT_DESCRIPTION is a non-empty string", () => {
  assert.equal(typeof GUARDRAIL_POSITION_LIMIT_DESCRIPTION, "string");
  assert.ok(GUARDRAIL_POSITION_LIMIT_DESCRIPTION.length > 0);
});

test("GUARDRAIL_POSITION_LIMIT_DESCRIPTION contains 'Guardrail' to brand the record", () => {
  assert.ok(
    GUARDRAIL_POSITION_LIMIT_DESCRIPTION.includes("Guardrail"),
    "description must include 'Guardrail' so manual records are distinguishable",
  );
});
