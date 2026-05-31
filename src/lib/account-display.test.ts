import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  deriveAccountDisplayLabel,
  deriveAccountFirmTag,
  deriveAccountPrimaryLabel,
  deriveAccountSecondaryMeta,
  deriveConnectionIdentity,
  suggestAccountDisplayName,
} from "./account-display.ts";

describe("deriveAccountDisplayLabel", () => {
  test("user-set displayName always wins", () => {
    assert.equal(
      deriveAccountDisplayLabel({
        displayName: "My eval",
        propFirm: "Apex",
        accountType: "evaluation",
        label: "APEX123",
      }),
      "My eval",
    );
  });

  test("blank displayName is ignored", () => {
    assert.equal(
      deriveAccountDisplayLabel({ displayName: "   ", propFirm: "Apex", accountType: "funded" }),
      "Apex Funded",
    );
  });

  test("prop firm + account type combine", () => {
    assert.equal(
      deriveAccountDisplayLabel({ propFirm: "MyFundedFutures", accountType: "evaluation" }),
      "MyFundedFutures Evaluation",
    );
  });

  test("prop firm alone when type missing", () => {
    assert.equal(deriveAccountDisplayLabel({ propFirm: "Topstep" }), "Topstep");
  });

  test("does not append Personal to a prop-firm account", () => {
    assert.equal(
      deriveAccountDisplayLabel({ propFirm: "Apex", accountType: "personal" }),
      "Apex",
    );
  });

  test("personal account with no firm → 'Personal account'", () => {
    assert.equal(deriveAccountDisplayLabel({ accountType: "personal" }), "Personal account");
  });

  test("falls back to broker label (account number) when no firm/type", () => {
    assert.equal(
      deriveAccountDisplayLabel({ accountType: "demo", label: "DEMO7433035" }),
      // demo type with no firm → not "Personal"; demo has no firm so falls to label
      "DEMO7433035",
    );
  });

  test("falls back to externalAccountId when label missing", () => {
    assert.equal(
      deriveAccountDisplayLabel({ accountType: "demo", externalAccountId: "7433035" }),
      "7433035",
    );
  });

  test("never returns a raw internal cuid DB id", () => {
    const out = deriveAccountDisplayLabel({
      label: "clh2k4j9b0000abcd1234efgh",
      externalAccountId: "clh2k4j9b0000abcd1234efgh",
    });
    assert.equal(out, "Account");
    assert.ok(!out.startsWith("cl"), "must not surface a cuid");
  });

  test("never returns a raw uuid", () => {
    assert.equal(
      deriveAccountDisplayLabel({ label: "550e8400-e29b-41d4-a716-446655440000" }),
      "Account",
    );
  });
});

describe("deriveAccountFirmTag", () => {
  test("prop firm wins", () => {
    assert.equal(deriveAccountFirmTag({ propFirm: "Apex", accountType: "funded" }), "Apex");
  });
  test("personal → Personal", () => {
    assert.equal(deriveAccountFirmTag({ accountType: "personal" }), "Personal");
  });
  test("type label when no firm", () => {
    assert.equal(deriveAccountFirmTag({ accountType: "demo" }), "Demo");
  });
});

describe("deriveConnectionIdentity", () => {
  test("no active accounts → provider + env only", () => {
    assert.equal(deriveConnectionIdentity("Tradovate", "Demo", []), "Tradovate Demo");
  });

  test("single account shows its firm tag", () => {
    assert.equal(
      deriveConnectionIdentity("Tradovate", "Demo", [{ propFirm: "MyFundedFutures" }]),
      "Tradovate Demo · MyFundedFutures",
    );
  });

  test("personal single account", () => {
    assert.equal(
      deriveConnectionIdentity("Tradovate", "Live", [{ accountType: "personal" }]),
      "Tradovate Live · Personal",
    );
  });

  test("multiple accounts, same firm → firm name", () => {
    assert.equal(
      deriveConnectionIdentity("Tradovate", "Demo", [
        { propFirm: "Apex" },
        { propFirm: "Apex" },
      ]),
      "Tradovate Demo · Apex",
    );
  });

  test("multiple accounts, mixed firms → count", () => {
    assert.equal(
      deriveConnectionIdentity("Tradovate", "Demo", [
        { propFirm: "Apex" },
        { propFirm: "Topstep" },
        { accountType: "personal" },
      ]),
      "Tradovate Demo · 3 accounts",
    );
  });

  test("no env label → provider only base", () => {
    assert.equal(
      deriveConnectionIdentity("Tradovate", "", [{ propFirm: "Apex" }]),
      "Tradovate · Apex",
    );
  });
});

