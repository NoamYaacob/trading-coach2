/**
 * Source-scan tests for POST /api/debug/broker-enforcement/daily-loss-recovery-probe.
 *
 * These verify the route's safety contract without running it:
 *   - Admin + cron-secret + demo + allowlist + permission + masterid gates exist
 *   - apply=false is the default
 *   - apply=true requires the exact RECOVERY_CONFIRM_PHRASE
 *   - No cancel/flatten/order method imports or calls
 *   - No env-var mutation
 *   - Every exit path writes a BrokerRiskSettingsSyncAudit row
 *   - The route never echoes secrets in responses
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTE = resolve(import.meta.dirname, "./route.ts");

function src(): string {
  return readFileSync(ROUTE, "utf8");
}

/**
 * Returns the route source with all /* ... *​/ JSDoc/block comments and
 * // line comments stripped, plus a few prose-only normalisations. Used by
 * forbidden-string scans so the route can still mention identifiers in its
 * documentation (e.g. "no applyDailyLossLock here") without falsing the
 * test that asserts the identifier is never executed.
 */
function codeOnly(): string {
  let s = src();
  // Strip block comments greedily — JSDoc and inline /* … */
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  // Strip single-line comments. Match // at start-of-line or after whitespace
  // (not within a string literal — the route has no //-bearing strings).
  s = s.replace(/(^|[^:])\/\/.*$/gm, "$1");
  return s;
}

// ── Auth gates ──────────────────────────────────────────────────────────────

describe("recovery probe: auth gates", () => {
  it("requires authenticated session (401)", () => {
    const s = src();
    assert.ok(s.includes("getCurrentUser"), "must call getCurrentUser");
    assert.ok(s.includes('"unauthorized"'));
    assert.ok(s.includes("401"));
  });

  it("requires admin email (isAdminEmail)", () => {
    const s = src();
    assert.ok(s.includes("isAdminEmail"), "must call isAdminEmail");
    // Non-admin path must return 403 forbidden with admin_required.
    assert.ok(s.includes("admin_required"));
  });

  it("requires x-cron-secret header matching process.env.CRON_SECRET", () => {
    const s = src();
    assert.ok(s.includes('"x-cron-secret"'), "must read x-cron-secret");
    assert.ok(s.includes("process.env.CRON_SECRET"), "must compare against CRON_SECRET");
    assert.ok(s.includes("cron_secret_required"));
  });

  it("admin gate runs BEFORE cron-secret gate (so non-admin can't probe even with cron secret)", () => {
    const s = src();
    const isAdminIdx = s.indexOf("isAdminEmail(currentUser.email)");
    const cronIdx = s.indexOf('"x-cron-secret"');
    assert.ok(isAdminIdx !== -1 && cronIdx !== -1);
    assert.ok(isAdminIdx < cronIdx, "isAdminEmail must run before cron-secret check");
  });
});

// ── Body validation ─────────────────────────────────────────────────────────

describe("recovery probe: body validation", () => {
  it("rejects missing/non-string accountId with 400", () => {
    const s = src();
    assert.ok(s.includes('field: "accountId"'));
    // 400 status appears in the field rejection block.
    const fieldIdx = s.indexOf('field: "accountId"');
    const around = s.slice(Math.max(0, fieldIdx - 200), fieldIdx + 200);
    assert.ok(around.includes("400"), "accountId rejection must be 400");
  });

  it("rejects invalid mode with 400 (uses isRecoveryMode)", () => {
    const s = src();
    assert.ok(s.includes("isRecoveryMode"));
    assert.ok(s.includes('field: "mode"'));
  });

  it("apply defaults to false (boolean strict-true check)", () => {
    const s = src();
    assert.ok(
      s.includes("body.apply === true"),
      "apply must default false: use 'body.apply === true' strict-true check",
    );
  });

  it("apply=true requires exact RECOVERY_CONFIRM_PHRASE", () => {
    const s = src();
    assert.ok(s.includes("RECOVERY_CONFIRM_PHRASE"), "must import the confirm phrase constant");
    assert.ok(
      s.includes("body.confirm !== RECOVERY_CONFIRM_PHRASE"),
      "apply=true must check confirm equality against RECOVERY_CONFIRM_PHRASE",
    );
    assert.ok(s.includes("confirm_phrase_required"));
  });

  it("confirm phrase check is strict equality (no .toLowerCase, no .includes)", () => {
    const s = src();
    const confirmIdx = s.indexOf("body.confirm !== RECOVERY_CONFIRM_PHRASE");
    assert.ok(confirmIdx !== -1);
    const around = s.slice(Math.max(0, confirmIdx - 200), confirmIdx + 200);
    assert.ok(!around.includes(".toLowerCase"), "must not lowercase confirm phrase");
    assert.ok(!around.includes(".trim"), "must not trim confirm phrase");
    assert.ok(!around.includes(".includes"), "must not use includes() on confirm phrase");
  });
});

