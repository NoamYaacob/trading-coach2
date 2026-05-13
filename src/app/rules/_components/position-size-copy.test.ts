import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { MAX_POSITION_SIZE_COPY } from "./position-size-copy.ts";

describe("MAX_POSITION_SIZE_COPY — label", () => {
  it("label is 'Max position size (mini-equivalent)'", () => {
    assert.equal(MAX_POSITION_SIZE_COPY.label, "Max position size (mini-equivalent)");
  });

  it("label includes 'mini-equivalent' to clarify the unit", () => {
    assert.ok(MAX_POSITION_SIZE_COPY.label.toLowerCase().includes("mini-equivalent"));
  });
});

describe("MAX_POSITION_SIZE_COPY — hint copy", () => {
  it("hint advertises broker-side enforcement when Tradovate Account Risk Settings is available", () => {
    // Reflects the new applyMaxPositionSize wiring on the accounts PATCH route:
    // Guardrail now sets a userAccountPositionLimit + hardLimit risk parameter
    // so Tradovate rejects breaching orders at the broker level. The hint must
    // make this clear so users no longer think the cap is app-level only.
    assert.match(MAX_POSITION_SIZE_COPY.hint, /Tradovate/);
    assert.match(MAX_POSITION_SIZE_COPY.hint, /broker[- ]side/i);
    assert.match(MAX_POSITION_SIZE_COPY.hint, /position limit/i);
  });

  it("hint mentions the Account Risk Settings permission requirement", () => {
    // Without "Account Risk Settings: Full Access" the broker call is
    // skipped (route logs a warn). The hint must surface that requirement
    // so users understand why their connected account might still be
    // app-level only.
    assert.match(MAX_POSITION_SIZE_COPY.hint, /Account Risk Settings/i);
  });

  it("hint preserves the app-level fallback for accounts without broker sync", () => {
    // Non-Tradovate accounts and Tradovate accounts that have not granted
    // the permission still rely on Guardrail's app-level monitor. The hint
    // must call out that fallback so the experience is unambiguous.
    assert.match(MAX_POSITION_SIZE_COPY.hint, /app[- ]level/i);
  });

  it("hint does NOT claim live reject behavior is verified (pending demo)", () => {
    // The implementation is wired but live broker behavior must be
    // validated on a sim account before we say "verified" or "guaranteed".
    // Forbid those marketing-y phrases until docs/ops/tradovate-position-limit-demo.md
    // is checked off.
    const FORBIDDEN = ["verified live", "guaranteed", "always blocks"];
    for (const f of FORBIDDEN) {
      assert.ok(
        !MAX_POSITION_SIZE_COPY.hint.toLowerCase().includes(f.toLowerCase()),
        `hint must not claim "${f}" until demo verification is complete`,
      );
    }
  });

  it("hint does NOT contain the stale 'broker-side blocking is not active yet' wording", () => {
    // That copy predated the applyMaxPositionSize wiring. Keeping it now
    // would be actively misleading.
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

  it("hint explains the mini-equivalent concept with a concrete example", () => {
    // Users need to know that micro contracts count as 0.1 mini, so 1 mini = 10 MNQ.
    assert.match(
      MAX_POSITION_SIZE_COPY.hint,
      /0\.1 mini|0\.1 of a mini/i,
      "hint must explain micro contracts count as 0.1 mini",
    );
    assert.match(
      MAX_POSITION_SIZE_COPY.hint,
      /MNQ|MES/,
      "hint must mention at least one micro contract example",
    );
  });

  it("hint clarifies that broker enforcement is raw contract count, not mini-equivalent weighted", () => {
    // This distinction is critical: users must understand that the Tradovate
    // broker limit is global and does not apply mini-equivalent scaling.
    assert.match(
      MAX_POSITION_SIZE_COPY.hint,
      /raw contract|raw contract count/i,
      "hint must mention raw contract count limitation",
    );
    assert.match(
      MAX_POSITION_SIZE_COPY.hint,
      /app[- ]level/i,
      "hint must note mini-equivalent weighting is app-level only",
    );
  });
});
