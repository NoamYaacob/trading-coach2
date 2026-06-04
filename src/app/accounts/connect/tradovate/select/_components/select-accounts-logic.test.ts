import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  guessAccountType,
  buildDefaultAccountLabel,
} from "./select-accounts-logic.ts";

describe("buildDefaultAccountLabel", () => {
  it("appends a (Sim) marker for demo-env accounts with no display name", () => {
    // Tradovate names a sim account after its live account number, so without
    // this marker the demo row would be indistinguishable from the live one.
    assert.equal(buildDefaultAccountLabel("1868411", null, "demo"), "1868411 (Sim)");
  });

  it("leaves live-env account labels unmarked", () => {
    assert.equal(buildDefaultAccountLabel("1868411", null, "live"), "1868411");
  });

  it("keeps demo and live default labels distinct for the same broker name", () => {
    const demo = buildDefaultAccountLabel("1868411", null, "demo");
    const live = buildDefaultAccountLabel("1868411", null, "live");
    assert.notEqual(demo, live);
  });

  it("prefixes the display name when provided, then marks demo", () => {
    assert.equal(
      buildDefaultAccountLabel("1868411", "Apex Eval", "demo"),
      "Apex Eval — 1868411 (Sim)",
    );
    assert.equal(
      buildDefaultAccountLabel("1868411", "Personal", "live"),
      "Personal — 1868411",
    );
  });

  it("ignores whitespace-only display names", () => {
    assert.equal(buildDefaultAccountLabel("1868411", "   ", "demo"), "1868411 (Sim)");
    assert.equal(buildDefaultAccountLabel("1868411", "   ", "live"), "1868411");
  });
});

describe("guessAccountType", () => {
  it("maps demo source in demo env to demo", () => {
    assert.equal(guessAccountType("Customer", "demo", "demo"), "demo");
  });

  it("maps non-demo source in demo env to evaluation", () => {
    assert.equal(guessAccountType("Customer", "demo", "prop_firm"), "evaluation");
  });

  it("detects funded/eval from broker type in live env", () => {
    assert.equal(guessAccountType("Funded", "live", "prop_firm"), "funded");
    assert.equal(guessAccountType("Challenge", "live", "prop_firm"), "evaluation");
  });

  it("maps personal source to personal in live env", () => {
    assert.equal(guessAccountType("Customer", "live", "personal"), "personal");
  });
});