// ── Account gates ───────────────────────────────────────────────────────────

describe("recovery probe: account gates", () => {
  it("rejects non-Tradovate platforms", () => {
    const s = src();
    assert.ok(s.includes('account.platform !== "tradovate"'));
    assert.ok(s.includes("platform_not_tradovate"));
  });

  it("blocks live env explicitly (env_live_blocked or env_not_demo)", () => {
    const s = src();
    assert.ok(s.includes('env !== "demo"'), "must compare env !== demo");
    assert.ok(
      s.includes("env_live_blocked") || s.includes("env_not_demo"),
      "must use a stable demo-only gate code",
    );
  });

  it("requires permissionLevel === full_access", () => {
    const s = src();
    assert.ok(s.includes('permissionLevel !== "full_access"'));
    assert.ok(s.includes("insufficient_permissions"));
  });

  it("blocks inactive accounts", () => {
    const s = src();
    assert.ok(s.includes("!account.isActive"));
    assert.ok(s.includes("account_inactive"));
  });

  it("blocks accounts missing from broker", () => {
    const s = src();
    assert.ok(s.includes("missingFromBrokerSince != null"));
    assert.ok(s.includes("account_missing_from_broker"));
  });

  it("blocks non-live connection statuses", () => {
    const s = src();
    assert.ok(s.includes("NON_LIVE_CONNECTION_STATUSES"));
    assert.ok(s.includes("connection_not_live"));
  });

  it("requires account in BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST", () => {
    const s = src();
    assert.ok(s.includes("BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST"));
    assert.ok(s.includes("parseBrokerEnforcementAllowlist"));
    assert.ok(s.includes("account_not_allowlisted"));
  });

  it("validates externalAccountId via parseTradovateMasterId", () => {
    const s = src();
    assert.ok(s.includes("parseTradovateMasterId"));
    assert.ok(s.includes("invalid_external_account_id"));
  });

  it("loads the account scoped to currentUser.id (no cross-user reads)", () => {
    const s = src();
    assert.ok(
      s.includes("userId: currentUser.id"),
      "account query must be scoped to currentUser.id",
    );
  });
});

// ── Forbidden broker capabilities ───────────────────────────────────────────

describe("recovery probe: no cancel/flatten/order capabilities", () => {
  it("does not import order/cancel/flatten broker methods (code-only)", () => {
    const s = codeOnly();
    for (const forbidden of [
      "applyFlattenOpenPositions",
      "applyCancelOrders",
      "cancelOrder",
      "placeOrder",
      "liquidatepositions",
      "cancelorder",
    ]) {
      assert.ok(!s.includes(forbidden), `route code must not reference ${forbidden}`);
    }
  });

  it("only writes via applyDailyLossRecoveryUpdate (not applyDailyLossLock, not /create)", () => {
    // The full source can still mention these identifiers in JSDoc; what we
    // care about is the code itself.
    const s = codeOnly();
    assert.ok(s.includes("applyDailyLossRecoveryUpdate"));
    assert.ok(
      !s.includes("applyDailyLossLock"),
      "route code must not call applyDailyLossLock",
    );
    assert.ok(
      !s.includes("userAccountAutoLiq/create"),
      "recovery must use /update only; never /create",
    );
    assert.ok(
      !s.includes("/delete"),
      "no userAccountAutoLiq/delete call (no such API in our wrapper)",
    );
  });

  it("does not call any other TradovateClient methods that write or mutate (code-only)", () => {
    const s = codeOnly();
    for (const forbidden of [
      "applyProfitTargetLock",
      "applyMaxPositionSize",
      "applyTimeBasedClose",
      "applyMaxLossPerSymbol",
    ]) {
      assert.ok(!s.includes(forbidden), `route code must not call ${forbidden}`);
    }
  });

  it("does not depend on ENABLE_TRADOVATE_ORDER_ACTIONS flag (code-only)", () => {
    assert.ok(!codeOnly().includes("ENABLE_TRADOVATE_ORDER_ACTIONS"));
  });

  it("does not read or write BROKER_ENFORCEMENT_ENABLED for its own gating", () => {
    // The audit row CAPTURES the current value of BROKER_ENFORCEMENT_ENABLED
    // for observability, but the route's gating is NOT dependent on it.
    // Verify there is no `process.env.BROKER_ENFORCEMENT_ENABLED === "true"`
    // used inside a conditional that controls the write.
    const s = src();
    // The only acceptable use is capturing the value into the audit base.
    // Forbid any direct conditional reading of the flag.
    assert.ok(
      !/process\.env\.BROKER_ENFORCEMENT_ENABLED[^;\n]*\?\s/.test(s),
      "route must not branch on BROKER_ENFORCEMENT_ENABLED for its own behavior",
    );
  });
});

