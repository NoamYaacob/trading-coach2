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
  it("hint explains 1 standard-equivalent allows 10 micro contracts", () => {
    assert.match(
      MAX_POSITION_SIZE_COPY.hint,
      /1 standard-equivalent allows up to 10 micro/i,
      "hint must explain the Apex '10 micro = 1 standard' rule",
    );
  });

  it("hint names at least one supported micro contract", () => {
    assert.match(
      MAX_POSITION_SIZE_COPY.hint,
      /MNQ|MES|MYM|M2K/,
      "hint must name at least one supported micro contract",
    );
  });

  it("hint warns that broker-side enforcement uses raw contract counts (cannot express standard-equivalent)", () => {
    // Tradovate's position limit API only supports totalBy=Overall (global raw count).
    // PerContract/PerProduct were confirmed invalid by API probe. The hint must convey
    // that the global cap is intentionally not set because it can't express standard-equivalent weighting.
    assert.ok(
      MAX_POSITION_SIZE_COPY.hint.toLowerCase().includes("raw") &&
        MAX_POSITION_SIZE_COPY.hint.toLowerCase().includes("standard-equivalent"),
      "hint must warn that the broker uses raw counts which cannot express standard-equivalent weighting",
    );
    assert.ok(
      MAX_POSITION_SIZE_COPY.hint.toLowerCase().includes("intentionally not set") ||
        MAX_POSITION_SIZE_COPY.hint.toLowerCase().includes("not set"),
      "hint must explain why the global raw cap is intentionally not applied",
    );
  });

  it("hint does NOT claim live broker-reject behavior is verified (pending demo)", () => {
    const FORBIDDEN = ["verified live", "guaranteed", "always blocks"];
    for (const f of FORBIDDEN) {
      assert.ok(
        !MAX_POSITION_SIZE_COPY.hint.toLowerCase().includes(f.toLowerCase()),
        `hint must not claim "${f}" until demo verification is complete`,
      );
    }
  });

  it("hint does NOT contain the stale 'not active yet' wording", () => {
    assert.ok(
      !MAX_POSITION_SIZE_COPY.hint.toLowerCase().includes("not active"),
      "stale 'not active yet' wording must be removed",
    );
  });

  it("hint does not imply fractional tradable contracts (no 'fractional' word)", () => {
    assert.ok(!MAX_POSITION_SIZE_COPY.hint.toLowerCase().includes("fractional"));
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
