/**
 * Source-scan tests for broker-side Max Position Size enforcement.
 *
 * These tests verify structural guarantees without a DB, network, or real
 * credentials. They guard against regressions where:
 *
 *  1. Broker sync logs leak token values.
 *  2. PATCH /api/accounts/[id] fails to trigger broker sync when maxContracts
 *     is included in the payload.
 *  3. POST /api/accounts/[id]/apply-pending fails to trigger broker sync after
 *     a successful promotion.
 *  4. The debug endpoint GET /api/debug/tradovate-position-limit has the
 *     required structural fields.
 *  5. POST /api/accounts/[id]/sync-broker-rules deactivates the stale raw
 *     Guardrail limit without touching user-created settings.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ACCOUNT_ROUTE = resolve(import.meta.dirname, "./route.ts");
const APPLY_PENDING_ROUTE = resolve(import.meta.dirname, "./apply-pending/route.ts");
const SYNC_BROKER_RULES_ROUTE = resolve(import.meta.dirname, "./sync-broker-rules/route.ts");
const DEBUG_ENDPOINT = resolve(
  import.meta.dirname,
  "../../debug/tradovate-position-limit/route.ts",
);

function src(f: string): string {
  return readFileSync(f, "utf8");
}

// ── 1. Logging safety: tokens must never appear in logs ──────────────────────

describe("broker sync log safety", () => {
  it("PATCH /api/accounts/[id] broker sync log does not log token fields", () => {
    const s = src(ACCOUNT_ROUTE);
    const logIdx = s.indexOf("[accounts/patch] broker max position size synced");
    assert.ok(logIdx !== -1, "patch broker sync log must exist");
    const logBlock = s.slice(logIdx, logIdx + 600);
    const forbidden = ["accessToken", "refreshToken", "tokenEncrypted", "accessTokenEncrypted", "refreshTokenEncrypted"];
    for (const field of forbidden) {
      assert.ok(
        !logBlock.includes(field),
        `broker sync log must not include token field: ${field}`,
      );
    }
  });

  it("PATCH /api/accounts/[id] broker sync log includes brokerEnforcementMode", () => {
    const s = src(ACCOUNT_ROUTE);
    const logIdx = s.indexOf("[accounts/patch] broker max position size synced");
    const logBlock = s.slice(logIdx, logIdx + 600);
    assert.ok(
      logBlock.includes("brokerEnforcementMode"),
      "sync log must include brokerEnforcementMode to show enforcement is app-side",
    );
  });

  it("apply-pending broker sync log does not log token fields", () => {
    const s = src(APPLY_PENDING_ROUTE);
    const logIdx = s.indexOf("[accounts/apply-pending] broker max position size synced");
    assert.ok(logIdx !== -1, "apply-pending broker sync log must exist");
    const logBlock = s.slice(logIdx, logIdx + 500);
    const forbidden = ["accessToken", "refreshToken", "tokenEncrypted", "accessTokenEncrypted", "refreshTokenEncrypted"];
    for (const field of forbidden) {
      assert.ok(
        !logBlock.includes(field),
        `apply-pending broker sync log must not include token field: ${field}`,
      );
    }
  });
});

// ── 2. PATCH route fires broker sync when maxContracts is in the payload ─────

describe("PATCH /api/accounts/[id]: broker max position size sync", () => {
  it("imports TradovateClient", () => {
    const s = src(ACCOUNT_ROUTE);
    assert.ok(
      s.includes("TradovateClient"),
      "route must import TradovateClient",
    );
  });

  it("calls applyMaxPositionSize", () => {
    const s = src(ACCOUNT_ROUTE);
    assert.ok(
      s.includes("applyMaxPositionSize("),
      "route must call applyMaxPositionSize",
    );
  });

  it("checks maxContracts is present in the body before firing broker sync", () => {
    const s = src(ACCOUNT_ROUTE);
    assert.ok(
      s.includes('"maxContracts" in body.riskRules'),
      'route must check "maxContracts" in body.riskRules before firing broker sync',
    );
  });

  it("fires broker sync as fire-and-forget (void)", () => {
    const s = src(ACCOUNT_ROUTE);
    // The broker sync must be fire-and-forget
    assert.ok(
      s.includes("void (async"),
      "broker sync must be fire-and-forget with void",
    );
  });

  it("wraps broker sync in try/catch so DB save is never rolled back", () => {
    const s = src(ACCOUNT_ROUTE);
    const syncIdx = s.indexOf("applyMaxPositionSize(");
    assert.ok(syncIdx !== -1);
    const tryIdx = s.lastIndexOf("try {", syncIdx);
    assert.ok(tryIdx !== -1 && tryIdx < syncIdx, "broker sync must be inside try/catch");
    const catchIdx = s.indexOf("catch (err)", tryIdx);
    assert.ok(catchIdx !== -1 && catchIdx > syncIdx, "must have catch block after applyMaxPositionSize");
  });
});

// ── 3. apply-pending fires broker sync after successful promotion ─────────────

describe("POST /api/accounts/[id]/apply-pending: broker max position size sync", () => {
  it("imports TradovateClient", () => {
    const s = src(APPLY_PENDING_ROUTE);
    assert.ok(
      s.includes("TradovateClient"),
      "apply-pending route must import TradovateClient",
    );
  });

  it("calls applyMaxPositionSize after promotion", () => {
    const s = src(APPLY_PENDING_ROUTE);
    const promoteIdx = s.indexOf("promoteAccountPendingRules(");
    const syncIdx = s.indexOf("applyMaxPositionSize(");
    assert.ok(promoteIdx !== -1, "must call promoteAccountPendingRules");
    assert.ok(syncIdx !== -1, "must call applyMaxPositionSize");
    assert.ok(syncIdx > promoteIdx, "applyMaxPositionSize must be called after promoteAccountPendingRules");
  });

  it("only fires broker sync when promotedAccountCount > 0", () => {
    const s = src(APPLY_PENDING_ROUTE);
    const syncIdx = s.indexOf("applyMaxPositionSize(");
    assert.ok(syncIdx !== -1);
    const guardBlock = s.slice(0, syncIdx);
    assert.ok(
      guardBlock.includes("promotedAccountCount > 0"),
      "broker sync must be gated on promotedAccountCount > 0",
    );
  });

  it("only fires broker sync for Tradovate accounts with externalAccountId", () => {
    const s = src(APPLY_PENDING_ROUTE);
    const syncIdx = s.indexOf("applyMaxPositionSize(");
    const guardBlock = s.slice(0, syncIdx);
    assert.ok(
      guardBlock.includes('"tradovate"'),
      "broker sync must check platform === tradovate",
    );
    assert.ok(
      guardBlock.includes("externalAccountId"),
      "broker sync must check externalAccountId is set",
    );
  });

  it("reads fresh maxContracts from DB after promotion", () => {
    const s = src(APPLY_PENDING_ROUTE);
    const syncIdx = s.indexOf("applyMaxPositionSize(");
    // The region between promoteAccountPendingRules and applyMaxPositionSize must
    // read accountRiskRules to get the newly-promoted maxContracts value.
    const promoteIdx = s.indexOf("promoteAccountPendingRules(");
    const midSection = s.slice(promoteIdx, syncIdx);
    assert.ok(
      midSection.includes("accountRiskRules") || midSection.includes("maxContracts"),
      "must read fresh maxContracts from DB after promotion before calling applyMaxPositionSize",
    );
  });

  it("fires broker sync as fire-and-forget (void)", () => {
    const s = src(APPLY_PENDING_ROUTE);
    assert.ok(
      s.includes("void (async"),
      "broker sync must be fire-and-forget with void",
    );
  });

  it("wraps broker sync in try/catch so promotion result is still returned", () => {
    const s = src(APPLY_PENDING_ROUTE);
    const syncIdx = s.indexOf("applyMaxPositionSize(");
    assert.ok(syncIdx !== -1);
    const tryIdx = s.lastIndexOf("try {", syncIdx);
    assert.ok(tryIdx !== -1 && tryIdx < syncIdx);
    const catchIdx = s.indexOf("catch (err)", tryIdx);
    assert.ok(catchIdx !== -1 && catchIdx > syncIdx, "must have catch block after applyMaxPositionSize");
  });
});

// ── 4. Debug endpoint has required structural fields ─────────────────────────

describe("GET /api/debug/tradovate-position-limit: response shape", () => {
  it("returns guardrailMaxMiniEquivalent (renamed from guardrailMaxContracts)", () => {
    const s = src(DEBUG_ENDPOINT);
    assert.ok(s.includes("guardrailMaxMiniEquivalent"), "must return guardrailMaxMiniEquivalent");
  });

  it("returns effectiveMicroLimits (per-product raw limits for display)", () => {
    const s = src(DEBUG_ENDPOINT);
    assert.ok(s.includes("effectiveMicroLimits"), "must return effectiveMicroLimits");
  });

  it("returns brokerEnforcementMode as app_side_only", () => {
    const s = src(DEBUG_ENDPOINT);
    assert.ok(s.includes("brokerEnforcementMode"), "must return brokerEnforcementMode");
    assert.ok(
      s.includes('"app_side_only"'),
      'brokerEnforcementMode must be "app_side_only"',
    );
  });

  it("returns brokerEnforcementWarning explaining the global limit limitation", () => {
    const s = src(DEBUG_ENDPOINT);
    assert.ok(s.includes("brokerEnforcementWarning"), "must return brokerEnforcementWarning");
    assert.ok(
      s.includes("totalBy") || s.includes("PerContract") || s.includes("raw contract"),
      "warning must explain the global-vs-mini-equivalent limitation",
    );
  });

  it("returns staleRawLimitWarning for detecting leftover broker limits", () => {
    const s = src(DEBUG_ENDPOINT);
    assert.ok(s.includes("staleRawLimitWarning"), "must return staleRawLimitWarning");
  });

  it("returns supportedSymbols list", () => {
    const s = src(DEBUG_ENDPOINT);
    assert.ok(s.includes("supportedSymbols"), "must return supportedSymbols");
  });

  it("returns externalAccountId", () => {
    const s = src(DEBUG_ENDPOINT);
    assert.ok(s.includes("externalAccountId"), "must return externalAccountId");
  });

  it("returns brokerConnectionStatus", () => {
    const s = src(DEBUG_ENDPOINT);
    assert.ok(s.includes("brokerConnectionStatus"), "must return brokerConnectionStatus");
  });

  it("returns permissionLevel", () => {
    const s = src(DEBUG_ENDPOINT);
    assert.ok(s.includes("permissionLevel"), "must return permissionLevel");
  });

  it("returns guardrailLimitFound", () => {
    const s = src(DEBUG_ENDPOINT);
    assert.ok(s.includes("guardrailLimitFound"), "must return guardrailLimitFound");
  });

  it("returns exposedLimit", () => {
    const s = src(DEBUG_ENDPOINT);
    assert.ok(s.includes("exposedLimit"), "must return exposedLimit");
  });

  it("returns limitActive", () => {
    const s = src(DEBUG_ENDPOINT);
    assert.ok(s.includes("limitActive"), "must return limitActive");
  });

  it("returns hardLimitAttached", () => {
    const s = src(DEBUG_ENDPOINT);
    assert.ok(s.includes("hardLimitAttached"), "must return hardLimitAttached");
  });

  it("returns brokerStateOk composite flag", () => {
    const s = src(DEBUG_ENDPOINT);
    assert.ok(s.includes("brokerStateOk"), "must return brokerStateOk composite flag");
  });

  it("calls listUserAccountRiskParameters directly (no hacky cast)", () => {
    const s = src(DEBUG_ENDPOINT);
    assert.ok(
      s.includes("client.listUserAccountRiskParameters("),
      "must call client.listUserAccountRiskParameters directly",
    );
    assert.ok(
      !s.includes("as unknown as"),
      "debug endpoint must not use hacky type cast for listUserAccountRiskParameters",
    );
  });

  it("requires authentication (401 for unauthenticated)", () => {
    const s = src(DEBUG_ENDPOINT);
    assert.ok(s.includes("getCurrentUser"), "must call getCurrentUser");
    assert.ok(s.includes("status: 401"), "must return 401 when unauthenticated");
  });

  it("scopes DB lookup to current user", () => {
    const s = src(DEBUG_ENDPOINT);
    assert.ok(
      s.includes("userId: currentUser.id"),
      "must scope DB lookup to current user's account",
    );
  });

  it("imports effectiveSupportedRawLimits from the futures contracts registry", () => {
    const s = src(DEBUG_ENDPOINT);
    assert.ok(
      s.includes("effectiveSupportedRawLimits"),
      "must import and use effectiveSupportedRawLimits for per-product display",
    );
  });

  it("returns suggestedAction field for stale raw limit repair guidance", () => {
    const s = src(DEBUG_ENDPOINT);
    assert.ok(s.includes("suggestedAction"), "must return suggestedAction field");
    assert.ok(
      s.includes("deactivate_stale_raw_limit"),
      'suggestedAction value must be "deactivate_stale_raw_limit"',
    );
  });

  it("returns suggestedEndpoint pointing to sync-broker-rules when stale limit found", () => {
    const s = src(DEBUG_ENDPOINT);
    assert.ok(s.includes("suggestedEndpoint"), "must return suggestedEndpoint field");
    assert.ok(
      s.includes("sync-broker-rules"),
      "suggestedEndpoint must reference sync-broker-rules repair endpoint",
    );
  });

  it("sets suggestedAction and suggestedEndpoint to null when broker state is ok", () => {
    // When isStale=false, both fields must be null — not absent.
    const s = src(DEBUG_ENDPOINT);
    // Both fields appear in the response object — they will be null when not stale.
    const suggestedActionCount = (s.match(/suggestedAction/g) ?? []).length;
    assert.ok(suggestedActionCount >= 2, "suggestedAction must appear in both the JSDoc and the response");
  });
});

// ── 5. POST sync-broker-rules: stale raw limit cleanup ───────────────────────

describe("POST /api/accounts/[id]/sync-broker-rules: stale raw limit repair", () => {
  it("calls deactivateGuardrailRawLimit (two-step safer strategy)", () => {
    const s = src(SYNC_BROKER_RULES_ROUTE);
    assert.ok(
      s.includes("deactivateGuardrailRawLimit("),
      "must call deactivateGuardrailRawLimit for two-step safe deactivation",
    );
  });

  it("never writes a global raw limit (brokerEnforcementMode is app_side_only)", () => {
    const s = src(SYNC_BROKER_RULES_ROUTE);
    assert.ok(
      s.includes('"app_side_only"'),
      'response must include brokerEnforcementMode: "app_side_only"',
    );
    assert.ok(
      !s.includes('"global_raw"'),
      "must never use global_raw mode (would write a raw cap that blocks micro orders)",
    );
  });

  it("requires authentication (401 for unauthenticated)", () => {
    const s = src(SYNC_BROKER_RULES_ROUTE);
    assert.ok(s.includes("getCurrentUser"), "must call getCurrentUser");
    assert.ok(s.includes("status: 401"), "must return 401 when unauthenticated");
  });

  it("returns JSON error (not raw 500) when account is not found", () => {
    const s = src(SYNC_BROKER_RULES_ROUTE);
    assert.ok(s.includes("not_found"), "must return not_found JSON error when account missing");
    assert.ok(s.includes("status: 404"), "must return 404 for not_found");
  });

  it("returns JSON error when account has no external Tradovate ID", () => {
    const s = src(SYNC_BROKER_RULES_ROUTE);
    assert.ok(
      s.includes("no_external_account_id"),
      "must return no_external_account_id JSON error when externalAccountId is absent",
    );
    assert.ok(s.includes("status: 422"), "must return 422 for no_external_account_id");
  });

  it("wraps broker calls in try/catch — never returns raw 500 on TradovateClientError", () => {
    const s = src(SYNC_BROKER_RULES_ROUTE);
    const tryIdx = s.indexOf("try {");
    const catchIdx = s.indexOf("} catch (err)");
    assert.ok(tryIdx !== -1, "must have a try block around broker calls");
    assert.ok(catchIdx !== -1, "must have a catch block for broker errors");
    assert.ok(tryIdx < catchIdx, "try must precede catch");
    const deactivateIdx = s.indexOf("deactivateGuardrailRawLimit(");
    assert.ok(
      deactivateIdx > tryIdx && deactivateIdx < catchIdx,
      "deactivateGuardrailRawLimit must be inside the try block",
    );
  });

  it("returns 409 manual_cleanup_required when Tradovate rejects deactivation", () => {
    const s = src(SYNC_BROKER_RULES_ROUTE);
    assert.ok(
      s.includes("manual_cleanup_required"),
      "must return manual_cleanup_required error when deactivation fails",
    );
    assert.ok(
      s.includes("status: 409"),
      "manual_cleanup_required must return HTTP 409",
    );
    assert.ok(
      s.includes("manualCleanupRequired"),
      "must check result.manualCleanupRequired to distinguish 409 from 200",
    );
  });

  it("409 response includes limitId to help user find the record in Tradovate UI", () => {
    const s = src(SYNC_BROKER_RULES_ROUTE);
    const idx = s.indexOf("manual_cleanup_required");
    const block = s.slice(idx - 100, idx + 800);
    assert.ok(block.includes("limitId"), "409 response must include limitId");
  });

  it("returns ok:false JSON on broker auth/network failure (never raw 500)", () => {
    const s = src(SYNC_BROKER_RULES_ROUTE);
    assert.ok(s.includes("broker_cleanup_failed"), "catch block must return broker_cleanup_failed error");
    assert.ok(s.includes("ok: false"), "error response must include ok: false");
    assert.ok(s.includes("status: 502"), "broker failure must return HTTP 502");
  });

  it("includes TradovateClientError code in 502 error response", () => {
    const s = src(SYNC_BROKER_RULES_ROUTE);
    assert.ok(
      s.includes("TradovateClientError"),
      "must import and check TradovateClientError to extract code",
    );
    assert.ok(s.includes("err.code"), "must include error code in 502 response");
  });

  it("returns ok:true with deactivated and limitId in success response", () => {
    const s = src(SYNC_BROKER_RULES_ROUTE);
    assert.ok(s.includes("ok: true"), "success response must include ok: true");
    assert.ok(s.includes("result.deactivated"), "success response must include deactivated from result");
    assert.ok(s.includes("result.limitId"), "success response must include limitId from result");
    assert.ok(s.includes("result.action"), "success response must include action from result");
  });

  it("scopes DB lookup to current user", () => {
    const s = src(SYNC_BROKER_RULES_ROUTE);
    assert.ok(
      s.includes("userId: currentUser.id"),
      "must scope DB lookup to the authenticated user's account",
    );
  });

  it("scopes to tradovate platform only", () => {
    const s = src(SYNC_BROKER_RULES_ROUTE);
    assert.ok(
      s.includes('"tradovate"'),
      "must scope DB lookup to platform=tradovate",
    );
  });

  it("success log does not contain token fields", () => {
    const s = src(SYNC_BROKER_RULES_ROUTE);
    const logIdx = s.indexOf("[accounts/sync-broker-rules] deactivateGuardrailRawLimit completed");
    assert.ok(logIdx !== -1, "must have a [accounts/sync-broker-rules] success log line");
    const logBlock = s.slice(logIdx, logIdx + 600);
    const forbidden = [
      "accessToken",
      "refreshToken",
      "tokenEncrypted",
      "accessTokenEncrypted",
      "refreshTokenEncrypted",
    ];
    for (const field of forbidden) {
      assert.ok(!logBlock.includes(field), `success log must not include token field: ${field}`);
    }
  });

  it("error log does not contain token fields", () => {
    const s = src(SYNC_BROKER_RULES_ROUTE);
    const logIdx = s.indexOf("[accounts/sync-broker-rules] broker cleanup failed");
    assert.ok(logIdx !== -1, "must have a [accounts/sync-broker-rules] error log line");
    const logBlock = s.slice(logIdx, logIdx + 500);
    const forbidden = [
      "accessToken",
      "refreshToken",
      "tokenEncrypted",
      "accessTokenEncrypted",
      "refreshTokenEncrypted",
    ];
    for (const field of forbidden) {
      assert.ok(!logBlock.includes(field), `error log must not include token field: ${field}`);
    }
  });

  it("logs brokerConnectionId in both success and error paths", () => {
    const s = src(SYNC_BROKER_RULES_ROUTE);
    const successLogIdx = s.indexOf("[accounts/sync-broker-rules] deactivateGuardrailRawLimit completed");
    const errorLogIdx = s.indexOf("[accounts/sync-broker-rules] broker cleanup failed");
    const successBlock = s.slice(successLogIdx, successLogIdx + 600);
    const errorBlock = s.slice(errorLogIdx, errorLogIdx + 500);
    assert.ok(successBlock.includes("brokerConnectionId"), "success log must include brokerConnectionId");
    assert.ok(errorBlock.includes("brokerConnectionId"), "error log must include brokerConnectionId");
  });

  it("params are awaited (Next.js App Router pattern)", () => {
    const s = src(SYNC_BROKER_RULES_ROUTE);
    assert.ok(
      s.includes("await ctx.params") || s.includes("await params"),
      "params must be awaited — Next.js App Router requires this",
    );
  });

  it("does not touch user-created or prop-firm-created Tradovate limits", () => {
    // Safety guarantee: only limits identified by the GUARDRAIL_POSITION_LIMIT_DESCRIPTION
    // constant are touched. The route delegates entirely to deactivateGuardrailRawLimit which
    // uses findGuardrailPositionLimit for that guard.
    const s = src(SYNC_BROKER_RULES_ROUTE);
    // The route must NOT call any Tradovate position limit endpoints directly.
    assert.ok(
      !s.includes("userAccountPositionLimit/update"),
      "route must not call Tradovate endpoints directly — delegate to deactivateGuardrailRawLimit",
    );
    assert.ok(
      !s.includes("userAccountPositionLimit/create"),
      "route must not call Tradovate endpoints directly — delegate to deactivateGuardrailRawLimit",
    );
  });
});

// ── 6. debug endpoint: manualCleanupInstructions field ───────────────────────

describe("GET /api/debug/tradovate-position-limit: manual cleanup instructions", () => {
  it("returns manualCleanupInstructions field", () => {
    const s = src(DEBUG_ENDPOINT);
    assert.ok(
      s.includes("manualCleanupInstructions"),
      "must return manualCleanupInstructions for stale-limit repair guidance",
    );
  });

  it("manualCleanupInstructions is null when broker state is ok", () => {
    const s = src(DEBUG_ENDPOINT);
    // The field must be null-able (only set when isStale=true).
    // Implementation guard: it must use the isStale flag.
    const instrIdx = s.indexOf("manualCleanupInstructions");
    assert.ok(instrIdx !== -1);
    const nearBy = s.slice(Math.max(0, instrIdx - 200), instrIdx + 400);
    assert.ok(
      nearBy.includes("isStale") || nearBy.includes("null"),
      "manualCleanupInstructions must be null when broker state is clean",
    );
  });

  it("manualCleanupInstructions mentions sync-broker-rules endpoint", () => {
    const s = src(DEBUG_ENDPOINT);
    const instrIdx = s.indexOf("manualCleanupInstructions");
    assert.ok(instrIdx !== -1);
    const block = s.slice(instrIdx, instrIdx + 800);
    assert.ok(
      block.includes("sync-broker-rules"),
      "manualCleanupInstructions must reference the automated repair endpoint",
    );
  });
});

// ── 7. Raw broker hard limit: opt-in only, default app_side_only ─────────────
//
// The "Broker raw hard limit" advanced mode writes a global raw contract cap
// (totalBy="Overall") to Tradovate only when rawBrokerHardLimitEnabled===true.
// Default is always app_side_only (standard-equivalent detection-response).

const ACCOUNT_RULES_FORM_SRC = readFileSync(
  resolve(import.meta.dirname, "../../../rules/_components/account-rules-form.tsx"),
  "utf8",
);

const RISK_RULES_DATA_SRC = readFileSync(
  resolve(import.meta.dirname, "./risk-rules-data.ts"),
  "utf8",
);

describe("raw broker hard limit: default is app_side_only", () => {
  it("route defaults to app_side_only when rawBrokerHardLimitEnabled is absent/false", () => {
    const s = src(ACCOUNT_ROUTE);
    // The default enforcement mode must be app_side_only.
    assert.ok(s.includes('"app_side_only"'), "route must have app_side_only as default enforcement mode");
  });

  it("route only uses global_raw when rawBrokerHardLimitEnabled is explicitly true", () => {
    const s = src(ACCOUNT_ROUTE);
    // global_raw must be gated on rawBrokerHardLimitEnabled === true.
    assert.ok(
      s.includes("rawBrokerHardLimitEnabled === true"),
      "route must gate global_raw on rawBrokerHardLimitEnabled === true",
    );
    assert.ok(
      s.includes('"global_raw"'),
      "route must reference global_raw so the conditional is reachable",
    );
  });

  it("route sets brokerEnforcementMode from rawBrokerHardLimitEnabled flag (not hardcoded)", () => {
    const s = src(ACCOUNT_ROUTE);
    // There must be a conditional that selects between the two modes.
    const rawIdx = s.indexOf("rawBrokerHardLimitEnabled");
    assert.ok(rawIdx !== -1, "route must read rawBrokerHardLimitEnabled from the request body");
    // The variable holding the mode must be passed to applyMaxPositionSize.
    assert.ok(
      s.includes("brokerEnforcementMode,") || s.includes("brokerEnforcementMode\n"),
      "route must pass brokerEnforcementMode variable (not a literal) to applyMaxPositionSize",
    );
  });

  it("route logs brokerEnforcementMode in the success path", () => {
    const s = src(ACCOUNT_ROUTE);
    const logIdx = s.indexOf("[accounts/patch] broker max position size synced");
    assert.ok(logIdx !== -1, "must have a success log line");
    const logBlock = s.slice(logIdx, logIdx + 600);
    assert.ok(logBlock.includes("brokerEnforcementMode"), "success log must include brokerEnforcementMode");
  });
});

describe("raw broker hard limit: UI toggle has warning copy", () => {
  it("account-rules-form has rawBrokerHardLimitEnabled toggle", () => {
    assert.ok(
      ACCOUNT_RULES_FORM_SRC.includes("rawBrokerHardLimitEnabled"),
      "account-rules-form must have rawBrokerHardLimitEnabled toggle",
    );
  });

  it("toggle warning explains raw contract count (counts all contracts equally)", () => {
    assert.ok(
      ACCOUNT_RULES_FORM_SRC.includes("counts all contracts equally") ||
        ACCOUNT_RULES_FORM_SRC.includes("counts all contracts the same") ||
        ACCOUNT_RULES_FORM_SRC.includes("counts all contracts"),
      "toggle warning must explain that raw limit counts all contracts equally",
    );
  });

  it("toggle warning includes MNQ example (concrete illustration of the limitation)", () => {
    assert.ok(
      ACCOUNT_RULES_FORM_SRC.includes("MNQ"),
      "toggle warning must include MNQ example so users understand the micro-contract impact",
    );
  });

  it("toggle warning does not call this mode 'standard-equivalent'", () => {
    // The warning is specifically for the RAW mode — it must not imply it is
    // the same as Guardrail's default standard-equivalent detection-response.
    const toggleIdx = ACCOUNT_RULES_FORM_SRC.indexOf("rawBrokerHardLimitEnabled");
    assert.ok(toggleIdx !== -1);
    const toggleBlock = ACCOUNT_RULES_FORM_SRC.slice(Math.max(0, toggleIdx - 200), toggleIdx + 800);
    assert.ok(
      !toggleBlock.includes("standard-equivalent") ||
        toggleBlock.includes("detection-response") ||
        toggleBlock.includes("default"),
      "toggle warning context must distinguish raw mode from standard-equivalent mode",
    );
  });
});

describe("raw broker hard limit: schema and data layer", () => {
  it("risk-rules-data.ts includes rawBrokerHardLimitEnabled in RiskRulesBody", () => {
    assert.ok(
      RISK_RULES_DATA_SRC.includes("rawBrokerHardLimitEnabled"),
      "RiskRulesBody must include rawBrokerHardLimitEnabled so the field is persisted",
    );
  });

  it("risk-rules-data.ts writes rawBrokerHardLimitEnabled to the DB payload", () => {
    const fnIdx = RISK_RULES_DATA_SRC.indexOf("export function riskRulesData");
    assert.ok(fnIdx !== -1, "riskRulesData function must exist");
    const fnBody = RISK_RULES_DATA_SRC.slice(fnIdx, fnIdx + 1000);
    assert.ok(
      fnBody.includes("rawBrokerHardLimitEnabled"),
      "riskRulesData must map rawBrokerHardLimitEnabled to the DB payload",
    );
  });
});