describe("suggestAccountDisplayName", () => {
  test("ignores any existing displayName and suggests from firm/type", () => {
    assert.equal(
      suggestAccountDisplayName({ propFirm: "Topstep", accountType: "evaluation", label: "X" }),
      "Topstep Evaluation",
    );
  });
});

describe("deriveAccountPrimaryLabel", () => {
  test("user-set displayName wins over everything", () => {
    assert.equal(
      deriveAccountPrimaryLabel({
        displayName: "Apex eval #2",
        propFirm: "Apex",
        accountType: "evaluation",
        label: "APEX7788991",
        externalAccountId: "7788991",
      }),
      "Apex eval #2",
    );
  });

  test("exact broker label wins over generic firm/type", () => {
    // Two MyFundedFutures evaluations must not both collapse to the same
    // "MyFundedFutures Evaluation" — the broker label distinguishes them.
    assert.equal(
      deriveAccountPrimaryLabel({
        propFirm: "MyFundedFutures",
        accountType: "evaluation",
        label: "MFFUEVRPD133936251",
      }),
      "MFFUEVRPD133936251",
    );
  });

  test("generic firm/type is NOT used as primary when a broker label exists", () => {
    const primary = deriveAccountPrimaryLabel({
      propFirm: "MyFundedFutures",
      accountType: "evaluation",
      label: "MFFUEVRPD133936251",
    });
    assert.notEqual(primary, "MyFundedFutures Evaluation");
  });

  test("falls back to externalAccountId when label missing", () => {
    assert.equal(
      deriveAccountPrimaryLabel({
        propFirm: "Topstep",
        accountType: "funded",
        externalAccountId: "DEMO7433035",
      }),
      "DEMO7433035",
    );
  });

  test("uses firm/type only as a last resort when no broker identifier exists", () => {
    assert.equal(
      deriveAccountPrimaryLabel({ propFirm: "MyFundedFutures", accountType: "evaluation" }),
      "MyFundedFutures Evaluation",
    );
  });

  test("never surfaces an internal cuid as the primary label", () => {
    assert.equal(
      deriveAccountPrimaryLabel({ label: "clx0123456789abcdefghij", propFirm: "Apex" }),
      "Apex",
    );
  });

  test("never surfaces an internal uuid as the primary label", () => {
    assert.equal(
      deriveAccountPrimaryLabel({
        externalAccountId: "550e8400-e29b-41d4-a716-446655440000",
        accountType: "personal",
      }),
      "Personal account",
    );
  });

  test("final fallback is 'Account'", () => {
    assert.equal(deriveAccountPrimaryLabel({}), "Account");
  });
});

describe("deriveAccountSecondaryMeta", () => {
  test("combines firm and type with a separator", () => {
    assert.equal(
      deriveAccountSecondaryMeta({ propFirm: "MyFundedFutures", accountType: "evaluation" }),
      "MyFundedFutures · Evaluation",
    );
  });

  test("firm alone when type missing", () => {
    assert.equal(deriveAccountSecondaryMeta({ propFirm: "Apex" }), "Apex");
  });

  test("does not append type for a personal prop-firm account", () => {
    assert.equal(deriveAccountSecondaryMeta({ propFirm: "Apex", accountType: "personal" }), "Apex");
  });

  test("Personal for a personal account with no firm", () => {
    assert.equal(deriveAccountSecondaryMeta({ accountType: "personal" }), "Personal");
  });

  test("returns null when neither firm nor type is known", () => {
    assert.equal(deriveAccountSecondaryMeta({ label: "X123" }), null);
  });
});
