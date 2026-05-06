import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { formatBreakdownHint } from "./summary-strip-helpers.ts";

describe("formatBreakdownHint — Allowed/Warning/Locked breakdown shown to user", () => {
  it("zero total → no hint (no breakdown shown when nothing to count)", () => {
    assert.equal(
      formatBreakdownHint({ total: 0, live: 0, practice: 0 }),
      undefined,
    );
  });

  it("only live accounts → '2 live'", () => {
    assert.equal(
      formatBreakdownHint({ total: 2, live: 2, practice: 0 }),
      "2 live",
    );
  });

  it("only practice accounts → '3 practice'", () => {
    assert.equal(
      formatBreakdownHint({ total: 3, live: 0, practice: 3 }),
      "3 practice",
    );
  });

  it("mix of live and practice → '1 live · 1 practice' (matches user-requested format)", () => {
    assert.equal(
      formatBreakdownHint({ total: 2, live: 1, practice: 1 }),
      "1 live · 1 practice",
    );
  });

  it("multi-account live and practice → counts display verbatim", () => {
    assert.equal(
      formatBreakdownHint({ total: 5, live: 3, practice: 2 }),
      "3 live · 2 practice",
    );
  });

  it("regression: 1 live + 1 demo (practice) is NOT confused as 2 live", () => {
    // Product invariant: a user with one personal account + one demo account
    // must never see "2 live" — that would imply both are real.
    const hint = formatBreakdownHint({ total: 2, live: 1, practice: 1 });
    assert.ok(hint?.includes("1 live"), `expected '1 live' in hint, got: ${hint}`);
    assert.ok(hint?.includes("1 practice"), `expected '1 practice' in hint, got: ${hint}`);
    assert.ok(!hint?.includes("2 live"), `must not show '2 live', got: ${hint}`);
  });
});
