/**
 * Source-scan contract tests for the Tradovate finalize route.
 *
 * Finalize is the explicit user opt-in for a discovered broker account. A
 * ConnectedAccount row may already exist as `pending_decision` (created by
 * background discovery/reconciliation before the user picked it). The finalize
 * upsert must force that row to `protected` on BOTH create and update — the
 * shared `accountData` is applied in both branches — otherwise the dashboard
 * main list (protectionStatus IN ["protected","monitor_only"]) hides the
 * freshly-added account and it appears "missing."
 *
 * These tests read the route source rather than executing it (the handler is
 * tightly coupled to Prisma + auth) and assert the wiring is present.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const file = readFileSync(
  resolve(process.cwd(), "src/app/api/auth/tradovate/finalize/route.ts"),
  "utf8",
);

describe("Tradovate finalize — protection status", () => {
  it("applies a single shared accountData object on both create and update", () => {
    assert.ok(
      file.includes("const accountData ="),
      "finalize must build a shared accountData object used by both branches",
    );
    assert.ok(
      /update\(\{[\s\S]*?data: accountData/.test(file),
      "the existing-row branch must update with the shared accountData",
    );
    assert.ok(
      /create\(\{[\s\S]*?\.\.\.accountData/.test(file),
      "the create branch must spread the shared accountData",
    );
  });

  it("forces protectionStatus to 'protected' on finalize", () => {
    assert.ok(
      /protectionStatus:\s*"protected"/.test(file),
      "finalize must set protectionStatus to 'protected' so a pre-existing " +
        "pending_decision row becomes visible on the dashboard main list",
    );
  });

  it("clears any stale missingFromBrokerSince marker on finalize", () => {
    assert.ok(
      /missingFromBrokerSince:\s*null/.test(file),
      "finalize must clear missingFromBrokerSince — the account was just " +
        "confirmed present in the broker account list",
    );
  });
});