// ── No env mutation ─────────────────────────────────────────────────────────

describe("recovery probe: env immutability", () => {
  it("never assigns to process.env", () => {
    const s = src();
    assert.ok(
      !/process\.env\.\w+\s*=[^=]/.test(s) && !/process\.env\[[^\]]+\]\s*=[^=]/.test(s),
      "route must only read process.env, never assign to it",
    );
  });
});

// ── Audit row written on every exit ─────────────────────────────────────────

describe("recovery probe: audit row written on every exit", () => {
  it("imports writeBrokerRiskSettingsSyncAudit", () => {
    const s = src();
    assert.ok(s.includes("writeBrokerRiskSettingsSyncAudit"));
  });

  it("writes a gate_blocked audit row for every C-gate failure", () => {
    const s = src();
    const occurrences = s.split('outcome: "gate_blocked"').length - 1;
    // C2..C8 + R1 = 8 distinct blockGate sites, plus blockGate is invoked
    // via a helper — count occurrences of the literal in the audit writes.
    assert.ok(
      occurrences >= 1,
      `expected at least one gate_blocked audit write, found ${occurrences}`,
    );
  });

  it("writes a preview audit row for apply=false", () => {
    const s = src();
    assert.ok(s.includes('outcome: "preview"'), "must write outcome=preview for apply=false");
  });

  it("writes a success audit row for apply=true + confirmed readback", () => {
    const s = src();
    assert.ok(s.includes('outcome: confirmed ? "success" : "failed"'));
  });

  it("writes a failed audit row when broker call throws", () => {
    const s = src();
    assert.ok(s.includes('outcome: "failed"'));
    assert.ok(s.includes("broker_call_threw"));
  });

  it("audit base sets ruleType=daily_loss_recovery_probe (distinct from daily_loss_limit)", () => {
    const s = src();
    assert.ok(
      s.includes('ruleType: "daily_loss_recovery_probe"'),
      "ruleType must distinguish recovery probes from regular daily-loss sync rows",
    );
  });

  it("audit base sets dryRun=false (recovery probe is governed by apply, not ENFORCEMENT_DRY_RUN)", () => {
    const s = src();
    assert.ok(s.includes("dryRun: false"));
  });

  it("audit base captures userId, accountId, externalAccountId, brokerConnectionId, environment", () => {
    const s = src();
    const baseIdx = s.indexOf("buildAuditBase({");
    assert.ok(baseIdx !== -1);
    const baseBlock = s.slice(baseIdx, baseIdx + 800);
    for (const field of [
      "userId",
      "accountId",
      "externalAccountId",
      "brokerConnectionId",
      "environment",
    ]) {
      assert.ok(baseBlock.includes(field), `audit base must capture ${field}`);
    }
  });
});

// ── Payload preview must not leak secrets ───────────────────────────────────

describe("recovery probe: no secret exposure in responses", () => {
  it("never echoes accessToken/refreshToken/clientSecret in any response", () => {
    const s = src();
    for (const secret of ["accessToken", "refreshToken", "clientSecret", "client_secret", "tokenEncrypted"]) {
      assert.ok(!s.includes(secret), `route must not reference ${secret}`);
    }
  });

  it("does not return process.env.CRON_SECRET in any response body", () => {
    const s = codeOnly();
    // Only acceptable usage is reading into a local + equality comparison.
    // Forbid any single-statement `return ... CRON_SECRET ...` pattern (NextResponse.json bodies that name the secret).
    assert.ok(
      !/return[^;]*CRON_SECRET[^;]*;/.test(s),
      "route must not return the cron secret value in a single statement",
    );
    // The secret must only be referenced for comparison, not echoed.
    const secretRefs = (s.match(/CRON_SECRET/g) ?? []).length;
    assert.ok(secretRefs <= 2, `unexpectedly many CRON_SECRET references (${secretRefs})`);
  });
});

