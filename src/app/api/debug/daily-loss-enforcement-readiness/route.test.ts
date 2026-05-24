/**
 * Source-scan tests for GET /api/debug/daily-loss-enforcement-readiness.
 *
 * Verifies the safety contract without running the route:
 *   - Session auth + x-cron-secret gates
 *   - User-scoped account lookup (userId filter)
 *   - Read-only Prisma queries only
 *   - No TradovateClient import, no broker calls, no env mutations
 *   - No secret values returned
 *   - All gate check arrays present (ruleSaveGates, listenerGates)
 *   - D1 assessment in ownershipAndRecovery
 *   - activationVerdict with phase + goNoGo + blockers
 *   - existingAutoLiq extracted from preview audit rows (DB-only)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTE = resolve(import.meta.dirname, "./route.ts");

function src(): string {
  return readFileSync(ROUTE, "utf8");
}

function codeOnly(): string {
  let s = src();
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  s = s.replace(/(^|[^:])\/\/.*$/gm, "$1");
  return s;
}

// ── Auth gates ───────────────────────────────────────────────────────────────

describe("daily-loss-enforcement-readiness: auth gates", () => {
  it("requires authenticated session (401)", () => {
    const s = src();
    assert.ok(s.includes("getCurrentUser"), "must call getCurrentUser");
    assert.ok(s.includes('"unauthorized"'));
    assert.ok(s.includes("401"));
  });

  it("requires x-cron-secret header matching CRON_SECRET (403)", () => {
    const s = src();
    assert.ok(s.includes("x-cron-secret"), "must check x-cron-secret header");
    assert.ok(s.includes("CRON_SECRET"), "must reference CRON_SECRET env var");
    assert.ok(s.includes('"forbidden"'));
    assert.ok(s.includes("403"));
  });

  it("requires accountId query param (400)", () => {
    const s = src();
    assert.ok(s.includes("accountId"), "must require accountId param");
    assert.ok(s.includes("400"));
  });

  it("does not assign to process.env.CRON_SECRET", () => {
    const s = src();
    assert.ok(!/process\.env\.CRON_SECRET\s*=/.test(s), "must not assign to CRON_SECRET");
  });
});

// ── User scope ───────────────────────────────────────────────────────────────

describe("daily-loss-enforcement-readiness: user scope", () => {
  it("filters account lookup by userId from current session", () => {
    const s = codeOnly();
    assert.ok(
      s.includes("userId: currentUser.id"),
      "account lookup must be scoped to currentUser.id",
    );
  });

  it("returns 404 when account not found for user", () => {
    const s = src();
    assert.ok(s.includes('"account not found for this user"'));
    assert.ok(s.includes("404"));
  });
});

// ── Read-only contract ───────────────────────────────────────────────────────

describe("daily-loss-enforcement-readiness: read-only contract", () => {
  it("does not call any Prisma write methods", () => {
    const s = codeOnly();
    assert.ok(!s.includes("prisma.brokerRiskSettingsSyncAudit.create"), "no create");
    assert.ok(!s.includes("prisma.brokerRiskSettingsSyncAudit.update"), "no update");
    assert.ok(!s.includes("prisma.brokerRiskSettingsSyncAudit.delete"), "no delete");
    assert.ok(!s.includes("prisma.connectedAccount.update"), "no account update");
    assert.ok(!s.includes("prisma.connectedAccount.create"), "no account create");
    assert.ok(!s.includes(".upsert("), "no upsert");
    assert.ok(!s.includes(".deleteMany("), "no deleteMany");
    assert.ok(!s.includes(".updateMany("), "no updateMany");
  });

  it("does not import TradovateClient", () => {
    const s = codeOnly();
    assert.ok(!s.includes("TradovateClient"), "must not import TradovateClient");
    assert.ok(!s.includes("tradovate-client\""), "must not import tradovate-client module");
  });

  it("does not call any broker API methods", () => {
    const s = codeOnly();
    assert.ok(!s.includes("readDailyLossAutoLiqRecord"), "no broker read");
    assert.ok(!s.includes("applyDailyLossRecoveryUpdate"), "no broker write");
    assert.ok(!s.includes("applyDailyLossLock"), "no lock call");
    assert.ok(!s.includes("initialize("), "no client initialize");
    assert.ok(!s.includes("fetchToken"), "no token fetch");
  });

  it("does not import or call enforcement write methods", () => {
    const s = codeOnly();
    assert.ok(!s.includes("applyBrokerDayLockout"), "no enforcement");
    assert.ok(!s.includes("triggerEnforcement"), "no enforcement");
    assert.ok(!s.includes("writeBrokerRiskSettingsSyncAudit"), "no audit write");
  });

  it("does not import cancel, flatten, or order action methods", () => {
    const s = codeOnly();
    assert.ok(!s.includes("cancelOrder"), "no cancel order");
    assert.ok(!s.includes("liquidatePosition"), "no flatten");
    assert.ok(!s.includes("ENABLE_TRADOVATE_ORDER_ACTIONS"), "no order action flag");
  });
});

// ── No secrets returned ──────────────────────────────────────────────────────

describe("daily-loss-enforcement-readiness: no secrets in response", () => {
  it("does not select or return token fields", () => {
    const s = src();
    assert.ok(!s.includes("accessTokenEncrypted"), "no access token");
    assert.ok(!s.includes("refreshTokenEncrypted"), "no refresh token");
    assert.ok(!s.includes("accessToken"), "no plain access token");
  });

  it("does not echo CRON_SECRET value in response", () => {
    const s = codeOnly();
    assert.ok(
      !/NextResponse\.json\([^)]*CRON_SECRET/.test(s),
      "must not include CRON_SECRET in response",
    );
  });

  it("does not select brokerUserId or other sensitive broker fields", () => {
    const s = src();
    assert.ok(!s.includes("brokerUserId"), "no brokerUserId");
  });

  it("does not return raw allowlist contents", () => {
    const s = codeOnly();
    assert.ok(s.includes("allowlistSize"), "must return allowlistSize (count, not contents)");
    assert.ok(!s.includes("allowlistIds:"), "must not return raw allowlist ids array");
  });
});

// ── No env mutations ─────────────────────────────────────────────────────────

describe("daily-loss-enforcement-readiness: no env mutations", () => {
  it("does not assign to any process.env variable", () => {
    const s = codeOnly();
    assert.ok(!/process\.env\.[A-Z_]+ *=(?!=)/.test(s), "must not assign to process.env");
  });
});

// ── Gate arrays ──────────────────────────────────────────────────────────────

describe("daily-loss-enforcement-readiness: gate arrays", () => {
  it("returns ruleSaveGates array with per-gate objects", () => {
    const s = src();
    assert.ok(s.includes("ruleSaveGates"), "must return ruleSaveGates");
    assert.ok(s.includes("GateCheck"), "must define GateCheck type");
  });

  it("returns listenerGates array with per-gate objects", () => {
    const s = src();
    assert.ok(s.includes("listenerGates"), "must return listenerGates");
  });

  it("rule-save gates include broker_enforcement_enabled gate", () => {
    const s = src();
    assert.ok(
      s.includes('"broker_enforcement_enabled"'),
      "must include broker_enforcement_enabled gate",
    );
  });

  it("rule-save gates include env_demo gate", () => {
    const s = src();
    assert.ok(s.includes('"env_demo"'), "must include env_demo gate");
  });

  it("rule-save gates include allowlisted gate", () => {
    const s = src();
    assert.ok(s.includes('"allowlisted"'), "must include allowlisted gate");
  });

  it("rule-save gates include consent_valid gate", () => {
    const s = src();
    assert.ok(s.includes('"consent_valid"'), "must include consent_valid gate");
  });

  it("rule-save gates include valid_external_account_id gate", () => {
    const s = src();
    assert.ok(
      s.includes('"valid_external_account_id"'),
      "must include valid_external_account_id gate",
    );
  });

  it("rule-save gates include max_daily_loss_positive gate", () => {
    const s = src();
    assert.ok(
      s.includes('"max_daily_loss_positive"'),
      "must include max_daily_loss_positive gate",
    );
  });

  it("listener gates include listener_not_live gate", () => {
    const s = src();
    assert.ok(s.includes('"listener_not_live"'), "must include listener_not_live gate");
  });

  it("listener gates include rule_eligible gate", () => {
    const s = src();
    assert.ok(s.includes('"rule_eligible"'), "must include rule_eligible gate");
  });

  it("listener gates include active_internal_lock gate", () => {
    const s = src();
    assert.ok(
      s.includes('"active_internal_lock"'),
      "must include active_internal_lock gate",
    );
  });

  it("listener gates include no_duplicate_intervention gate", () => {
    const s = src();
    assert.ok(
      s.includes('"no_duplicate_intervention"'),
      "must include no_duplicate_intervention gate",
    );
  });

  it("gate objects have gate, pass, reason fields", () => {
    const s = src();
    assert.ok(s.includes("pass:"), "gates must have pass field");
    assert.ok(s.includes("reason:"), "gates must have reason field");
  });
});

// ── Env posture section ──────────────────────────────────────────────────────

describe("daily-loss-enforcement-readiness: env posture", () => {
  it("returns envPosture section with key flags", () => {
    const s = src();
    assert.ok(s.includes("envPosture"), "must return envPosture section");
    assert.ok(s.includes("brokerEnforcementEnabled"), "must include brokerEnforcementEnabled");
    assert.ok(s.includes("enforcementDryRun"), "must include enforcementDryRun");
    assert.ok(s.includes("listenerLiveEnabled"), "must include listenerLiveEnabled");
    assert.ok(s.includes("accountAllowlisted"), "must include accountAllowlisted");
    assert.ok(s.includes("guardrailInternalLockEnabled"), "must include guardrailInternalLockEnabled");
  });

  it("reads BROKER_ENFORCEMENT_ENABLED env var", () => {
    const s = src();
    assert.ok(
      s.includes("BROKER_ENFORCEMENT_ENABLED"),
      "must read BROKER_ENFORCEMENT_ENABLED",
    );
  });

  it("reads ENFORCEMENT_DRY_RUN env var", () => {
    const s = src();
    assert.ok(s.includes("ENFORCEMENT_DRY_RUN"), "must read ENFORCEMENT_DRY_RUN");
  });

  it("reads TRADOVATE_LISTENER_ENABLE_LIVE env var", () => {
    const s = src();
    assert.ok(
      s.includes("TRADOVATE_LISTENER_ENABLE_LIVE"),
      "must read TRADOVATE_LISTENER_ENABLE_LIVE",
    );
  });

  it("reads BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST env var", () => {
    const s = src();
    assert.ok(
      s.includes("BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST"),
      "must read BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST",
    );
  });

  it("reads GUARDRAIL_INTERNAL_LOCK_ENABLED env var", () => {
    const s = src();
    assert.ok(
      s.includes("GUARDRAIL_INTERNAL_LOCK_ENABLED"),
      "must read GUARDRAIL_INTERNAL_LOCK_ENABLED",
    );
  });
});

// ── existingAutoLiq section ──────────────────────────────────────────────────

describe("daily-loss-enforcement-readiness: existingAutoLiq", () => {
  it("returns existingAutoLiq section", () => {
    const s = src();
    assert.ok(s.includes("existingAutoLiq"), "must return existingAutoLiq section");
  });

  it("extracts existing from payloadPreviewJson of latest preview audit", () => {
    const s = src();
    assert.ok(s.includes("payloadPreviewJson"), "must read payloadPreviewJson");
    assert.ok(s.includes("daily_loss_recovery_probe"), "must filter by ruleType");
    assert.ok(
      s.includes('outcome: "preview"'),
      "must filter preview audit rows",
    );
  });

  it("returns fromLatestPreviewAudit flag", () => {
    const s = src();
    assert.ok(s.includes("fromLatestPreviewAudit"), "must return fromLatestPreviewAudit");
  });

  it("returns changesLocked field", () => {
    const s = src();
    assert.ok(s.includes("changesLocked"), "must return changesLocked");
  });

  it("returns dailyLossAutoLiq field", () => {
    const s = src();
    assert.ok(s.includes("dailyLossAutoLiq"), "must return dailyLossAutoLiq");
  });

  it("notes that this is a DB-only snapshot, not a live read", () => {
    const s = src();
    assert.ok(
      s.includes("DB-only") || s.includes("not a live"),
      "must note DB-only provenance",
    );
  });
});

// ── Ownership and D1 section ─────────────────────────────────────────────────

describe("daily-loss-enforcement-readiness: ownershipAndRecovery", () => {
  it("returns ownershipAndRecovery section", () => {
    const s = src();
    assert.ok(s.includes("ownershipAndRecovery"), "must return ownershipAndRecovery section");
  });

  it("returns hasGuardrailOwnedWrite flag", () => {
    const s = src();
    assert.ok(s.includes("hasGuardrailOwnedWrite"), "must return hasGuardrailOwnedWrite");
  });

  it("returns d1Blocked flag", () => {
    const s = src();
    assert.ok(s.includes("d1Blocked"), "must return d1Blocked");
  });

  it("D1 check uses changesLocked=true AND no prior brokerResponseJson", () => {
    const s = src();
    assert.ok(s.includes("changesLocked === true"), "must check changesLocked === true");
    assert.ok(
      s.includes("brokerResponseJson != null"),
      "must check brokerResponseJson != null for ownership",
    );
  });

  it("queries prior success write rows for ownership evidence", () => {
    const s = src();
    assert.ok(s.includes('outcome: "success"'), "must query outcome=success rows");
    assert.ok(
      s.includes('"daily_loss_limit"') && s.includes('"daily_loss_recovery_probe"'),
      "must include both rule types in ownership query",
    );
  });

  it("returns priorWriteCount", () => {
    const s = src();
    assert.ok(s.includes("priorWriteCount"), "must return priorWriteCount");
  });

  it("returns auditSummary using groupBy", () => {
    const s = src();
    assert.ok(s.includes("auditSummary"), "must return auditSummary");
    assert.ok(s.includes("groupBy"), "must use groupBy for audit summary");
  });
});

// ── Activation verdict section ───────────────────────────────────────────────

describe("daily-loss-enforcement-readiness: activationVerdict", () => {
  it("returns activationVerdict section", () => {
    const s = src();
    assert.ok(s.includes("activationVerdict"), "must return activationVerdict");
  });

  it("returns phase field with four possible values", () => {
    const s = src();
    assert.ok(s.includes('"not_ready"'), "must include not_ready phase");
    assert.ok(
      s.includes('"blocked_existing_locked_autoliq"'),
      "must include blocked_existing_locked_autoliq phase",
    );
    assert.ok(
      s.includes('"ready_for_preview_only"'),
      "must include ready_for_preview_only phase",
    );
    assert.ok(
      s.includes('"ready_for_demo_activation"'),
      "must include ready_for_demo_activation phase",
    );
  });

  it("returns goNoGo field with GO or NO_GO", () => {
    const s = src();
    assert.ok(s.includes('"GO"'), "must include GO verdict");
    assert.ok(s.includes('"NO_GO"'), "must include NO_GO verdict");
  });

  it("returns blockers array", () => {
    const s = src();
    assert.ok(s.includes("blockers"), "must return blockers array");
  });

  it("blocked_existing_locked_autoliq includes D1 in blockers", () => {
    const s = src();
    assert.ok(
      s.includes('"preexisting_locked_autoliq_not_guardrail_owned"'),
      "D1 verdict must include preexisting_locked_autoliq_not_guardrail_owned in blockers",
    );
  });

  it("ready_for_demo_activation verdict has empty blockers and GO", () => {
    const s = src();
    assert.ok(
      s.includes("blockers = []") || s.includes("blockers: []"),
      "ready_for_demo_activation must set empty blockers",
    );
  });

  it("fundamental failures produce not_ready phase before D1 check", () => {
    const s = codeOnly();
    const notReadyIdx = s.indexOf('"not_ready"');
    const d1BlockedIdx = s.indexOf('"blocked_existing_locked_autoliq"');
    assert.ok(notReadyIdx > -1, "not_ready phase must exist");
    assert.ok(d1BlockedIdx > -1, "blocked_existing_locked_autoliq must exist");
    assert.ok(notReadyIdx < d1BlockedIdx, "not_ready must be evaluated before D1 phase");
  });

  it("D1 blocked phase is evaluated before env blockers phase", () => {
    const s = codeOnly();
    const d1Idx = s.indexOf('"blocked_existing_locked_autoliq"');
    const readyPreviewIdx = s.indexOf('"ready_for_preview_only"');
    assert.ok(d1Idx > -1, "blocked_existing_locked_autoliq must exist");
    assert.ok(readyPreviewIdx > -1, "ready_for_preview_only must exist");
    assert.ok(d1Idx < readyPreviewIdx, "D1 must be evaluated before ready_for_preview_only");
  });
});

// ── Response shape ───────────────────────────────────────────────────────────

describe("daily-loss-enforcement-readiness: response shape", () => {
  it("returns ok: true", () => {
    const s = src();
    assert.ok(s.includes("ok: true"), "must return ok: true");
  });

  it("includes a read-only note", () => {
    const s = src();
    assert.ok(
      s.includes("Read-only") || s.includes("read-only"),
      "must include read-only note",
    );
  });

  it("returns account section with key fields", () => {
    const s = src();
    assert.ok(s.includes("id: account.id"), "must return account.id");
    assert.ok(s.includes("externalAccountId"), "must return externalAccountId");
    assert.ok(s.includes("platform"), "must return platform");
    assert.ok(s.includes("permissionLevel"), "must return permissionLevel");
    assert.ok(s.includes("connectionStatus"), "must return connectionStatus");
    assert.ok(s.includes("validMasterId"), "must return validMasterId");
  });

  it("returns currentRules section with consent fields", () => {
    const s = src();
    assert.ok(s.includes("currentRules"), "must return currentRules");
    assert.ok(s.includes("maxDailyLoss"), "must return maxDailyLoss");
    assert.ok(s.includes("consentValid"), "must return consentValid");
    assert.ok(s.includes("expectedConsentVersion"), "must return expectedConsentVersion");
    assert.ok(s.includes("guardianEnabled"), "must return guardianEnabled");
  });

  it("uses AUTOMATED_ACTIONS_CONSENT_VERSION constant", () => {
    const s = src();
    assert.ok(
      s.includes("AUTOMATED_ACTIONS_CONSENT_VERSION"),
      "must use AUTOMATED_ACTIONS_CONSENT_VERSION constant",
    );
  });

  it("uses parseTradovateMasterId for masterid validation", () => {
    const s = src();
    assert.ok(
      s.includes("parseTradovateMasterId"),
      "must use parseTradovateMasterId",
    );
  });

  it("uses hasValidConsent from automated-actions-consent", () => {
    const s = src();
    assert.ok(s.includes("hasValidConsent"), "must use hasValidConsent");
  });

  it("uses resolveConsentForAccount for consent resolution", () => {
    const s = src();
    assert.ok(
      s.includes("resolveConsentForAccount"),
      "must use resolveConsentForAccount",
    );
  });

  it("uses parseBrokerEnforcementAllowlist for allowlist parsing", () => {
    const s = src();
    assert.ok(
      s.includes("parseBrokerEnforcementAllowlist"),
      "must use parseBrokerEnforcementAllowlist",
    );
  });
});
