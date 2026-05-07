import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isPreviewEnabled, buildPreviewPendingAccount } from "./discovery-preview.ts";

const PREVIEW_EMAIL = "noamyaacob12@gmail.com";

describe("isPreviewEnabled", () => {
  it("returns true when flag is 'true' and email matches", () => {
    assert.equal(isPreviewEnabled("true", PREVIEW_EMAIL), true);
  });

  it("returns false when flag is 'false'", () => {
    assert.equal(isPreviewEnabled("false", PREVIEW_EMAIL), false);
  });

  it("returns false when flag is undefined", () => {
    assert.equal(isPreviewEnabled(undefined, PREVIEW_EMAIL), false);
  });

  it("returns false when email does not match", () => {
    assert.equal(isPreviewEnabled("true", "other@example.com"), false);
  });

  it("returns false when email is null", () => {
    assert.equal(isPreviewEnabled("true", null), false);
  });

  it("returns false when email is undefined", () => {
    assert.equal(isPreviewEnabled("true", undefined), false);
  });
});

describe("buildPreviewPendingAccount", () => {
  it("sets isPreview = true", () => {
    const account = buildPreviewPendingAccount(null);
    assert.equal(account.isPreview, true);
  });

  it("uses provided mffBrokerConnectionId", () => {
    const account = buildPreviewPendingAccount("conn-mff-123");
    assert.equal(account.brokerConnectionId, "conn-mff-123");
  });

  it("accepts null connectionId", () => {
    const account = buildPreviewPendingAccount(null);
    assert.equal(account.brokerConnectionId, null);
  });

  it("sets inheritedPropFirm to MyFundedFutures", () => {
    const account = buildPreviewPendingAccount(null);
    assert.equal(account.inheritedPropFirm, "MyFundedFutures");
  });

  it("sets env to demo", () => {
    const account = buildPreviewPendingAccount(null);
    assert.equal(account.env, "demo");
  });
});
