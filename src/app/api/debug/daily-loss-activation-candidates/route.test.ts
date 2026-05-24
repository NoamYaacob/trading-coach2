/**
 * Source-scan tests for GET /api/debug/daily-loss-activation-candidates.
 *
 * Verifies the safety contract and readiness verdict logic without running the route:
 *   - Session auth + x-cron-secret gates
 *   - User-scoped account lookup (userId filter)
 *   - Read-only Prisma queries only
 *   - No TradovateClient import, no broker calls, no env mutations
 *   - No secret values returned (no raw allowlist, no tokens)
 *   - All 12 phase values present
 *   - Per-scenario verdict logic for each blocking condition
 *   - D1 check position (after connection/permission, before preview_required)
 *   - Summary fields: totalAccounts, demoTradovateAccounts, candidates,
 *     previewRequired, blocked, recommendedNextAccountId, globalNextSafeAction
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

describe("daily-loss-activation-candidates: auth gates", () => {
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

  it("does not assign to process.env.CRON_SECRET", () => {
    const s = src();
    assert.ok(!/process\.env\.CRON_SECRET\s*=/.test(s), "must not assign to CRON_SECRET");
  });
});

// ── User scope ───────────────────────────────────────────────────────────────

describe("daily-loss-activation-candidates: user scope", () => {
  it("filters account lookup by userId from current session", () => {
    const s = codeOnly();
    assert.ok(
      s.includes("userId: currentUser.id"),
      "account lookup must be scoped to currentUser.id",
    );
  });

  it("fetches guardianProfile scoped to current user", () => {
    const s = codeOnly();
    assert.ok(
      s.includes("where: { userId: currentUser.id }"),
      "guardianProfile lookup must be scoped to currentUser.id",
    );
  });

  it("fetches only audit rows for accounts belonging to current user", () => {
    const s = src();
    assert.ok(
      s.includes("accountId: { in: accountIds }"),
      "audit query must be scoped to user-owned accountIds",
    );
  });
});

// ── Read-only contract ───────────────────────────────────────────────────────

describe("daily-loss-activation-candidates: read-only contract", () => {
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

  it("does not import enforcement write methods", () => {
    const s = codeOnly();
    assert.ok(!s.includes("applyBrokerDayLockout"), "no enforcement write");
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

describe("daily-loss-activation-candidates: no secrets in response", () => {
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
    assert.ok(!s.includes("allowlistIds:"), "must not return raw allowlist ids");
  });

  it("returns allowlisted boolean per account, not the list", () => {
    const s = src();
    assert.ok(
      s.includes("allowlisted:") || s.includes("allowlisted,"),
      "must return per-account allowlisted flag",
    );
    assert.ok(
      s.includes("allowlistIds.includes(account.id)"),
      "must derive allowlisted from allowlist check",
    );
  });
});

// ── No env mutations ─────────────────────────────────────────────────────────

describe("daily-loss-activation-candidates: no env mutations", () => {
  it("does not assign to any process.env variable", () => {
    const s = codeOnly();
    assert.ok(!/process\.env\.[A-Z_]+ *=(?!=)/.test(s), "must not assign to process.env");
  });
});

// ── Phase coverage ───────────────────────────────────────────────────────────

describe("daily-loss-activation-candidates: phase values", () => {
  it("includes candidate_for_demo_activation phase", () => {
    const s = src();
    assert.ok(s.includes('"candidate_for_demo_activation"'));
  });

  it("includes preview_required phase", () => {
    const s = src();
    assert.ok(s.includes('"preview_required"'));
  });

  it("includes blocked_existing_locked_autoliq phase", () => {
    const s = src();
    assert.ok(s.includes('"blocked_existing_locked_autoliq"'));
  });

  it("includes blocked_not_demo phase", () => {
    const s = src();
    assert.ok(s.includes('"blocked_not_demo"'));
  });

  it("includes blocked_connection_not_live phase", () => {
    const s = src();
    assert.ok(s.includes('"blocked_connection_not_live"'));
  });

  it("includes blocked_not_full_access phase", () => {
    const s = src();
    assert.ok(s.includes('"blocked_not_full_access"'));
  });

  it("includes blocked_invalid_external_account_id phase", () => {
    const s = src();
    assert.ok(s.includes('"blocked_invalid_external_account_id"'));
  });

  it("includes blocked_no_daily_loss_rule phase", () => {
    const s = src();
    assert.ok(s.includes('"blocked_no_daily_loss_rule"'));
  });

  it("includes blocked_guardian_inactive phase", () => {
    const s = src();
    assert.ok(s.includes('"blocked_guardian_inactive"'));
  });

  it("includes blocked_missing_consent phase", () => {
    const s = src();
    assert.ok(s.includes('"blocked_missing_consent"'));
  });
});

// ── Scenario: DEMO7433035-like (locked unowned AutoLiq) ──────────────────────

describe("daily-loss-activation-candidates: blocked_existing_locked_autoliq scenario", () => {
  it("changesLocked=true + no Guardrail ownership → blocked_existing_locked_autoliq", () => {
    const s = src();
    assert.ok(
      s.includes("existingChangesLocked === true") || s.includes("changesLocked === true"),
      "must check existingChangesLocked/changesLocked === true",
    );
    assert.ok(
      s.includes("!params.hasGuardrailOwnedWrite"),
      "must check !params.hasGuardrailOwnedWrite",
    );
    assert.ok(
      s.includes('"preexisting_locked_autoliq_not_guardrail_owned"'),
      "must include D1 blocker string",
    );
  });

  it("D1 verdict tells operator not to run apply=true", () => {
    const s = src();
    assert.ok(
      s.includes("Do not run apply=true") || s.includes("do not run apply=true"),
      "D1 nextSafeAction must warn against apply=true",
    );
  });

  it("queries prior success write rows per account for ownership evidence", () => {
    const s = src();
    assert.ok(s.includes('outcome: "success"'), "must query outcome=success rows");
    assert.ok(
      s.includes('"daily_loss_limit"') && s.includes('"daily_loss_recovery_probe"'),
      "must include both rule types in ownership query",
    );
  });

  it("ownership section returns hasGuardrailOwnedWrite and hasAnyBrokerWrite", () => {
    const s = src();
    assert.ok(s.includes("hasGuardrailOwnedWrite"), "must return hasGuardrailOwnedWrite");
    assert.ok(s.includes("hasAnyBrokerWrite"), "must return hasAnyBrokerWrite");
  });
});

// ── Scenario: no preview → preview_required ──────────────────────────────────

describe("daily-loss-activation-candidates: preview_required scenario", () => {
  it("no preview audit row → preview_required", () => {
    const s = src();
    assert.ok(
      s.includes("previewExists: previewRow != null") ||
        s.includes("previewExists: previewRow !== null"),
      "must derive previewExists from previewRow",
    );
    assert.ok(
      s.includes('outcome: "preview"') && s.includes('"daily_loss_recovery_probe"'),
      "must query preview rows",
    );
  });

  it("reports existingAutoLiqStatus=unknown_preview_required when no preview exists", () => {
    const s = src();
    assert.ok(
      s.includes('"unknown_preview_required"'),
      "must return unknown_preview_required existingAutoLiqStatus",
    );
  });

  it("preview_required nextSafeAction points to read_only probe", () => {
    const s = src();
    assert.ok(
      s.includes("read_only"),
      "preview_required action must mention read_only probe mode",
    );
  });
});

// ── Scenario: clean candidate ─────────────────────────────────────────────────

describe("daily-loss-activation-candidates: candidate_for_demo_activation scenario", () => {
  it("all gates pass + preview exists + changesLocked=false → candidate", () => {
    const s = src();
    assert.ok(s.includes('"candidate"'), "must include candidate status");
    assert.ok(s.includes('"candidate_for_demo_activation"'), "must include candidate phase");
  });

  it("candidate nextSafeAction mentions allowlist and BROKER_ENFORCEMENT_ENABLED", () => {
    const s = src();
    assert.ok(
      s.includes("BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST"),
      "candidate action must mention allowlist",
    );
    assert.ok(
      s.includes("BROKER_ENFORCEMENT_ENABLED"),
      "candidate action must mention BROKER_ENFORCEMENT_ENABLED",
    );
  });
});

// ── Scenario: live account blocked ───────────────────────────────────────────

describe("daily-loss-activation-candidates: blocked_not_demo scenario", () => {
  it("env=live account → blocked_not_demo", () => {
    const s = src();
    assert.ok(
      s.includes('params.env !== "demo"'),
      "must check env is not demo",
    );
    assert.ok(s.includes('"blocked_not_demo"'), "must include blocked_not_demo phase");
  });

  it("platform not tradovate → blocked_not_demo", () => {
    const s = src();
    assert.ok(
      s.includes('params.platform !== "tradovate"'),
      "must check platform is tradovate",
    );
  });
});

// ── Scenario: expired/not_connected ──────────────────────────────────────────

describe("daily-loss-activation-candidates: blocked_connection_not_live scenario", () => {
  it("expired/not_connected status → blocked_connection_not_live", () => {
    const s = src();
    assert.ok(
      s.includes("NON_LIVE_CONNECTION_STATUSES"),
      "must use NON_LIVE_CONNECTION_STATUSES set",
    );
    assert.ok(
      s.includes('"expired"') && s.includes('"not_connected"'),
      "NON_LIVE set must include expired and not_connected",
    );
  });
});

// ── Scenario: no full_access ──────────────────────────────────────────────────

describe("daily-loss-activation-candidates: blocked_not_full_access scenario", () => {
  it("permissionLevel !== full_access → blocked_not_full_access", () => {
    const s = src();
    assert.ok(
      s.includes('params.permissionLevel !== "full_access"'),
      "must check permissionLevel is full_access",
    );
    assert.ok(s.includes('"blocked_not_full_access"'), "must include blocked_not_full_access phase");
  });
});

// ── Scenario: invalid externalAccountId ──────────────────────────────────────

describe("daily-loss-activation-candidates: blocked_invalid_external_account_id scenario", () => {
  it("invalid externalAccountId → blocked_invalid_external_account_id", () => {
    const s = src();
    assert.ok(
      s.includes("parseTradovateMasterId"),
      "must use parseTradovateMasterId for masterid validation",
    );
    assert.ok(
      s.includes('"blocked_invalid_external_account_id"'),
      "must include blocked_invalid_external_account_id phase",
    );
  });
});

// ── Scenario: missing consent ────────────────────────────────────────────────

describe("daily-loss-activation-candidates: blocked_missing_consent scenario", () => {
  it("missing or stale consent → blocked_missing_consent", () => {
    const s = src();
    assert.ok(s.includes("hasValidConsent"), "must use hasValidConsent");
    assert.ok(s.includes("resolveConsentForAccount"), "must use resolveConsentForAccount");
    assert.ok(
      s.includes("AUTOMATED_ACTIONS_CONSENT_VERSION"),
      "must reference AUTOMATED_ACTIONS_CONSENT_VERSION",
    );
    assert.ok(s.includes('"blocked_missing_consent"'), "must include blocked_missing_consent phase");
  });
});

// ── Scenario: guardian inactive ──────────────────────────────────────────────

describe("daily-loss-activation-candidates: blocked_guardian_inactive scenario", () => {
  it("guardianEnabled=false → blocked_guardian_inactive", () => {
    const s = src();
    assert.ok(s.includes("!params.guardianEnabled"), "must check !params.guardianEnabled");
    assert.ok(
      s.includes('"blocked_guardian_inactive"'),
      "must include blocked_guardian_inactive phase",
    );
  });
});

// ── Scenario: missing/zero maxDailyLoss ──────────────────────────────────────

describe("daily-loss-activation-candidates: blocked_no_daily_loss_rule scenario", () => {
  it("maxDailyLoss null or ≤ 0 → blocked_no_daily_loss_rule", () => {
    const s = src();
    assert.ok(
      s.includes("params.maxDailyLoss == null || params.maxDailyLoss <= 0"),
      "must check maxDailyLoss null or ≤ 0",
    );
    assert.ok(
      s.includes('"blocked_no_daily_loss_rule"'),
      "must include blocked_no_daily_loss_rule phase",
    );
  });
});

// ── Verdict ordering ─────────────────────────────────────────────────────────

describe("daily-loss-activation-candidates: verdict ordering", () => {
  it("blocked_not_demo is evaluated before blocked_connection_not_live", () => {
    const s = codeOnly();
    const notDemoIdx = s.indexOf('"blocked_not_demo"');
    const connIdx = s.indexOf('"blocked_connection_not_live"');
    assert.ok(notDemoIdx > -1, "blocked_not_demo must exist");
    assert.ok(connIdx > -1, "blocked_connection_not_live must exist");
    assert.ok(notDemoIdx < connIdx, "blocked_not_demo must appear before blocked_connection_not_live");
  });

  it("blocked_connection_not_live is evaluated before blocked_not_full_access", () => {
    const s = codeOnly();
    const connIdx = s.indexOf('"blocked_connection_not_live"');
    const permIdx = s.indexOf('"blocked_not_full_access"');
    assert.ok(connIdx < permIdx, "connection check must appear before permission check");
  });

  it("D1 check (blocked_existing_locked_autoliq) is evaluated after permission checks", () => {
    const s = codeOnly();
    // Use phase: "..." patterns which only appear in return statements, not type unions
    const permIdx = s.indexOf('phase: "blocked_not_full_access"');
    const d1Idx = s.indexOf('phase: "blocked_existing_locked_autoliq"');
    assert.ok(permIdx > -1, "blocked_not_full_access return must exist");
    assert.ok(d1Idx > -1, "blocked_existing_locked_autoliq return must exist");
    assert.ok(permIdx < d1Idx, "permission check must appear before D1 check");
  });

  it("D1 check is evaluated before preview_required", () => {
    const s = codeOnly();
    // Use phase: "..." patterns which only appear in return statements, not type unions
    const d1Idx = s.indexOf('phase: "blocked_existing_locked_autoliq"');
    const previewIdx = s.indexOf('phase: "preview_required"');
    assert.ok(d1Idx > -1, "blocked_existing_locked_autoliq return must exist");
    assert.ok(previewIdx > -1, "preview_required return must exist");
    assert.ok(d1Idx < previewIdx, "D1 must be evaluated before preview_required");
  });

  it("preview_required is evaluated before candidate_for_demo_activation", () => {
    const s = codeOnly();
    const previewIdx = s.indexOf('"preview_required"');
    const candidateIdx = s.indexOf('"candidate_for_demo_activation"');
    assert.ok(previewIdx < candidateIdx, "preview_required must appear before candidate");
  });
});

// ── Summary section ──────────────────────────────────────────────────────────

describe("daily-loss-activation-candidates: summary", () => {
  it("returns summary section with all required fields", () => {
    const s = src();
    assert.ok(s.includes("totalAccounts:"), "must return totalAccounts");
    assert.ok(s.includes("demoTradovateAccounts:"), "must return demoTradovateAccounts");
    assert.ok(s.includes("candidates:"), "must return candidates count");
    assert.ok(s.includes("previewRequired:"), "must return previewRequired count");
    assert.ok(s.includes("blocked:"), "must return blocked count");
    assert.ok(s.includes("recommendedNextAccountId"), "must return recommendedNextAccountId");
    assert.ok(s.includes("globalNextSafeAction"), "must return globalNextSafeAction");
  });

  it("recommendedNextAccountId is set to first candidate id or null", () => {
    const s = src();
    assert.ok(
      s.includes("candidates.length > 0 ? candidates[0].id : null"),
      "recommendedNextAccountId must be first candidate or null",
    );
  });

  it("demoTradovateAccounts filters on platform=tradovate and env=demo", () => {
    const s = src();
    assert.ok(
      s.includes('r.platform === "tradovate"') && s.includes('r.env === "demo"'),
      "must filter demo tradovate accounts",
    );
  });
});

// ── Response shape ───────────────────────────────────────────────────────────

describe("daily-loss-activation-candidates: response shape", () => {
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

  it("per-account result includes latestAutoLiqPreview with existingAutoLiqStatus", () => {
    const s = src();
    assert.ok(s.includes("latestAutoLiqPreview"), "must return latestAutoLiqPreview");
    assert.ok(s.includes("existingAutoLiqStatus"), "must return existingAutoLiqStatus");
    assert.ok(s.includes('"known"'), "must include known status");
    assert.ok(s.includes('"no_existing_autoliq"'), "must include no_existing_autoliq status");
  });

  it("per-account result includes ownership section", () => {
    const s = src();
    assert.ok(s.includes("ownership:"), "must return ownership section");
    assert.ok(s.includes("latestRecoveryPreview"), "must return latestRecoveryPreview in ownership");
  });

  it("per-account result includes readiness section with status, phase, blockers, nextSafeAction", () => {
    const s = src();
    assert.ok(s.includes("readiness,"), "must include readiness in result");
    assert.ok(s.includes("status:"), "readiness must have status");
    assert.ok(s.includes("phase:"), "readiness must have phase");
    assert.ok(s.includes("blockers:"), "readiness must have blockers");
    assert.ok(s.includes("nextSafeAction:"), "readiness must have nextSafeAction");
  });

  it("uses bulk audit queries keyed by accountId for efficiency", () => {
    const s = src();
    assert.ok(
      s.includes("latestPreviewByAccount"),
      "must use per-account preview index",
    );
    assert.ok(
      s.includes("writesByAccount"),
      "must use per-account write index",
    );
  });

  it("skips audit rows with null accountId when building preview map", () => {
    const s = src();
    assert.ok(
      s.includes("if (row.accountId == null)"),
      "must null-guard accountId before using as Map key",
    );
  });

  it("skips audit rows with null accountId when building write map", () => {
    const s = codeOnly();
    // Both the preview loop and the write loop must have the null guard
    const firstNullGuard = s.indexOf("if (row.accountId == null)");
    const secondNullGuard = s.indexOf("if (row.accountId == null)", firstNullGuard + 1);
    assert.ok(firstNullGuard > -1, "first null guard must exist (preview loop)");
    assert.ok(secondNullGuard > -1, "second null guard must exist (write loop)");
  });
});