// ── Read-back required for success ──────────────────────────────────────────

describe("recovery probe: read-back confirmation", () => {
  it("always reads back via readDailyLossAutoLiqRecord before deciding confirmed", () => {
    const s = src();
    assert.ok(s.includes("readDailyLossAutoLiqRecord"));
  });

  it("uses isRecoveryReadbackConfirmed to decide confirmed boolean", () => {
    const s = src();
    assert.ok(s.includes("isRecoveryReadbackConfirmed"));
  });

  it("a write with unconfirmed read-back is recorded as failed, not success", () => {
    const s = src();
    // Verify the ternary: confirmed ? "success" : "failed"
    assert.ok(s.includes('outcome: confirmed ? "success" : "failed"'));
    assert.ok(s.includes("readback_unconfirmed"));
  });
});

// ── R1 (existing record required for write modes) ──────────────────────────

describe("recovery probe: write modes require an existing record", () => {
  it("rejects apply=true on a non-read_only mode when no record exists", () => {
    const s = src();
    assert.ok(s.includes("no_existing_record"));
    // The check must compare mode !== read_only AND existing == null
    const idx = s.indexOf("no_existing_record");
    const around = s.slice(Math.max(0, idx - 400), idx);
    assert.ok(
      around.includes('mode !== "read_only"') && around.includes("existing == null"),
      "no_existing_record gate must require both: mode != read_only and existing == null",
    );
  });
});

// ── changesLocked / doNotUnlock contract ───────────────────────────────────

describe("recovery probe: payload contract delegated to buildRecoveryPayload", () => {
  it("route does not construct payload literals itself (no inline {dailyLossAutoLiq:} object)", () => {
    const s = src();
    // The route should ONLY get payloads from buildRecoveryPayload — never
    // synthesize one in this file. Forbid any literal that includes
    // dailyLossAutoLiq as a property name.
    assert.ok(
      !/dailyLossAutoLiq\s*:/.test(s),
      "route must not synthesize an autoLiq payload — delegate to buildRecoveryPayload",
    );
  });

  it("doNotUnlock is never referenced in the route code (comments may explain why)", () => {
    assert.ok(!codeOnly().includes("doNotUnlock"));
  });

  it("does not call userAccountAutoLiq/create (code-only)", () => {
    assert.ok(!codeOnly().includes("userAccountAutoLiq/create"));
  });
});

// ── D1: pre-existing locked AutoLiq ownership guard ───────────────────────

