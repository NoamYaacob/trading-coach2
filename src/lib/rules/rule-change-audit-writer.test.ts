/**
 * Source-scan tests for rule-change-audit-writer.ts.
 * These tests verify the implementation guarantees without requiring a database.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const source = readFileSync(
  join(__dirname, "rule-change-audit-writer.ts"),
  "utf-8",
);

describe("rule-change-audit-writer — source-scan invariants", () => {
  it("contains prisma.ruleChangeAudit.create call", () => {
    assert.ok(
      source.includes("prisma.ruleChangeAudit.create"),
      "expected prisma.ruleChangeAudit.create in source",
    );
  });

  it("wraps the write in a try/catch (never throws on audit failure)", () => {
    assert.ok(
      source.includes("try {"),
      "expected try block to guard audit write",
    );
    assert.ok(
      source.includes("} catch"),
      "expected catch block — audit failures must be swallowed",
    );
  });

  it("catch block logs the error rather than rethrowing", () => {
    // Must log to console so ops can debug, but must NOT rethrow.
    assert.ok(
      source.includes("console.error"),
      "expected console.error in catch block for audit write failures",
    );
    assert.ok(
      !source.includes("throw err"),
      "must not rethrow in catch — audit writes must not crash request path",
    );
  });

  it("exports writeRuleChangeAudit as a named export", () => {
    assert.ok(
      source.includes("export async function writeRuleChangeAudit"),
      "expected named export 'writeRuleChangeAudit'",
    );
  });

  it("exports RuleChangeAuditPayload type", () => {
    assert.ok(
      source.includes("export type RuleChangeAuditPayload"),
      "expected named type export 'RuleChangeAuditPayload'",
    );
  });

  it("payload includes userId, accountId, scope, allowed, reason", () => {
    assert.ok(source.includes("userId:"), "expected userId field");
    assert.ok(source.includes("accountId:"), "expected accountId field");
    assert.ok(source.includes("scope:"), "expected scope field");
    assert.ok(source.includes("allowed:"), "expected allowed field");
    assert.ok(source.includes("reason:"), "expected reason field");
  });
});
