import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { MAX_POSITION_SIZE_COPY } from "./position-size-copy.ts";

describe("MAX_POSITION_SIZE_COPY — label", () => {
  it("label is 'Max position size'", () => {
    assert.equal(MAX_POSITION_SIZE_COPY.label, "Max position size");
  });

  it("label does not contain 'contracts' (old label wording removed)", () => {
    assert.ok(!MAX_POSITION_SIZE_COPY.label.toLowerCase().includes("contracts"));
  });
});

describe("MAX_POSITION_SIZE_COPY — hint copy", () => {
  it("hint includes 'mini-equivalent exposure'", () => {
    assert.match(MAX_POSITION_SIZE_COPY.hint, /mini-equivalent exposure/);
  });

  it("hint includes the 1 NQ = 10 MNQ example", () => {
    assert.match(MAX_POSITION_SIZE_COPY.hint, /1 NQ = 10 MNQ/);
  });

  it("hint explains that trades are placed as whole contracts per symbol", () => {
    assert.match(MAX_POSITION_SIZE_COPY.hint, /whole contracts/i);
  });

  it("hint does not imply fractional tradable contracts (no 'fractional' word)", () => {
    assert.ok(!MAX_POSITION_SIZE_COPY.hint.toLowerCase().includes("fractional"));
  });

  it("hint does not show a decimal contract size as a traded amount (e.g. '0.1 NQ' or '2.1 NQ')", () => {
    assert.ok(!MAX_POSITION_SIZE_COPY.hint.match(/\d+\.\d+\s+NQ/));
    assert.ok(!MAX_POSITION_SIZE_COPY.hint.match(/\d+\.\d+\s+ES/));
    assert.ok(!MAX_POSITION_SIZE_COPY.hint.match(/\d+\.\d+\s+MNQ/));
  });

  it("hint gives a concrete limit example using whole-contract inputs", () => {
    // The example should describe reaching the limit with whole-number
    // contract counts: '2 NQ', '20 MNQ', '1 NQ + 10 MNQ'.
    assert.match(MAX_POSITION_SIZE_COPY.hint, /2 NQ/);
    assert.match(MAX_POSITION_SIZE_COPY.hint, /20 MNQ/);
    assert.match(MAX_POSITION_SIZE_COPY.hint, /1 NQ.*10 MNQ/);
  });
});
