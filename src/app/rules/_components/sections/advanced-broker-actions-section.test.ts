/**
 * Source-scan tests for AdvancedBrokerActionsSection.
 *
 * This card is informational only — every action listed must be labelled as
 * a planned broker action and never as live. The tests freeze that taxonomy
 * so future edits can't silently flip an action from "Planned" to "Active".
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(import.meta.dirname, "advanced-broker-actions-section.tsx"),
  "utf8",
);

// Strip comment lines so the assertions only see customer-visible JSX/TSX
// strings, not commentary that may describe what is or isn't safe.
function codeOnly(src: string): string {
  return src
    .split("\n")
    .filter(
      (line) =>
        !line.trim().startsWith("*") &&
        !line.trim().startsWith("//") &&
        !line.trim().startsWith("/*"),
    )
    .join("\n");
}

describe("AdvancedBrokerActionsSection — all actions are planned, not active", () => {
  it("lists all four planned broker actions", () => {
    for (const name of ["PDLL action", "PDPT action", "Liquidate", "Liquidate & block"]) {
      assert.ok(SRC.includes(name), `must list "${name}" as a planned action`);
    }
  });

  it("every action carries the 'planned-broker' badge variant", () => {
    // The section iterates over ADVANCED_ACTIONS and renders one
    // RuleStatusBadge per row. Assert the variant is consistent.
    assert.ok(
      SRC.includes('variant="planned-broker"'),
      "advanced actions must use the planned-broker variant",
    );
  });

  it("never claims any action is active or live", () => {
    const code = codeOnly(SRC).replace(/\s+/g, " ");
    assert.ok(
      !/(\bactive today\b|\bcurrently active\b|\benabled today\b)/i.test(code),
      "advanced section must not claim any action is active today",
    );
    // The phrase "active for end users today" only appears as part of
    // "not active for end users today" — verify the negation.
    if (/active for end users today/i.test(code)) {
      assert.ok(
        /not active for end users today/i.test(code),
        "if 'active for end users today' appears, it must be negated",
      );
    }
  });

  it("explicit statement that cancel/flatten/order-blocking are not active", () => {
    // Phrase may wrap across JSX lines; collapse whitespace before matching.
    const flat = SRC.replace(/\s+/g, " ");
    assert.ok(
      /not\s+active in this beta/i.test(flat),
      "section must reiterate that cancel/flatten/order blocking are not active",
    );
  });

  it("does not surface a user toggle that triggers broker writes", () => {
    // Informational only — no checkbox, radio, or button that posts to a
    // broker endpoint. Any of these in this file would be a regression.
    const code = codeOnly(SRC);
    assert.ok(!code.includes("<input"), "must not include an <input> element");
    assert.ok(!code.includes("<button"), "must not include a <button> element");
    assert.ok(
      !/onClick=/i.test(code),
      "must not wire any onClick handler — informational only",
    );
  });

  it("does not import any Tradovate client or broker-write helper", () => {
    // Defense in depth: keep this section a pure informational surface.
    assert.ok(
      !/from\s+["'].*tradovate/i.test(SRC),
      "must not import anything from a Tradovate module",
    );
    assert.ok(
      !/from\s+["'].*brokers\//i.test(SRC),
      "must not import anything from src/lib/brokers/*",
    );
  });
});
