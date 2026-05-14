import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { inferConnectionClassification } from "./connection-classification.ts";
import type { SiblingAccount } from "./connection-classification.ts";

const MFF_EVAL: SiblingAccount = {
  brokerConnectionId: "conn-demo",
  propFirm: "MyFundedFutures",
  accountType: "evaluation",
};

const MFF_EVAL_2: SiblingAccount = {
  brokerConnectionId: "conn-demo",
  propFirm: "MyFundedFutures",
  accountType: "evaluation",
};

const MFF_FUNDED: SiblingAccount = {
  brokerConnectionId: "conn-demo",
  propFirm: "MyFundedFutures",
  accountType: "funded",
};

const APEX_EVAL: SiblingAccount = {
  brokerConnectionId: "conn-demo",
  propFirm: "Apex Trader Funding",
  accountType: "evaluation",
};

const PERSONAL: SiblingAccount = {
  brokerConnectionId: "conn-demo",
  propFirm: null,
  accountType: "personal",
};

const OTHER_CONN: SiblingAccount = {
  brokerConnectionId: "conn-live",
  propFirm: "MyFundedFutures",
  accountType: "evaluation",
};

// ── Single propFirm → inherit ─────────────────────────────────────────────────

describe("inferConnectionClassification — single propFirm", () => {
  it("inherits propFirm from the one existing firm on the connection", () => {
    const r = inferConnectionClassification("conn-demo", [MFF_EVAL]);
    assert.equal(r.inheritedPropFirm, "MyFundedFutures");
  });

  it("inherits accountType when all prop-firm siblings share the same type", () => {
    const r = inferConnectionClassification("conn-demo", [MFF_EVAL, MFF_EVAL_2]);
    assert.equal(r.inheritedPropFirm, "MyFundedFutures");
    assert.equal(r.inheritedAccountType, "evaluation");
  });

  it("does not inherit accountType when siblings mix evaluation and funded", () => {
    const r = inferConnectionClassification("conn-demo", [MFF_EVAL, MFF_FUNDED]);
    assert.equal(r.inheritedPropFirm, "MyFundedFutures");
    assert.equal(r.inheritedAccountType, null);
  });

  it("trims whitespace from propFirm before deduplication", () => {
    const padded: SiblingAccount = { brokerConnectionId: "conn-demo", propFirm: "  MyFundedFutures  ", accountType: "evaluation" };
    const r = inferConnectionClassification("conn-demo", [padded]);
    assert.equal(r.inheritedPropFirm, "MyFundedFutures");
  });
});

// ── Multiple propFirms → no guess ────────────────────────────────────────────

describe("inferConnectionClassification — multiple propFirms", () => {
  it("returns null when siblings disagree on propFirm", () => {
    const r = inferConnectionClassification("conn-demo", [MFF_EVAL, APEX_EVAL]);
    assert.equal(r.inheritedPropFirm, null);
    assert.equal(r.inheritedAccountType, null);
  });
});

// ── No propFirm siblings → null ───────────────────────────────────────────────

describe("inferConnectionClassification — no propFirm data", () => {
  it("returns null when all siblings have null propFirm", () => {
    const r = inferConnectionClassification("conn-demo", [PERSONAL]);
    assert.equal(r.inheritedPropFirm, null);
    assert.equal(r.inheritedAccountType, null);
  });

  it("returns null when siblings list is empty", () => {
    const r = inferConnectionClassification("conn-demo", []);
    assert.equal(r.inheritedPropFirm, null);
    assert.equal(r.inheritedAccountType, null);
  });
});

// ── Null connectionId → null ──────────────────────────────────────────────────

describe("inferConnectionClassification — null connectionId", () => {
  it("returns null classification for a pending account with no brokerConnectionId", () => {
    const r = inferConnectionClassification(null, [MFF_EVAL]);
    assert.equal(r.inheritedPropFirm, null);
    assert.equal(r.inheritedAccountType, null);
  });
});

// ── Cross-connection isolation ────────────────────────────────────────────────

describe("inferConnectionClassification — cross-connection isolation", () => {
  it("only considers siblings on the same connection, not a different one", () => {
    // pending is on "conn-demo"; MFF_EVAL is also on "conn-demo" so it should match
    const r = inferConnectionClassification("conn-demo", [MFF_EVAL, OTHER_CONN]);
    assert.equal(r.inheritedPropFirm, "MyFundedFutures");
  });

  it("returns null when the matching siblings are on a different connection", () => {
    // pending is on "conn-other"; only MFF on "conn-demo" and "conn-live"
    const r = inferConnectionClassification("conn-other", [MFF_EVAL, OTHER_CONN]);
    assert.equal(r.inheritedPropFirm, null);
  });
});

// ── Personal sibling mixed with prop-firm sibling ────────────────────────────

describe("inferConnectionClassification — personal sibling ignored", () => {
  it("personal siblings (null propFirm) do not count toward propFirm detection", () => {
    const r = inferConnectionClassification("conn-demo", [MFF_EVAL, PERSONAL]);
    assert.equal(r.inheritedPropFirm, "MyFundedFutures");
    assert.equal(r.inheritedAccountType, "evaluation");
  });

  it("personal accountType is not included in accountType deduplication", () => {
    // PERSONAL has accountType "personal" but propFirm null, so excluded
    const r = inferConnectionClassification("conn-demo", [MFF_EVAL, PERSONAL]);
    assert.equal(r.inheritedAccountType, "evaluation");
  });
});

// ── MFFUEVBLDR scenario ───────────────────────────────────────────────────────

describe("inferConnectionClassification — MFF account scenario", () => {
  it("new MFFUEVBLDR account inherits MyFundedFutures from connection siblings", () => {
    const existing = [
      { brokerConnectionId: "conn-demo", propFirm: "MyFundedFutures", accountType: "evaluation" },
      { brokerConnectionId: "conn-demo", propFirm: "MyFundedFutures", accountType: "evaluation" },
    ];
    const r = inferConnectionClassification("conn-demo", existing);
    assert.equal(r.inheritedPropFirm, "MyFundedFutures");
    assert.equal(r.inheritedAccountType, "evaluation");
  });
});
