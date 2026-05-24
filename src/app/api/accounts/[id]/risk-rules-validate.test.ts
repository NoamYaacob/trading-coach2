import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { validateRiskRulesBody } from "./risk-rules-validate.ts";

describe("validateRiskRulesBody — accepts", () => {
  it("null body (delete override)", () => {
    assert.equal(validateRiskRulesBody(null), null);
  });

  it("empty object", () => {
    assert.equal(validateRiskRulesBody({}), null);
  });

  it("allowedEndHour=0", () => {
    assert.equal(validateRiskRulesBody({ allowedEndHour: 0 }), null);
  });

  it("allowedEndHour=23", () => {
    assert.equal(validateRiskRulesBody({ allowedEndHour: 23 }), null);
  });

  it("allowedEndHour=16 (CME boundary, valid)", () => {
    assert.equal(validateRiskRulesBody({ allowedEndHour: 16 }), null);
  });

  it("allowedEndHour=null (clear override)", () => {
    assert.equal(validateRiskRulesBody({ allowedEndHour: null }), null);
  });

  it("undefined hour fields are accepted (no claim)", () => {
    assert.equal(validateRiskRulesBody({ riskPerTrade: 100 }), null);
  });

  it("non-negative integer counts pass", () => {
    assert.equal(validateRiskRulesBody({ maxTradesPerDay: 5, stopAfterLosses: 3, maxContracts: 2 }), null);
  });
});

describe("validateRiskRulesBody — rejects out-of-range hours", () => {
  it("allowedEndHour=24 is rejected (server keeps 0–23 strict; UI normalises 24→0 before sending)", () => {
    const err = validateRiskRulesBody({ allowedEndHour: 24 });
    assert.ok(err);
    assert.equal(err!.field, "allowedEndHour");
    assert.match(err!.message, /0 and 23/);
  });

  it("allowedEndHour=123 is rejected (the live bug)", () => {
    const err = validateRiskRulesBody({ allowedEndHour: 123 });
    assert.ok(err);
    assert.equal(err!.field, "allowedEndHour");
  });

  it("allowedEndHour=-1 is rejected", () => {
    const err = validateRiskRulesBody({ allowedEndHour: -1 });
    assert.ok(err);
    assert.equal(err!.field, "allowedEndHour");
  });

  it("allowedEndHour=12.5 is rejected (decimal)", () => {
    const err = validateRiskRulesBody({ allowedEndHour: 12.5 });
    assert.ok(err);
    assert.equal(err!.field, "allowedEndHour");
  });

  it("allowedEndHour as string is rejected", () => {
    const err = validateRiskRulesBody({ allowedEndHour: "16" });
    assert.ok(err);
    assert.equal(err!.field, "allowedEndHour");
  });

  it("allowedStartHour=24 is rejected", () => {
    const err = validateRiskRulesBody({ allowedStartHour: 24 });
    assert.ok(err);
    assert.equal(err!.field, "allowedStartHour");
  });
});

describe("validateRiskRulesBody — rejects bad integer counts", () => {
  it("maxTradesPerDay=-1 is rejected", () => {
    const err = validateRiskRulesBody({ maxTradesPerDay: -1 });
    assert.ok(err);
    assert.equal(err!.field, "maxTradesPerDay");
  });

  it("stopAfterLosses=2.5 is rejected", () => {
    const err = validateRiskRulesBody({ stopAfterLosses: 2.5 });
    assert.ok(err);
    assert.equal(err!.field, "stopAfterLosses");
  });

  it("maxContracts as string is rejected", () => {
    const err = validateRiskRulesBody({ maxContracts: "2" });
    assert.ok(err);
    assert.equal(err!.field, "maxContracts");
  });
});

describe("validateRiskRulesBody — first error wins (deterministic)", () => {
  it("hour error reported before count error when both invalid", () => {
    const err = validateRiskRulesBody({ allowedEndHour: 99, maxTradesPerDay: -1 });
    assert.ok(err);
    assert.equal(err!.field, "allowedEndHour");
  });
});

describe("validateRiskRulesBody — maxContractsBySymbolJson (Phase 4)", () => {
  it("accepts an absent field", () => {
    assert.equal(validateRiskRulesBody({ maxContracts: 2 }), null);
  });

  it("accepts a null field", () => {
    assert.equal(validateRiskRulesBody({ maxContractsBySymbolJson: null }), null);
  });

  it("accepts a valid JSON array of supported symbols", () => {
    assert.equal(
      validateRiskRulesBody({
        maxContractsBySymbolJson: '[{"symbol":"NQ","maxContracts":2},{"symbol":"MNQ","maxContracts":10}]',
      }),
      null,
    );
  });

  it("rejects a non-string value", () => {
    const err = validateRiskRulesBody({ maxContractsBySymbolJson: 42 });
    assert.ok(err);
    assert.equal(err!.field, "maxContractsBySymbolJson");
    assert.match(err!.message, /JSON string/);
  });

  it("rejects malformed JSON", () => {
    const err = validateRiskRulesBody({ maxContractsBySymbolJson: "not json" });
    assert.ok(err);
    assert.equal(err!.field, "maxContractsBySymbolJson");
  });

  it("rejects a duplicate symbol", () => {
    const err = validateRiskRulesBody({
      maxContractsBySymbolJson: '[{"symbol":"NQ","maxContracts":2},{"symbol":"NQ","maxContracts":3}]',
    });
    assert.ok(err);
    assert.equal(err!.field, "maxContractsBySymbolJson");
    assert.match(err!.message, /Duplicate/);
  });

  it("rejects an unsupported symbol", () => {
    const err = validateRiskRulesBody({
      maxContractsBySymbolJson: '[{"symbol":"AAPL","maxContracts":2}]',
    });
    assert.ok(err);
    assert.equal(err!.field, "maxContractsBySymbolJson");
  });

  it("rejects a lowercase symbol", () => {
    const err = validateRiskRulesBody({
      maxContractsBySymbolJson: '[{"symbol":"nq","maxContracts":2}]',
    });
    assert.ok(err);
    assert.equal(err!.field, "maxContractsBySymbolJson");
    assert.match(err!.message, /uppercase/);
  });

  it("rejects a zero / negative / non-integer maxContracts", () => {
    for (const bad of [0, -2, 1.5]) {
      const err = validateRiskRulesBody({
        maxContractsBySymbolJson: `[{"symbol":"NQ","maxContracts":${bad}}]`,
      });
      assert.ok(err, `maxContracts=${bad} must be rejected`);
      assert.equal(err!.field, "maxContractsBySymbolJson");
    }
  });

  it("rejects a maxContracts above the 1000 cap", () => {
    const err = validateRiskRulesBody({
      maxContractsBySymbolJson: '[{"symbol":"NQ","maxContracts":1001}]',
    });
    assert.ok(err);
    assert.equal(err!.field, "maxContractsBySymbolJson");
  });
});
