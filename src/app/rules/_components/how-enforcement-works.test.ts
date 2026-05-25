/**
 * Source-scan tests for the HowEnforcementWorks panel.
 *
 * The panel is the single home for the long enforcement-truth disclosure.
 * It must describe each variant accurately and must never claim broker
 * order blocking, cancel, or flatten is active.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(import.meta.dirname, "how-enforcement-works.tsx"),
  "utf8",
);

describe("HowEnforcementWorks — single source of long enforcement disclosure", () => {
  it("names the canonical badge variants Daily Loss / Guardrail lock / Monitoring / Saved / Planned", () => {
    for (const phrase of [
      "Broker-backed eligible",
      "Guardrail lock",
      "Monitoring only",
      "Saved · Evaluation coming soon",
      "Planned broker action",
    ]) {
      assert.ok(SRC.includes(phrase), `must explain "${phrase}"`);
    }
  });

  it("scopes broker-backed enforcement to Daily Loss only", () => {
    assert.ok(
      /Daily Loss only/.test(SRC),
      "panel must state that broker-backed enforcement is for Daily Loss only",
    );
  });

  it("does NOT claim cancel/flatten/order-blocking is active", () => {
    // The phrase may wrap across JSX lines; collapse whitespace before matching.
    const flat = SRC.replace(/\s+/g, " ");
    assert.ok(
      /not active in this beta/i.test(flat),
      "panel must explicitly state that cancel/flatten/order blocking are not active",
    );
  });

  it("describes Guardrail lock as app-level, not broker-side", () => {
    const lower = SRC.toLowerCase();
    assert.ok(
      lower.includes("app-level only") || lower.includes("locked inside the app"),
      "must describe Guardrail lock as app-level",
    );
  });

  it("starts collapsed by default", () => {
    // Use the <details> element without a default-open attribute so the panel
    // is collapsed on first render.
    assert.ok(SRC.includes("<details"), "must use a <details> element");
    assert.ok(
      !/<details[^>]*\bopen\b/.test(SRC),
      "<details> must NOT default to open — the panel collapses by default",
    );
  });
});
