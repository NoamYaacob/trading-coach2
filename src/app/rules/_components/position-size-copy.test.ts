import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { MAX_POSITION_SIZE_COPY } from "./position-size-copy.ts";

describe("MAX_POSITION_SIZE_COPY — label", () => {
  it("label is 'Max standard-equivalent contracts'", () => {
    assert.equal(MAX_POSITION_SIZE_COPY.label, "Max standard-equivalent contracts");
  });

  it("label includes 'standard-equivalent' to clarify the unit", () => {
    assert.ok(MAX_POSITION_SIZE_COPY.label.toLowerCase().includes("standard-equivalent"));
  });
});

describe("MAX_POSITION_SIZE_COPY — hint copy", () => {
  it("hint uses the simplified position monitoring explanation", () => {
    assert.ok(
      MAX_POSITION_SIZE_COPY.hint.includes("Guardrail uses this limit to monitor position size"),
      "hint must use the simplified position monitoring explanation",
    );
  });

  it("hint explains standard-equivalent sizing with 1 NQ = 10 MNQ example", () => {
    assert.ok(
      MAX_POSITION_SIZE_COPY.hint.includes("Standard-equivalent sizing lets 1 NQ equal 10 MNQ"),
      "hint must explain the 1 NQ = 10 MNQ sizing rule",
    );
  });

  it("hint does not contain internal API reasoning", () => {
    const FORBIDDEN = [
      "order actions",
      "detection",
      "during sync",
      "flatten",
      "broker-level pre-trade block",
      "Tradovate's position limit API",
      "raw global contract",
      "global cap",
    ];
    for (const f of FORBIDDEN) {
      assert.ok(
        !MAX_POSITION_SIZE_COPY.hint.toLowerCase().includes(f.toLowerCase()),
        `hint must not contain internal term "${f}"`,
      );
    }
  });

  it("hint does not contain internal enum strings or removed dry-run wording", () => {
    const FORBIDDEN = ["monitoring_only", "dry_run", "Protection test mode"];
    for (const f of FORBIDDEN) {
      assert.ok(
        !MAX_POSITION_SIZE_COPY.hint.toLowerCase().includes(f.toLowerCase()),
        `hint must not contain "${f}"`,
      );
    }
  });
});
