/**
 * Source-scan safety tests for POST /api/accounts/[id]/rules/copy.
 *
 * Verifies structural guarantees without a DB, network, or real credentials:
 *  1. Auth is checked before any DB query.
 *  2. Ownership is verified for BOTH target and source accounts.
 *  3. Self-copy is rejected.
 *  4. Source must have AccountRiskRules.
 *  5. Session lock uses all 3 signals (tradesCount, lastTradeAt, NormalizedTradeEvent).
 *  6. No first-time-setup exemption for session lock on copy.
 *  7. Target account is upserted; source is never written.
 *  8. RuleChangeAudit is written for both success and block paths.
 *  9. No TradovateClient import — no broker calls.
 * 10. No broker sync (executeDailyLossSync, writeBrokerRiskSettingsSyncAudit).
 * 11. Identity fields (consent, pending, accountId) are not in COPY_FIELDS.
 * 12. All core rule fields ARE in COPY_FIELDS.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTE = resolve(import.meta.dirname, "./route.ts");

function src(): string {
  return readFileSync(ROUTE, "utf8");
}

// ── Auth ──────────────────────────────────────────────────────────────────────

describe("copy endpoint: auth", () => {
  it("imports getCurrentUser", () => {
    assert.ok(src().includes("getCurrentUser"), "must import getCurrentUser");
  });

  it("returns 401 when no current user", () => {
    const s = src();
    assert.ok(s.includes('"unauthorized"'), "must return unauthorized error");
    assert.ok(s.includes("{ status: 401 }"), "must return 401 status");
  });
});

// ── Input validation ──────────────────────────────────────────────────────────

describe("copy endpoint: input validation", () => {
  it("rejects when sourceAccountId is missing", () => {
    const s = src();
    assert.ok(s.includes('"sourceAccountId required"'), "must reject missing sourceAccountId");
    assert.ok(s.includes("{ status: 400 }"), "must return 400 for bad input");
  });

  it("rejects self-copy (sourceAccountId === id)", () => {
    const s = src();
    assert.ok(s.includes('"cannot_copy_to_self"'), "must reject self-copy");
    assert.ok(s.includes("sourceAccountId === id"), "must check sourceAccountId !== id");
  });
});

// ── Ownership checks ──────────────────────────────────────────────────────────

describe("copy endpoint: ownership", () => {
  it("checks target account ownership (id + userId)", () => {
    const s = src();
    // Both id and userId must appear together in a findFirst where clause
    assert.ok(
      s.includes("userId: currentUser.id"),
      "must verify ownership with userId",
    );
    assert.ok(
      s.includes("where: { id, userId: currentUser.id }"),
      "must query target with { id, userId }",
    );
  });

  it("checks source account ownership (sourceAccountId + userId)", () => {
    const s = src();
    assert.ok(
      s.includes("where: { id: sourceAccountId, userId: currentUser.id }"),
      "must query source with { id: sourceAccountId, userId }",
    );
  });

  it("returns 404 when target not found / not owned", () => {
    const s = src();
    assert.ok(s.includes('"not_found"'), "must return not_found for unauthorized target");
  });

  it("returns 404 when source not found / not owned by current user", () => {
    const s = src();
    assert.ok(s.includes('"source_not_found"'), "must return source_not_found for unauthorized source");
  });
});

// ── Source rules validation ───────────────────────────────────────────────────

describe("copy endpoint: source rules", () => {
  it("rejects when source has no AccountRiskRules", () => {
    const s = src();
    assert.ok(s.includes('"source_has_no_rules"'), "must reject source without rules");
    assert.ok(s.includes("{ status: 422 }"), "must return 422 for missing source rules");
  });

  it("fetches source AccountRiskRules by sourceAccountId", () => {
    const s = src();
    assert.ok(
      s.includes("accountId: sourceAccountId"),
      "must fetch rules by sourceAccountId",
    );
  });
});

// ── Session lock ──────────────────────────────────────────────────────────────

describe("copy endpoint: session lock (3 signals)", () => {
  it("imports getAccountIdsWithTradeToday", () => {
    const s = src();
    assert.ok(
      s.includes("getAccountIdsWithTradeToday"),
      "must use NormalizedTradeEvent signal via getAccountIdsWithTradeToday",
    );
  });

  it("checks tradesCount signal", () => {
    const s = src();
    assert.ok(
      s.includes("tradesCount"),
      "must check tradesCount signal from LiveSessionState",
    );
  });

  it("checks lastTradeAt signal", () => {
    const s = src();
    assert.ok(
      s.includes("lastTradeAt"),
      "must check lastTradeAt signal from LiveSessionState",
    );
  });

  it("applies lock even for first-time setup (no isFirstTimeSetup exemption)", () => {
    const s = src();
    assert.ok(
      !s.includes("isFirstTimeSetup"),
      "copy endpoint must NOT have a first-time-setup exemption — copying after trading is always blocked",
    );
  });

  it("returns 423 with session_already_traded message", () => {
    const s = src();
    assert.ok(s.includes('"session_already_traded"'), "must return session_already_traded error");
    assert.ok(s.includes("{ status: 423 }"), "must return 423 when locked");
  });

  it("queries LiveSessionState for target account (id)", () => {
    const s = src();
    // liveSessionState query must use the target id (not sourceAccountId)
    assert.ok(
      s.includes("where: { accountId: id }"),
      "must query LiveSessionState for target account by id",
    );
  });
});

// ── Upsert — target only ──────────────────────────────────────────────────────

describe("copy endpoint: upsert target only", () => {
  it("calls prisma.accountRiskRules.upsert for target", () => {
    const s = src();
    assert.ok(
      s.includes("prisma.accountRiskRules.upsert"),
      "must upsert AccountRiskRules for target",
    );
  });

  it("clears pendingPayloadJson and pendingEffectiveDate on update", () => {
    const s = src();
    assert.ok(
      s.includes("pendingPayloadJson: Prisma.JsonNull"),
      "must clear pendingPayloadJson when copying (Prisma.JsonNull)",
    );
    assert.ok(
      s.includes("pendingEffectiveDate: null"),
      "must clear pendingEffectiveDate when copying",
    );
  });

  it("does not write to source account rules", () => {
    const s = src();
    // The only accountRiskRules write must use accountId: id (target), never sourceAccountId
    const upsertIdx = s.indexOf("prisma.accountRiskRules.upsert");
    assert.ok(upsertIdx !== -1, "must have an upsert call");
    const upsertBlock = s.slice(upsertIdx, upsertIdx + 300);
    assert.ok(
      !upsertBlock.includes("sourceAccountId"),
      "upsert block must not reference sourceAccountId — source account must never be mutated",
    );
  });

  it("upsert create block uses accountId: id (target)", () => {
    const s = src();
    // create block may be on multiple lines; check that accountId: id appears
    // inside the upsert create block (after "create:")
    const createIdx = s.indexOf("create:");
    assert.ok(createIdx !== -1, "upsert must have a create block");
    const createBlock = s.slice(createIdx, createIdx + 400);
    assert.ok(
      createBlock.includes("accountId: id"),
      "upsert create block must set accountId to target id",
    );
  });
});

// ── Audit ─────────────────────────────────────────────────────────────────────

describe("copy endpoint: RuleChangeAudit", () => {
  it("imports writeRuleChangeAudit", () => {
    const s = src();
    assert.ok(s.includes("writeRuleChangeAudit"), "must import and call writeRuleChangeAudit");
  });

  it("writes audit with allowed=true on success", () => {
    const s = src();
    assert.ok(s.includes("allowed: true"), "must write audit with allowed: true on success");
  });

  it("writes audit with allowed=false on block", () => {
    const s = src();
    assert.ok(s.includes("allowed: false"), "must write audit with allowed: false when blocked");
  });

  it("uses reason 'copied_from_account' for success audit", () => {
    const s = src();
    assert.ok(
      s.includes('"copied_from_account"'),
      "success audit must use reason copied_from_account",
    );
  });

  it("uses reason 'session_already_traded' for block audit", () => {
    const s = src();
    // Must appear both as reason and blockReason
    const count = (s.match(/"session_already_traded"/g) ?? []).length;
    assert.ok(
      count >= 2,
      "session_already_traded must appear as both reason and blockReason in blocked audit",
    );
  });

  it("includes sourceAccountId in audit newValuesJson", () => {
    const s = src();
    assert.ok(
      s.includes("_copiedFromAccountId"),
      "audit newValuesJson must include _copiedFromAccountId to trace the source",
    );
  });
});

// ── No broker calls ───────────────────────────────────────────────────────────

describe("copy endpoint: no broker calls", () => {
  it("does not import TradovateClient", () => {
    const s = src();
    assert.ok(
      !s.includes("TradovateClient"),
      "copy endpoint must not import or use TradovateClient — no broker calls in Phase 3",
    );
  });

  it("does not call executeDailyLossSync", () => {
    const s = src();
    assert.ok(
      !s.includes("executeDailyLossSync"),
      "copy endpoint must not trigger daily loss sync — no broker calls in Phase 3",
    );
  });

  it("does not call writeBrokerRiskSettingsSyncAudit", () => {
    const s = src();
    assert.ok(
      !s.includes("writeBrokerRiskSettingsSyncAudit"),
      "copy endpoint must not write broker sync audit — no broker sync in Phase 3",
    );
  });

  it("does not call applyMaxPositionSize", () => {
    const s = src();
    assert.ok(
      !s.includes("applyMaxPositionSize"),
      "copy endpoint must not sync max position size to broker",
    );
  });
});

// ── COPY_FIELDS — identity exclusions ────────────────────────────────────────

describe("copy endpoint: COPY_FIELDS excludes identity and consent fields", () => {
  it("does not copy id", () => {
    const s = src();
    const fieldsBlock = s.slice(s.indexOf("COPY_FIELDS"), s.indexOf("] as const"));
    assert.ok(!fieldsBlock.includes('"id"'), "COPY_FIELDS must not include id");
  });

  it("does not copy accountId", () => {
    const s = src();
    const fieldsBlock = s.slice(s.indexOf("COPY_FIELDS"), s.indexOf("] as const"));
    assert.ok(!fieldsBlock.includes('"accountId"'), "COPY_FIELDS must not include accountId");
  });

  it("does not copy automatedActionsConsentAt", () => {
    const s = src();
    const fieldsBlock = s.slice(s.indexOf("COPY_FIELDS"), s.indexOf("] as const"));
    assert.ok(
      !fieldsBlock.includes("automatedActionsConsentAt"),
      "COPY_FIELDS must not copy consent — consent is per-account",
    );
  });

  it("does not copy automatedActionsConsentVersion", () => {
    const s = src();
    const fieldsBlock = s.slice(s.indexOf("COPY_FIELDS"), s.indexOf("] as const"));
    assert.ok(
      !fieldsBlock.includes("automatedActionsConsentVersion"),
      "COPY_FIELDS must not copy consent version",
    );
  });

  it("does not copy pendingPayloadJson", () => {
    const s = src();
    const fieldsBlock = s.slice(s.indexOf("COPY_FIELDS"), s.indexOf("] as const"));
    assert.ok(
      !fieldsBlock.includes("pendingPayloadJson"),
      "COPY_FIELDS must not copy pending payload — pending changes are account-specific",
    );
  });

  it("does not copy pendingEffectiveDate", () => {
    const s = src();
    const fieldsBlock = s.slice(s.indexOf("COPY_FIELDS"), s.indexOf("] as const"));
    assert.ok(
      !fieldsBlock.includes("pendingEffectiveDate"),
      "COPY_FIELDS must not copy pendingEffectiveDate",
    );
  });
});

// ── COPY_FIELDS — rule field inclusions ──────────────────────────────────────

describe("copy endpoint: COPY_FIELDS includes all core rule fields", () => {
  const REQUIRED_FIELDS = [
    "maxDailyLoss",
    "riskPerTrade",
    "maxTradesPerDay",
    "stopAfterLosses",
    "allowedStartHour",
    "allowedEndHour",
    "sessionTimezone",
    "sessionEndBehavior",
    "sessionPreset",
    "sessionStartTime",
    "sessionEndTime",
    "sessionPresetsJson",
    "ruleEditLockBufferMinutes",
    "maxContracts",
    "maxContractsBySymbolJson",
    "rawBrokerHardLimitEnabled",
    "propFirmAccountSize",
    "propFirmPhase",
    "propFirmDailyLossLimit",
    "propFirmMaxDrawdown",
    "propFirmEODDrawdown",
    "propFirmTrailingDrawdown",
    "propFirmProfitTarget",
    "propFirmMinTradingDays",
  ];

  for (const field of REQUIRED_FIELDS) {
    it(`copies ${field}`, () => {
      const s = src();
      const fieldsBlock = s.slice(s.indexOf("COPY_FIELDS"), s.indexOf("] as const"));
      assert.ok(
        fieldsBlock.includes(`"${field}"`),
        `COPY_FIELDS must include "${field}"`,
      );
    });
  }
});

// ── Response shape ────────────────────────────────────────────────────────────

describe("copy endpoint: response shape", () => {
  it("returns ok: true on success", () => {
    assert.ok(src().includes("ok: true"), "success response must include ok: true");
  });

  it("returns copiedFrom in success response", () => {
    assert.ok(src().includes("copiedFrom:"), "success response must include copiedFrom");
  });

  it("returns targetAccountId in success response", () => {
    assert.ok(src().includes("targetAccountId:"), "success response must include targetAccountId");
  });
});

// ── Phase 4: symbol-specific max contracts passthrough ───────────────────────

describe("copy endpoint: maxContractsBySymbolJson passthrough", () => {
  it("COPY_FIELDS includes maxContractsBySymbolJson", () => {
    const s = src();
    const fieldsBlock = s.slice(s.indexOf("COPY_FIELDS"), s.indexOf("] as const"));
    assert.ok(
      fieldsBlock.includes('"maxContractsBySymbolJson"'),
      "COPY_FIELDS must include maxContractsBySymbolJson so symbol limits are copied",
    );
  });

  it("extractCopyData copies maxContractsBySymbolJson from the source", () => {
    assert.ok(
      src().includes("maxContractsBySymbolJson: sourceRules.maxContractsBySymbolJson"),
      "extractCopyData must copy maxContractsBySymbolJson from the source rules",
    );
  });

  it("does not import broker clients or trigger broker sync for symbol limits", () => {
    const s = src();
    for (const forbidden of ["TradovateClient", "applyMaxPositionSize", "executeDailyLossSync"]) {
      assert.ok(!s.includes(forbidden), `copy endpoint must not reference "${forbidden}"`);
    }
  });
});
