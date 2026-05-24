/**
 * Source-scan tests for the Daily Loss risk-settings sync wire-up.
 *
 * These tests verify structural safety guarantees without a DB, network, or real
 * credentials. They guard against regressions where:
 *
 *  1. The route fails to fire the daily loss sync when maxDailyLoss is saved.
 *  2. The sync helper calls TradovateClient directly instead of through gates.
 *  3. The BROKER_ENFORCEMENT_ENABLED / ENFORCEMENT_DRY_RUN env vars are bypassed.
 *  4. The account allowlist gate is skipped.
 *  5. Broker sync failure rolls back the DB save.
 *  6. Non-maxDailyLoss rules (profit target, max trades, etc.) accidentally trigger sync.
 *  7. Token fields appear in sync logs.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ACCOUNT_ROUTE = resolve(import.meta.dirname, "./route.ts");
const DAILY_LOSS_SYNC = resolve(import.meta.dirname, "./daily-loss-sync.ts");

function src(f: string): string {
  return readFileSync(f, "utf8");
}

// ── 1. Route fires daily loss sync when maxDailyLoss is in the payload ────────

describe("PATCH /api/accounts/[id]: daily loss sync wire-up", () => {
  it("imports executeDailyLossSync", () => {
    const s = src(ACCOUNT_ROUTE);
    assert.ok(
      s.includes("executeDailyLossSync"),
      "route must import and call executeDailyLossSync",
    );
  });

  it("checks maxDailyLoss is present in the body before firing sync", () => {
    const s = src(ACCOUNT_ROUTE);
    assert.ok(
      s.includes('"maxDailyLoss" in body.riskRules'),
      'route must check "maxDailyLoss" in body.riskRules before firing sync',
    );
  });

  it("guards on platform === tradovate", () => {
    const s = src(ACCOUNT_ROUTE);
    // The daily loss sync block must check platform
    const syncIdx = s.indexOf("executeDailyLossSync(");
    assert.ok(syncIdx !== -1, "route must call executeDailyLossSync");
    // The guard block before executeDailyLossSync must check platform
    const guardBlock = s.slice(0, syncIdx);
    const lastPlatformCheck = guardBlock.lastIndexOf('"tradovate"');
    assert.ok(
      lastPlatformCheck !== -1,
      'route must guard daily loss sync on platform === "tradovate"',
    );
  });

  it("guards on maxDailyLoss > 0", () => {
    const s = src(ACCOUNT_ROUTE);
    assert.ok(
      s.includes("maxDailyLoss > 0"),
      "route must guard daily loss sync on maxDailyLoss > 0",
    );
  });

  it("fires daily loss sync as fire-and-forget (void)", () => {
    const s = src(ACCOUNT_ROUTE);
    // There must be a void async block for the daily loss sync — different from
    // the maxContracts void block. Confirm "executeDailyLossSync" appears inside a void block.
    const voidAsyncIdx = s.lastIndexOf("void (async");
    assert.ok(voidAsyncIdx !== -1, "route must have a void (async) block");
    const afterVoid = s.slice(voidAsyncIdx);
    assert.ok(
      afterVoid.includes("executeDailyLossSync"),
      "daily loss sync void block must call executeDailyLossSync",
    );
  });

  it("wraps daily loss sync in try/catch so DB save is never rolled back", () => {
    const s = src(ACCOUNT_ROUTE);
    const syncIdx = s.indexOf("executeDailyLossSync(");
    assert.ok(syncIdx !== -1);
    const tryIdx = s.lastIndexOf("try {", syncIdx);
    assert.ok(tryIdx !== -1 && tryIdx < syncIdx, "daily loss sync must be inside try/catch");
    const catchIdx = s.indexOf("catch (err)", tryIdx);
    assert.ok(
      catchIdx !== -1 && catchIdx > syncIdx,
      "must have a catch block after executeDailyLossSync",
    );
  });

  it("daily loss sync log does not contain token fields", () => {
    const s = src(ACCOUNT_ROUTE);
    const logIdx = s.indexOf("[accounts/patch] daily loss sync outcome");
    assert.ok(logIdx !== -1, "route must have a [accounts/patch] daily loss sync log");
    const logBlock = s.slice(logIdx, logIdx + 500);
    const forbidden = [
      "accessToken",
      "refreshToken",
      "tokenEncrypted",
      "accessTokenEncrypted",
      "refreshTokenEncrypted",
    ];
    for (const field of forbidden) {
      assert.ok(!logBlock.includes(field), `daily loss sync log must not include token field: ${field}`);
    }
  });

  it("daily loss sync error log does not contain token fields", () => {
    const s = src(ACCOUNT_ROUTE);
    const logIdx = s.indexOf("[accounts/patch] daily loss sync failed (non-fatal)");
    assert.ok(logIdx !== -1, "route must have a daily loss sync error log");
    const logBlock = s.slice(logIdx, logIdx + 300);
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

  it("fetches brokerConnection for env/connectionStatus/permissionLevel", () => {
    const s = src(ACCOUNT_ROUTE);
    const syncIdx = s.indexOf("executeDailyLossSync(");
    assert.ok(syncIdx !== -1);
    const beforeSync = s.slice(0, syncIdx);
    assert.ok(
      beforeSync.includes("brokerConnection"),
      "route must query brokerConnection before calling executeDailyLossSync",
    );
    assert.ok(
      beforeSync.includes("env: true") || beforeSync.includes("env:"),
      "brokerConnection query must select env",
    );
  });

  it("fetches guardianProfile for guardianEnabled", () => {
    const s = src(ACCOUNT_ROUTE);
    const syncIdx = s.indexOf("executeDailyLossSync(");
    assert.ok(syncIdx !== -1);
    const beforeSync = s.slice(0, syncIdx);
    assert.ok(
      beforeSync.includes("guardianProfile"),
      "route must query guardianProfile before calling executeDailyLossSync",
    );
    assert.ok(
      beforeSync.includes("guardianEnabled"),
      "guardianProfile query must select guardianEnabled",
    );
  });
});

// ── 2. daily-loss-sync.ts: gate safety guarantees ─────────────────────────────

describe("daily-loss-sync.ts: gate evaluation before client creation", () => {
  it("imports canSyncTradovateRiskSettings (evaluates gates before client)", () => {
    const s = src(DAILY_LOSS_SYNC);
    assert.ok(
      s.includes("canSyncTradovateRiskSettings"),
      "daily-loss-sync must call canSyncTradovateRiskSettings to evaluate gates before client",
    );
  });

  it("reads BROKER_ENFORCEMENT_ENABLED from process.env", () => {
    const s = src(DAILY_LOSS_SYNC);
    assert.ok(
      s.includes("BROKER_ENFORCEMENT_ENABLED"),
      "must read BROKER_ENFORCEMENT_ENABLED from process.env",
    );
  });

  it("reads ENFORCEMENT_DRY_RUN from process.env", () => {
    const s = src(DAILY_LOSS_SYNC);
    assert.ok(
      s.includes("ENFORCEMENT_DRY_RUN"),
      "must read ENFORCEMENT_DRY_RUN from process.env",
    );
  });

  it("uses isAccountAllowlisted for BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST", () => {
    const s = src(DAILY_LOSS_SYNC);
    assert.ok(
      s.includes("isAccountAllowlisted"),
      "must use isAccountAllowlisted to check BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST",
    );
    assert.ok(
      s.includes("BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST"),
      "isAccountAllowlisted must reference BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST",
    );
  });

  it("imports simulateTradovateRiskSettingsSync for dry-run path (never calls broker)", () => {
    const s = src(DAILY_LOSS_SYNC);
    assert.ok(
      s.includes("simulateTradovateRiskSettingsSync"),
      "must use simulateTradovateRiskSettingsSync in dry-run path — it never calls TradovateClient",
    );
  });

  it("does not import from broker-enforcement-service (listener path must stay separate)", () => {
    const s = src(DAILY_LOSS_SYNC);
    // Check import statements only — search for an import with that module name.
    // Comments referencing the module name for documentation are allowed.
    const importLines = s
      .split("\n")
      .filter((l) => l.trimStart().startsWith("import "));
    const importsEnforcementService = importLines.some((l) =>
      l.includes("broker-enforcement-service"),
    );
    assert.ok(
      !importsEnforcementService,
      "daily-loss-sync must not import from broker-enforcement-service (paths must stay independent)",
    );
    assert.ok(
      !s.includes("evaluateBrokerEnforcementGates"),
      "daily-loss-sync must not call evaluateBrokerEnforcementGates from the listener path",
    );
  });

  it("exports isAccountAllowlisted function", () => {
    const s = src(DAILY_LOSS_SYNC);
    assert.ok(
      s.includes("export function isAccountAllowlisted"),
      "must export isAccountAllowlisted so callers can inspect allowlist state",
    );
  });

  it("exports executeDailyLossSync function", () => {
    const s = src(DAILY_LOSS_SYNC);
    assert.ok(
      s.includes("export async function executeDailyLossSync"),
      "must export executeDailyLossSync",
    );
  });

  it("exports DailyLossSyncContext type", () => {
    const s = src(DAILY_LOSS_SYNC);
    assert.ok(
      s.includes("export type DailyLossSyncContext"),
      "must export DailyLossSyncContext type for callers to build context",
    );
  });

  it("exports DailyLossSyncOutcome type", () => {
    const s = src(DAILY_LOSS_SYNC);
    assert.ok(
      s.includes("export type DailyLossSyncOutcome"),
      "must export DailyLossSyncOutcome type for callers to handle results",
    );
  });

  it("skips when maxDailyLoss <= 0", () => {
    const s = src(DAILY_LOSS_SYNC);
    assert.ok(
      s.includes("maxDailyLoss <= 0"),
      "must return skipped immediately when maxDailyLoss <= 0",
    );
  });

  it("clientFactory is only invoked after gates pass and not in dry-run", () => {
    const s = src(DAILY_LOSS_SYNC);
    // Use the actual awaited call pattern (not the JSDoc comment mention)
    const gateCheckIdx = s.indexOf("canSyncTradovateRiskSettings(input)");
    const dryRunIdx = s.indexOf('ENFORCEMENT_DRY_RUN === "true"');
    const clientFactoryCallIdx = s.indexOf("await clientFactory()");
    assert.ok(gateCheckIdx !== -1, "must call canSyncTradovateRiskSettings(input)");
    assert.ok(dryRunIdx !== -1, 'must check ENFORCEMENT_DRY_RUN === "true"');
    assert.ok(clientFactoryCallIdx !== -1, "must call await clientFactory()");
    assert.ok(
      gateCheckIdx < clientFactoryCallIdx,
      "gate check must come before await clientFactory() call",
    );
    assert.ok(
      dryRunIdx < clientFactoryCallIdx,
      "dry-run check must come before await clientFactory() call",
    );
  });
});

// ── 3. Non-maxDailyLoss rules must not trigger daily loss sync ────────────────

describe("PATCH /api/accounts/[id]: only maxDailyLoss triggers daily loss sync", () => {
  it("daily loss sync is gated on maxDailyLoss key — not triggered by all rule saves", () => {
    const s = src(ACCOUNT_ROUTE);
    // The guard must check "maxDailyLoss" specifically — not fire for every riskRules save.
    assert.ok(
      s.includes('"maxDailyLoss" in body.riskRules'),
      'sync must be gated on "maxDailyLoss" key being present in the payload',
    );
  });

  it("daily loss sync is not triggered on the pending-rules save path", () => {
    // Pending save path stores the change but does not write to AccountRiskRules.
    // The sync must only be in the else branch (immediate save) — not in the pending block.
    const s = src(ACCOUNT_ROUTE);
    const pendingSaveIdx = s.indexOf("saved_as_pending");
    const syncIdx = s.indexOf("executeDailyLossSync(");
    assert.ok(pendingSaveIdx !== -1, "route must have saved_as_pending audit entry");
    assert.ok(syncIdx !== -1, "route must have executeDailyLossSync call");
    // The sync must come AFTER the pending save block (i.e., in the else branch)
    assert.ok(
      syncIdx > pendingSaveIdx,
      "executeDailyLossSync must be in the else (immediate save) branch, not the pending branch",
    );
  });
});

// ── 4. Rule-save consent + externalAccountId wiring ──────────────────────────

describe("PATCH /api/accounts/[id]: consent + externalAccountId wiring (rule-save Gate 9 + 10)", () => {
  it("route fetches AccountRiskRules consent fields before executeDailyLossSync", () => {
    const s = src(ACCOUNT_ROUTE);
    const syncIdx = s.indexOf("executeDailyLossSync(");
    assert.ok(syncIdx !== -1);
    const beforeSync = s.slice(0, syncIdx);
    assert.ok(
      beforeSync.includes("accountRiskRules.findUnique") ||
        beforeSync.includes("accountRulesForConsent"),
      "route must query AccountRiskRules for consent before calling executeDailyLossSync",
    );
    assert.ok(
      beforeSync.includes("automatedActionsConsentAt"),
      "route must select automatedActionsConsentAt",
    );
    assert.ok(
      beforeSync.includes("automatedActionsConsentVersion"),
      "route must select automatedActionsConsentVersion",
    );
  });

  it("route also fetches default RiskRules consent fields (fallback)", () => {
    const s = src(ACCOUNT_ROUTE);
    const syncIdx = s.indexOf("executeDailyLossSync(");
    const beforeSync = s.slice(0, syncIdx);
    assert.ok(
      beforeSync.includes("riskRules.findUnique"),
      "route must query default RiskRules as the consent fallback",
    );
  });

  it("route passes consentAt/consentVersion into executeDailyLossSync context", () => {
    const s = src(ACCOUNT_ROUTE);
    const syncStartIdx = s.indexOf("await executeDailyLossSync(");
    assert.ok(syncStartIdx !== -1);
    // Look at the context-object literal that follows.
    const ctxBlock = s.slice(syncStartIdx, syncStartIdx + 2000);
    assert.ok(
      ctxBlock.includes("consentAt"),
      "executeDailyLossSync call must pass consentAt",
    );
    assert.ok(
      ctxBlock.includes("consentVersion"),
      "executeDailyLossSync call must pass consentVersion",
    );
  });

  it("route passes externalAccountId into executeDailyLossSync context", () => {
    const s = src(ACCOUNT_ROUTE);
    const syncStartIdx = s.indexOf("await executeDailyLossSync(");
    assert.ok(syncStartIdx !== -1);
    const ctxBlock = s.slice(syncStartIdx, syncStartIdx + 2000);
    assert.ok(
      ctxBlock.includes("externalAccountId"),
      "executeDailyLossSync call must pass externalAccountId so Gate 10 can validate",
    );
  });

  it("daily-loss-sync.ts context type declares consentAt/consentVersion/externalAccountId", () => {
    const s = src(DAILY_LOSS_SYNC);
    assert.ok(
      s.includes("consentAt:"),
      "DailyLossSyncContext must include consentAt",
    );
    assert.ok(
      s.includes("consentVersion:"),
      "DailyLossSyncContext must include consentVersion",
    );
    assert.ok(
      s.includes("externalAccountId:"),
      "DailyLossSyncContext must include externalAccountId",
    );
  });

  it("daily-loss-sync.ts forwards consent + externalAccountId into SyncInput", () => {
    const s = src(DAILY_LOSS_SYNC);
    const inputIdx = s.indexOf("const input: SyncInput");
    assert.ok(inputIdx !== -1, "must build a SyncInput literal");
    const inputBlock = s.slice(inputIdx, inputIdx + 1000);
    assert.ok(inputBlock.includes("consentAt"), "SyncInput must carry consentAt");
    assert.ok(inputBlock.includes("consentVersion"), "SyncInput must carry consentVersion");
    assert.ok(
      inputBlock.includes("externalAccountId"),
      "SyncInput must carry externalAccountId",
    );
  });
});
