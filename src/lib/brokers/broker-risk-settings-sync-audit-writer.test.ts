/**
 * Source-scan tests for BrokerRiskSettingsSyncAudit writer.
 *
 * These tests verify non-negotiable implementation guarantees:
 *
 *  1. The writer calls prisma.brokerRiskSettingsSyncAudit.create.
 *  2. The create is wrapped in try/catch — audit failure never crashes callers.
 *  3. The catch block logs but does not rethrow.
 *  4. The writer exports the correct function and type names.
 *  5. All required fields are present in the create payload.
 *  6. JSON fields use Prisma.InputJsonValue casting.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const WRITER_SRC = resolve(
  import.meta.dirname,
  "./broker-risk-settings-sync-audit-writer.ts",
);
const ROUTE_SRC = resolve(
  import.meta.dirname,
  "../../app/api/accounts/[id]/route.ts",
);
const CONSOLE_SRC = resolve(
  import.meta.dirname,
  "../../app/debug/safety-console/page.tsx",
);

function src(f: string): string {
  return readFileSync(f, "utf8");
}

// ── 1. Writer implementation guarantees ──────────────────────────────────────

describe("broker-risk-settings-sync-audit-writer: implementation", () => {
  it("calls prisma.brokerRiskSettingsSyncAudit.create", () => {
    const s = src(WRITER_SRC);
    assert.ok(
      s.includes("prisma.brokerRiskSettingsSyncAudit.create("),
      "writer must call prisma.brokerRiskSettingsSyncAudit.create",
    );
  });

  it("wraps create in try/catch — audit failure must never throw", () => {
    const s = src(WRITER_SRC);
    const createIdx = s.indexOf("prisma.brokerRiskSettingsSyncAudit.create(");
    assert.ok(createIdx !== -1);
    const tryIdx = s.lastIndexOf("try {", createIdx);
    assert.ok(tryIdx !== -1 && tryIdx < createIdx, "create must be inside try block");
    const catchIdx = s.indexOf("catch (err)", tryIdx);
    assert.ok(
      catchIdx !== -1 && catchIdx > createIdx,
      "must have catch block after create",
    );
  });

  it("catch block logs error but does not rethrow", () => {
    const s = src(WRITER_SRC);
    const catchIdx = s.indexOf("catch (err)");
    assert.ok(catchIdx !== -1);
    const catchBlock = s.slice(catchIdx, catchIdx + 200);
    assert.ok(
      catchBlock.includes("console.error"),
      "catch block must log the error",
    );
    assert.ok(
      !catchBlock.includes("throw "),
      "catch block must not rethrow — audit failure is non-fatal",
    );
  });

  it("exports writeBrokerRiskSettingsSyncAudit as async function", () => {
    const s = src(WRITER_SRC);
    assert.ok(
      s.includes("export async function writeBrokerRiskSettingsSyncAudit"),
      "must export writeBrokerRiskSettingsSyncAudit as named async function",
    );
  });

  it("exports BrokerRiskSettingsSyncAuditPayload type", () => {
    const s = src(WRITER_SRC);
    assert.ok(
      s.includes("export type BrokerRiskSettingsSyncAuditPayload"),
      "must export BrokerRiskSettingsSyncAuditPayload type",
    );
  });

  it("payload includes all required fields", () => {
    const s = src(WRITER_SRC);
    const requiredFields = [
      "userId",
      "broker",
      "ruleType",
      "dryRun",
      "brokerEnforcementEnabled",
      "outcome",
    ];
    for (const field of requiredFields) {
      assert.ok(
        s.includes(field),
        `BrokerRiskSettingsSyncAuditPayload must include required field: ${field}`,
      );
    }
  });

  it("JSON fields are cast as Prisma.InputJsonValue", () => {
    const s = src(WRITER_SRC);
    assert.ok(
      s.includes("Prisma.InputJsonValue"),
      "JSON fields must be cast as Prisma.InputJsonValue to satisfy the Prisma type system",
    );
  });
});

// ── 2. Route wire-up: audit written for all outcomes ─────────────────────────

describe("PATCH /api/accounts/[id]: broker sync audit wire-up", () => {
  it("imports writeBrokerRiskSettingsSyncAudit", () => {
    const s = src(ROUTE_SRC);
    assert.ok(
      s.includes("writeBrokerRiskSettingsSyncAudit"),
      "route must import and call writeBrokerRiskSettingsSyncAudit",
    );
  });

  it("writes audit row after successful executeDailyLossSync", () => {
    const s = src(ROUTE_SRC);
    const syncIdx = s.indexOf("executeDailyLossSync(");
    assert.ok(syncIdx !== -1);
    const afterSync = s.slice(syncIdx);
    assert.ok(
      afterSync.includes("writeBrokerRiskSettingsSyncAudit("),
      "writeBrokerRiskSettingsSyncAudit must be called after executeDailyLossSync",
    );
  });

  it("writes audit row in catch block for failed outcome", () => {
    const s = src(ROUTE_SRC);
    const catchIdx = s.indexOf("[accounts/patch] daily loss sync failed (non-fatal)");
    assert.ok(catchIdx !== -1, "must have the daily loss error log");
    const afterCatch = s.slice(catchIdx);
    assert.ok(
      afterCatch.includes("writeBrokerRiskSettingsSyncAudit("),
      "writeBrokerRiskSettingsSyncAudit must be called in the catch block for failed outcome",
    );
  });

  it("audit row includes broker: tradovate and ruleType: daily_loss_limit", () => {
    const s = src(ROUTE_SRC);
    assert.ok(s.includes('"tradovate"'), "audit must include broker: tradovate");
    assert.ok(s.includes('"daily_loss_limit"'), "audit must include ruleType: daily_loss_limit");
  });

  it("audit row captures brokerEnforcementEnabled from env at call time", () => {
    // The baseAudit object includes brokerEnforcementEnabled from process.env — verify
    // it's in the fire-and-forget block that calls writeBrokerRiskSettingsSyncAudit.
    const s = src(ROUTE_SRC);
    const syncBlockStart = s.indexOf("Sync Daily Loss risk setting");
    assert.ok(syncBlockStart !== -1, "must have daily loss sync block comment");
    const auditIdx = s.indexOf("writeBrokerRiskSettingsSyncAudit(", syncBlockStart);
    assert.ok(auditIdx !== -1);
    // brokerEnforcementEnabled is set in baseAudit before the first audit call
    const syncBlock = s.slice(syncBlockStart, auditIdx + 200);
    assert.ok(
      syncBlock.includes("BROKER_ENFORCEMENT_ENABLED"),
      "daily loss sync block must capture BROKER_ENFORCEMENT_ENABLED at call time",
    );
  });

  it("audit row captures dryRun from env at call time", () => {
    const s = src(ROUTE_SRC);
    const syncBlockStart = s.indexOf("Sync Daily Loss risk setting");
    assert.ok(syncBlockStart !== -1, "must have daily loss sync block comment");
    const auditIdx = s.indexOf("writeBrokerRiskSettingsSyncAudit(", syncBlockStart);
    assert.ok(auditIdx !== -1);
    const syncBlock = s.slice(syncBlockStart, auditIdx + 200);
    assert.ok(
      syncBlock.includes("ENFORCEMENT_DRY_RUN"),
      "daily loss sync block must capture ENFORCEMENT_DRY_RUN at call time",
    );
  });

  it("audit write failure does not crash the fire-and-forget block", () => {
    // writeBrokerRiskSettingsSyncAudit itself is wrapped in try/catch (never throws),
    // so the outer fire-and-forget catch block is still safe even if the audit write fails.
    const s = src(WRITER_SRC);
    const catchIdx = s.indexOf("catch (err)");
    assert.ok(catchIdx !== -1, "audit writer must have catch block");
    const catchBlock = s.slice(catchIdx, catchIdx + 200);
    assert.ok(!catchBlock.includes("throw "), "audit writer catch must not rethrow");
  });

  it("route still saves rules even if broker sync throws — audit in catch is non-fatal", () => {
    // The DB save (prisma.accountRiskRules.upsert) and writeRuleChangeAudit happen
    // BEFORE the fire-and-forget block. The fire-and-forget is void — it never
    // propagates back to the response.
    const s = src(ROUTE_SRC);
    const upsertIdx = s.indexOf("prisma.accountRiskRules.upsert(");
    // Find the daily loss fire-and-forget by its distinctive comment
    const dailyLossVoidIdx = s.indexOf("void (async", s.indexOf("Sync Daily Loss risk setting"));
    assert.ok(upsertIdx !== -1, "route must have accountRiskRules.upsert");
    assert.ok(dailyLossVoidIdx !== -1, "route must have daily loss void async block");
    assert.ok(
      upsertIdx < dailyLossVoidIdx,
      "accountRiskRules.upsert must happen BEFORE the daily loss fire-and-forget block",
    );
  });
});

// ── 3. gate_blocked audit writes correct gateFailureReason ───────────────────

describe("broker sync audit: gate failure reasons", () => {
  it("BROKER_ENFORCEMENT_ENABLED=false → gateFailureReason=broker_enforcement_disabled (via gate 1)", () => {
    // Source-level verification: the route captures the outcome.gateFailureReason
    // for gate_blocked results. gate 1 in tradovate-risk-settings-service.ts returns
    // gateFailureReason: "broker_enforcement_disabled" when BROKER_ENFORCEMENT_ENABLED=false.
    const s = src(ROUTE_SRC);
    assert.ok(
      s.includes("gateFailureReason"),
      "route must forward gateFailureReason from the sync outcome to the audit row",
    );
  });

  it("audit section on Safety Console shows gateFailureReason", () => {
    const s = src(CONSOLE_SRC);
    assert.ok(
      s.includes("gateFailureReason"),
      "Safety Console must display gateFailureReason for gate_blocked rows",
    );
  });
});

// ── 4. Safety Console: section present and admin-only ────────────────────────

describe("Safety Console: broker sync audit section", () => {
  it("includes 'Broker risk settings sync' section title", () => {
    const s = src(CONSOLE_SRC);
    assert.ok(
      s.includes("Broker risk settings sync"),
      "Safety Console must have a 'Broker risk settings sync' section",
    );
  });

  it("shows empty state when no sync attempts exist", () => {
    const s = src(CONSOLE_SRC);
    assert.ok(
      s.includes("No broker risk-settings sync attempts yet."),
      "Safety Console must show empty state message when no sync rows exist",
    );
  });

  it("queries brokerRiskSettingsSyncAudit from Prisma", () => {
    const s = src(CONSOLE_SRC);
    assert.ok(
      s.includes("prisma.brokerRiskSettingsSyncAudit.findMany("),
      "Safety Console must query brokerRiskSettingsSyncAudit",
    );
  });

  it("uses .catch() fallback so DB query failure does not crash the page", () => {
    const s = src(CONSOLE_SRC);
    const queryIdx = s.indexOf("prisma.brokerRiskSettingsSyncAudit.findMany(");
    assert.ok(queryIdx !== -1);
    // The query spans multiple lines — search up to 1000 chars for the .catch()
    const afterQuery = s.slice(queryIdx, queryIdx + 1000);
    assert.ok(
      afterQuery.includes(".catch("),
      "brokerRiskSettingsSyncAudit query must have .catch() fallback",
    );
  });

  it("page is protected by isAdminEmail check", () => {
    const s = src(CONSOLE_SRC);
    assert.ok(
      s.includes("isAdminEmail(currentUser.email)"),
      "Safety Console must be protected by isAdminEmail check",
    );
    assert.ok(
      s.includes("notFound()"),
      "Safety Console must call notFound() for non-admin users",
    );
  });

  it("displays outcome, dryRun, and amount for each sync row", () => {
    const s = src(CONSOLE_SRC);
    const sectionIdx = s.indexOf("BrokerSyncAuditSection");
    assert.ok(sectionIdx !== -1, "BrokerSyncAuditSection must be defined");
    const sectionBody = s.slice(sectionIdx);
    assert.ok(sectionBody.includes("outcome"), "section must display outcome");
    assert.ok(sectionBody.includes("dryRun"), "section must display dryRun flag");
    assert.ok(sectionBody.includes("amount"), "section must display amount");
  });
});
