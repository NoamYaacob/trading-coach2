import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { inferAccountClassification } from "./account-classification.ts";

// ── MyFundedFutures ───────────────────────────────────────────────────────────

describe("inferAccountClassification — MyFundedFutures", () => {
  it("matches MFFUEVBLDR133936250 → MyFundedFutures evaluation (high)", () => {
    const r = inferAccountClassification("MFFUEVBLDR133936250");
    assert.equal(r.propFirm, "MyFundedFutures");
    assert.equal(r.accountType, "evaluation");
    assert.equal(r.confidence, "high");
  });

  it("matches MFFUEV prefix", () => {
    const r = inferAccountClassification("MFFUEV123456");
    assert.equal(r.propFirm, "MyFundedFutures");
    assert.equal(r.confidence, "high");
  });

  it("matches MFFU prefix (shorter variant)", () => {
    const r = inferAccountClassification("MFFU9999");
    assert.equal(r.propFirm, "MyFundedFutures");
    assert.equal(r.confidence, "high");
  });

  it("is case-insensitive", () => {
    const r = inferAccountClassification("mffuevbldr123");
    assert.equal(r.propFirm, "MyFundedFutures");
    assert.equal(r.confidence, "high");
  });
});

// ── Apex Trader Funding ───────────────────────────────────────────────────────

describe("inferAccountClassification — Apex Trader Funding", () => {
  it("matches APEX prefix → Apex Trader Funding evaluation", () => {
    const r = inferAccountClassification("APEX12345");
    assert.equal(r.propFirm, "Apex Trader Funding");
    assert.equal(r.accountType, "evaluation");
    assert.equal(r.confidence, "high");
  });

  it("matches apex case-insensitively", () => {
    const r = inferAccountClassification("apex_trader_1");
    assert.equal(r.propFirm, "Apex Trader Funding");
  });
});

// ── Topstep ───────────────────────────────────────────────────────────────────

describe("inferAccountClassification — Topstep", () => {
  it("matches TST prefix → Topstep evaluation", () => {
    const r = inferAccountClassification("TST987654");
    assert.equal(r.propFirm, "Topstep");
    assert.equal(r.accountType, "evaluation");
    assert.equal(r.confidence, "high");
  });

  it("matches TOPSTEP prefix", () => {
    const r = inferAccountClassification("TOPSTEP001");
    assert.equal(r.propFirm, "Topstep");
    assert.equal(r.confidence, "high");
  });
});

// ── No match → Personal ───────────────────────────────────────────────────────

describe("inferAccountClassification — no match", () => {
  it("returns personal/low for an unrecognised account name", () => {
    const r = inferAccountClassification("SomeRandomAccount123");
    assert.equal(r.propFirm, null);
    assert.equal(r.accountType, "personal");
    assert.equal(r.confidence, "low");
  });

  it("returns personal/low for an empty string", () => {
    const r = inferAccountClassification("");
    assert.equal(r.propFirm, null);
    assert.equal(r.accountType, "personal");
    assert.equal(r.confidence, "low");
  });

  it("does NOT classify a plain Tradovate personal account as MFF", () => {
    // e.g. a personal demo account with a numeric label or the user's real name
    const r = inferAccountClassification("49392735");
    assert.equal(r.propFirm, null);
    assert.equal(r.confidence, "low");
  });

  it("does NOT classify a DEMO prefix account as MFF", () => {
    const r = inferAccountClassification("DEMO7433035");
    assert.equal(r.propFirm, null);
    assert.equal(r.confidence, "low");
  });

  it("does NOT classify a LIVE prefix account as a prop firm", () => {
    const r = inferAccountClassification("LIVE49380707");
    assert.equal(r.propFirm, null);
    assert.equal(r.confidence, "low");
  });

  it("MFF prefix without 'U' does not match MyFundedFutures", () => {
    // 'MFF' alone could be ambiguous; only 'MFFU' is a confirmed pattern
    const r = inferAccountClassification("MFF12345");
    assert.equal(r.propFirm, null);
    assert.equal(r.confidence, "low");
  });
});

// ── Isolation: separate accounts stay separate ────────────────────────────────

describe("inferAccountClassification — account isolation", () => {
  it("two different externalAccountIds are classified independently", () => {
    const a = inferAccountClassification("MFFUEVBLDR133936250");
    const b = inferAccountClassification("MFFUEVBLDR133920720");
    assert.equal(a.propFirm, "MyFundedFutures");
    assert.equal(b.propFirm, "MyFundedFutures");
    // They are independent calls — classification carries no sibling state.
    assert.notEqual(a, b);
  });

  it("a personal account label does not inherit MFF classification from a sibling", () => {
    inferAccountClassification("MFFUEVBLDR133936250"); // classify MFF first
    const personal = inferAccountClassification("49679664"); // then classify personal
    assert.equal(personal.propFirm, null, "personal account must not inherit MFF classification");
    assert.equal(personal.confidence, "low");
  });
});