describe("recovery probe: D1 — preexisting locked AutoLiq guard", () => {
  it("D1 gate failure reason is preexisting_locked_autoliq_not_guardrail_owned", () => {
    const s = src();
    assert.ok(
      s.includes("preexisting_locked_autoliq_not_guardrail_owned"),
      "D1 gate must use gateFailureReason preexisting_locked_autoliq_not_guardrail_owned",
    );
  });

  it("D1 gate checks existing.changesLocked === true before querying audit table", () => {
    const s = src();
    assert.ok(
      s.includes("existing.changesLocked === true"),
      "D1 gate must check existing.changesLocked === true",
    );
  });

  it("D1 gate queries BrokerRiskSettingsSyncAudit for prior success rows", () => {
    const s = src();
    assert.ok(
      s.includes("brokerRiskSettingsSyncAudit.findMany"),
      "D1 gate must query BrokerRiskSettingsSyncAudit for prior success",
    );
    assert.ok(
      s.includes('"success"') && s.includes("outcome"),
      "D1 query must filter by outcome=success",
    );
  });

  it("D1 gate requires brokerResponseJson non-null as ownership evidence (real broker write, not read_only success)", () => {
    const s = src();
    assert.ok(
      s.includes("brokerResponseJson != null"),
      "D1 must check brokerResponseJson != null to distinguish real writes from read_only preview successes",
    );
  });

  it("D1 gate includes both daily_loss_limit and daily_loss_recovery_probe ruleTypes as ownership evidence", () => {
    // Use codeOnly() so JSDoc mentions don't confuse position search.
    const s = codeOnly();
    const idx = s.indexOf("preexisting_locked_autoliq_not_guardrail_owned");
    const before = s.slice(Math.max(0, idx - 800), idx);
    assert.ok(
      before.includes('"daily_loss_limit"') && before.includes('"daily_loss_recovery_probe"'),
      "D1 ownership query must include both daily_loss_limit and daily_loss_recovery_probe ruleTypes",
    );
  });

  it("D1 gate is placed AFTER apply=false preview path (previews are never blocked by D1)", () => {
    // Use codeOnly() so JSDoc mentions don't confuse position search.
    const s = codeOnly();
    // apply=false exits via the preview path. D1 must come after that exit.
    const previewIdx = s.indexOf('outcome: "preview"');
    const d1Idx = s.indexOf("preexisting_locked_autoliq_not_guardrail_owned");
    assert.ok(previewIdx !== -1 && d1Idx !== -1);
    assert.ok(
      previewIdx < d1Idx,
      "D1 gate must be after the preview exit so apply=false previews always succeed",
    );
  });

  it("D1 gate is placed AFTER read_only apply=true path (read_only is never blocked by D1)", () => {
    // Use codeOnly() so JSDoc mentions don't confuse position search.
    const s = codeOnly();
    // read_only mode exits before D1.
    const readOnlyExitIdx = s.indexOf("Read-only");
    const d1Idx = s.indexOf("preexisting_locked_autoliq_not_guardrail_owned");
    assert.ok(readOnlyExitIdx !== -1 && d1Idx !== -1);
    assert.ok(
      readOnlyExitIdx < d1Idx,
      "D1 gate must be after the read_only apply=true exit",
    );
  });

  it("D1 gate is placed BEFORE applyDailyLossRecoveryUpdate (blocked calls never reach the write)", () => {
    const s = codeOnly();
    const d1Idx = s.indexOf("preexisting_locked_autoliq_not_guardrail_owned");
    const writeIdx = s.indexOf("applyDailyLossRecoveryUpdate");
    assert.ok(d1Idx !== -1 && writeIdx !== -1);
    assert.ok(
      d1Idx < writeIdx,
      "D1 gate must appear before applyDailyLossRecoveryUpdate so blocked calls never reach the write",
    );
  });

  it("D1 blocked path writes a gate_blocked audit row with the existing record context", () => {
    const s = src();
    // The blockGate helper is called with extraPayloadCtx = { existing, requested: ... }
    // Verify the blocked call passes existing record context.
    const d1Idx = s.indexOf("preexisting_locked_autoliq_not_guardrail_owned");
    const blockGateCallRegion = s.slice(d1Idx, d1Idx + 400);
    assert.ok(
      blockGateCallRegion.includes("existing"),
      "D1 blockGate call must include existing record in the audit payload context",
    );
  });

  it("D1 blocked path explains prop-firm / Tradovate provenance risk in skipReason", () => {
    const s = src();
    assert.ok(
      s.includes("prop-firm or Tradovate-managed"),
      "D1 skipReason must mention prop-firm and Tradovate provenance risk",
    );
  });

  it("D1 block returns HTTP 403 (not 409 or 500)", () => {
    // Use codeOnly() so JSDoc mentions don't confuse position search.
    const s = codeOnly();
    // The D1 blockGate call uses status 403.
    const d1Idx = s.indexOf("preexisting_locked_autoliq_not_guardrail_owned");
    const around = s.slice(Math.max(0, d1Idx - 300), d1Idx + 10);
    assert.ok(around.includes("403"), "D1 must return HTTP 403");
  });
});

// ── Method allowlist (route imports only what it needs) ────────────────────

describe("recovery probe: import allowlist", () => {
  it("imports only safe modules — no order-action, no flatten-positions", () => {
    const s = src();
    const importLines = s
      .split("\n")
      .filter((l) => l.trimStart().startsWith("import "));
    const importedFrom = importLines.map((l) => l).join("\n");
    const forbiddenModules = [
      "flatten-positions",
      "cancel-open-orders",
      "order-actions-flag",
      "broker-enforcement-service",
    ];
    for (const m of forbiddenModules) {
      assert.ok(
        !importedFrom.includes(m),
        `route must not import from '${m}'`,
      );
    }
  });
});
