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
  it("hint states app-level monitoring scope", () => {
    assert.match(MAX_POSITION_SIZE_COPY.hint, /App-level monitoring/);
  });

  it("hint flags that broker-side blocking is not active yet", () => {
    assert.match(MAX_POSITION_SIZE_COPY.hint, /Broker-side blocking is not active/i);
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
