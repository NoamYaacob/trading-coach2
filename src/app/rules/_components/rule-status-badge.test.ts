/**
 * Tests for the RuleStatusBadge taxonomy.
 *
 * Locks the variant → label mapping so future copy drift can't silently
 * mislabel internal-lock rules as broker-backed (or vice versa). The label
 * map is the single source of truth used by every section card.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ruleStatusLabel } from "./rule-status-badge-helpers.ts";

const SRC = readFileSync(
  resolve(import.meta.dirname, "rule-status-badge-helpers.ts"),
  "utf8",
);

describe("ruleStatusLabel — canonical label per variant", () => {
  it("broker-eligible → 'Broker-backed eligible' (Daily Loss only)", () => {
    assert.equal(ruleStatusLabel("broker-eligible"), "Broker-backed eligible");
  });

  it("guardrail-lock → 'Guardrail lock' (internal lock, no broker write)", () => {
    assert.equal(ruleStatusLabel("guardrail-lock"), "Guardrail lock");
  });

  it("monitoring-only → 'Monitoring only' (warning, never locks)", () => {
    assert.equal(ruleStatusLabel("monitoring-only"), "Monitoring only");
  });

  it("saved-eval-soon → 'Saved · Evaluation coming soon' (UI captures, no evaluator)", () => {
    assert.equal(
      ruleStatusLabel("saved-eval-soon"),
      "Saved · Evaluation coming soon",
    );
  });

  it("planned-broker → 'Planned broker action' (code exists, not safely active)", () => {
    assert.equal(ruleStatusLabel("planned-broker"), "Planned broker action");
  });

  it("not-active → 'Not active' (schema/UI gap)", () => {
    assert.equal(ruleStatusLabel("not-active"), "Not active");
  });
});

describe("RuleStatusBadge source: variant taxonomy is locked", () => {
  it("includes all six variant string keys", () => {
    for (const variant of [
      "broker-eligible",
      "guardrail-lock",
      "monitoring-only",
      "saved-eval-soon",
      "planned-broker",
      "not-active",
    ]) {
      assert.ok(
        SRC.includes(`"${variant}"`),
        `RuleStatusVariant must include the "${variant}" key`,
      );
    }
  });

  it("does not introduce additional 'Broker-side enforcement active' labels", () => {
    // Safety: no variant may render the literal phrase "broker-side enforcement
    // active" — only Daily Loss is broker-backed eligible, and even that
    // requires explicit opt-in.
    assert.ok(
      !/broker-side enforcement active/i.test(SRC),
      "no variant may claim broker-side enforcement is active",
    );
  });
});
