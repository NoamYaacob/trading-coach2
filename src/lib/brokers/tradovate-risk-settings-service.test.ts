/**
 * Unit tests for tradovate-risk-settings-service.ts
 *
 * These tests cover the rule-save sync path only. They exercise gate logic,
 * payload building, safety assertions, and dry-run behavior.
 *
 * No TradovateClient is instantiated. No network calls. No database.
 *
 * Run: npm run test:unit
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  assertDailyLossOnly,
  BROKER_INELIGIBLE_RULE_KEYS,
  buildTradovateRiskSettingsPayload,
  canSyncTradovateRiskSettings,
  simulateTradovateRiskSettingsSync,
  syncDailyLossRiskSettingToTradovate,
} from "./tradovate-risk-settings-service.ts";
import type { CanSyncInput, SyncInput } from "./tradovate-risk-settings-service.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

const allPassDemoInput: CanSyncInput = {
  brokerEnforcementEnabled: true,
  env: "demo",
  isActive: true,
  missingFromBroker: false,
  connectionStatus: "connected",
  permissionLevel: "full_access",
  accountAllowlisted: true,
  guardianEnabled: true,
};

const allPassSyncInput: SyncInput = {
  ...allPassDemoInput,
  maxDailyLoss: 500,
};

// ── buildTradovateRiskSettingsPayload ─────────────────────────────────────────

describe("buildTradovateRiskSettingsPayload", () => {
  it("positive value: dailyLossAutoLiq equals input", () => {
    const payload = buildTradovateRiskSettingsPayload(500);
    assert.equal(payload.dailyLossAutoLiq, 500);
  });

  it("positive value: changesLocked is true", () => {
    const payload = buildTradovateRiskSettingsPayload(500);
    assert.equal(payload.changesLocked, true);
  });

  it("negative value: uses absolute value (355.76)", () => {
    const payload = buildTradovateRiskSettingsPayload(-355.76);
    assert.equal(payload.dailyLossAutoLiq, 355.76);
  });

  it("negative value: changesLocked is true", () => {
    const payload = buildTradovateRiskSettingsPayload(-355.76);
    assert.equal(payload.changesLocked, true);
  });

  it("zero returns 0 (absolute value of zero)", () => {
    const payload = buildTradovateRiskSettingsPayload(0);
    assert.equal(payload.dailyLossAutoLiq, 0);
  });
});

// ── assertDailyLossOnly ───────────────────────────────────────────────────────

describe("assertDailyLossOnly", () => {
  it("does NOT throw for 'maxDailyLoss'", () => {
    assert.doesNotThrow(() => assertDailyLossOnly("maxDailyLoss"));
  });

  it("throws for 'dailyProfitTarget'", () => {
    assert.throws(
      () => assertDailyLossOnly("dailyProfitTarget"),
      /dailyProfitTarget.*not broker-eligible/,
    );
  });

  it("throws for 'maxTradesPerDay'", () => {
    assert.throws(
      () => assertDailyLossOnly("maxTradesPerDay"),
      /maxTradesPerDay.*not broker-eligible/,
    );
  });

  it("throws for 'stopAfterLosses'", () => {
    assert.throws(
      () => assertDailyLossOnly("stopAfterLosses"),
      /stopAfterLosses.*not broker-eligible/,
    );
  });

  it("throws for 'maxContracts'", () => {
    assert.throws(
      () => assertDailyLossOnly("maxContracts"),
      /maxContracts.*not broker-eligible/,
    );
  });

  it("throws for 'sessionEndHour'", () => {
    assert.throws(
      () => assertDailyLossOnly("sessionEndHour"),
      /sessionEndHour.*not broker-eligible/,
    );
  });

  it("throws for 'sessionEndBehavior'", () => {
    assert.throws(
      () => assertDailyLossOnly("sessionEndBehavior"),
      /sessionEndBehavior.*not broker-eligible/,
    );
  });

  it("error message includes the ineligible rule key", () => {
    let message = "";
    try {
      assertDailyLossOnly("dailyProfitTarget");
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    assert.ok(message.includes("dailyProfitTarget"), `message was: ${message}`);
    assert.ok(
      message.includes("Only maxDailyLoss can be synced"),
      `message was: ${message}`,
    );
  });
});

// ── BROKER_INELIGIBLE_RULE_KEYS ───────────────────────────────────────────────

describe("BROKER_INELIGIBLE_RULE_KEYS", () => {
  it("includes dailyProfitTarget", () => {
    assert.ok(BROKER_INELIGIBLE_RULE_KEYS.includes("dailyProfitTarget" as never));
  });

  it("includes maxTradesPerDay", () => {
    assert.ok(BROKER_INELIGIBLE_RULE_KEYS.includes("maxTradesPerDay" as never));
  });

  it("includes stopAfterLosses", () => {
    assert.ok(BROKER_INELIGIBLE_RULE_KEYS.includes("stopAfterLosses" as never));
  });

  it("includes maxContracts", () => {
    assert.ok(BROKER_INELIGIBLE_RULE_KEYS.includes("maxContracts" as never));
  });

  it("does NOT include maxDailyLoss", () => {
    assert.ok(!BROKER_INELIGIBLE_RULE_KEYS.includes("maxDailyLoss" as never));
  });
});

// ── canSyncTradovateRiskSettings ──────────────────────────────────────────────

describe("canSyncTradovateRiskSettings", () => {
  it("allows when all gates pass (demo)", () => {
    const result = canSyncTradovateRiskSettings(allPassDemoInput);
    assert.equal(result.allowed, true);
    assert.equal(result.skipReason, null);
  });

  it("gate 1: blocks when brokerEnforcementEnabled=false", () => {
    const result = canSyncTradovateRiskSettings({
      ...allPassDemoInput,
      brokerEnforcementEnabled: false,
    });
    assert.equal(result.allowed, false);
    assert.ok(result.skipReason?.includes("BROKER_ENFORCEMENT_ENABLED"), result.skipReason ?? "");
  });

  it("gate 2: blocks when env='live'", () => {
    const result = canSyncTradovateRiskSettings({
      ...allPassDemoInput,
      env: "live",
    });
    assert.equal(result.allowed, false);
    assert.ok(result.skipReason?.includes("live"), result.skipReason ?? "");
  });

  it("gate 2: blocks when env='sim'", () => {
    const result = canSyncTradovateRiskSettings({
      ...allPassDemoInput,
      env: "sim",
    });
    assert.equal(result.allowed, false);
  });

  it("gate 3: blocks when isActive=false", () => {
    const result = canSyncTradovateRiskSettings({
      ...allPassDemoInput,
      isActive: false,
    });
    assert.equal(result.allowed, false);
    assert.ok(result.skipReason?.includes("inactive"), result.skipReason ?? "");
  });

  it("gate 4: blocks when missingFromBroker=true", () => {
    const result = canSyncTradovateRiskSettings({
      ...allPassDemoInput,
      missingFromBroker: true,
    });
    assert.equal(result.allowed, false);
    assert.ok(result.skipReason?.includes("missingFromBrokerSince"), result.skipReason ?? "");
  });

  it("gate 5: blocks when connectionStatus='expired'", () => {
    const result = canSyncTradovateRiskSettings({
      ...allPassDemoInput,
      connectionStatus: "expired",
    });
    assert.equal(result.allowed, false);
    assert.ok(result.skipReason?.includes("expired"), result.skipReason ?? "");
  });

  it("gate 5: blocks when connectionStatus='connection_error'", () => {
    const result = canSyncTradovateRiskSettings({
      ...allPassDemoInput,
      connectionStatus: "connection_error",
    });
    assert.equal(result.allowed, false);
  });

  it("gate 5: blocks when connectionStatus='not_connected'", () => {
    const result = canSyncTradovateRiskSettings({
      ...allPassDemoInput,
      connectionStatus: "not_connected",
    });
    assert.equal(result.allowed, false);
  });

  it("gate 5: blocks when connectionStatus=null (treated as not_connected)", () => {
    const result = canSyncTradovateRiskSettings({
      ...allPassDemoInput,
      connectionStatus: null,
    });
    assert.equal(result.allowed, false);
  });

  it("gate 6: blocks when permissionLevel='read_only'", () => {
    const result = canSyncTradovateRiskSettings({
      ...allPassDemoInput,
      permissionLevel: "read_only",
    });
    assert.equal(result.allowed, false);
  });

  it("gate 6: blocks when permissionLevel=null", () => {
    const result = canSyncTradovateRiskSettings({
      ...allPassDemoInput,
      permissionLevel: null,
    });
    assert.equal(result.allowed, false);
  });

  it("gate ordering: brokerEnforcementEnabled=false checked before env", () => {
    // Both gates fail — must report gate 1 reason (BROKER_ENFORCEMENT_ENABLED)
    const result = canSyncTradovateRiskSettings({
      ...allPassDemoInput,
      brokerEnforcementEnabled: false,
      env: "live",
    });
    assert.equal(result.allowed, false);
    assert.ok(result.skipReason?.includes("BROKER_ENFORCEMENT_ENABLED"), result.skipReason ?? "");
  });

  it("does NOT require InternalLockEvent (different from listener path)", () => {
    // The all-pass input has no InternalLockEvent field — it must still pass
    const result = canSyncTradovateRiskSettings(allPassDemoInput);
    assert.equal(result.allowed, true);
  });

  it("gate 7: blocks when accountAllowlisted=false", () => {
    const result = canSyncTradovateRiskSettings({
      ...allPassDemoInput,
      accountAllowlisted: false,
    });
    assert.equal(result.allowed, false);
    assert.ok(result.skipReason?.includes("allowlist"), result.skipReason ?? "");
  });

  it("gate 7: gateFailureReason='account_not_allowlisted' when not allowlisted", () => {
    const result = canSyncTradovateRiskSettings({
      ...allPassDemoInput,
      accountAllowlisted: false,
    });
    assert.equal(result.gateFailureReason, "account_not_allowlisted");
  });

  it("gate 7: accountAllowlisted=true passes (all other gates pass)", () => {
    const result = canSyncTradovateRiskSettings({
      ...allPassDemoInput,
      accountAllowlisted: true,
    });
    assert.equal(result.allowed, true);
    assert.equal(result.gateFailureReason, null);
  });

  it("gate 8: blocks when guardianEnabled=false", () => {
    const result = canSyncTradovateRiskSettings({
      ...allPassDemoInput,
      guardianEnabled: false,
    });
    assert.equal(result.allowed, false);
    assert.ok(result.skipReason?.includes("Guardian"), result.skipReason ?? "");
  });

  it("gate 8: gateFailureReason='guardian_inactive' when guardian off", () => {
    const result = canSyncTradovateRiskSettings({
      ...allPassDemoInput,
      guardianEnabled: false,
    });
    assert.equal(result.gateFailureReason, "guardian_inactive");
  });

  it("gate 8: guardianEnabled=true passes (all other gates pass)", () => {
    const result = canSyncTradovateRiskSettings({
      ...allPassDemoInput,
      guardianEnabled: true,
    });
    assert.equal(result.allowed, true);
    assert.equal(result.gateFailureReason, null);
  });

  it("gate ordering: gate 7 checked before gate 8", () => {
    // Both fail — must report gate 7 reason (allowlist)
    const result = canSyncTradovateRiskSettings({
      ...allPassDemoInput,
      accountAllowlisted: false,
      guardianEnabled: false,
    });
    assert.equal(result.allowed, false);
    assert.equal(result.gateFailureReason, "account_not_allowlisted");
  });

  it("allowed result: gateFailureReason=null when all gates pass", () => {
    const result = canSyncTradovateRiskSettings(allPassDemoInput);
    assert.equal(result.gateFailureReason, null);
  });
});

// ── simulateTradovateRiskSettingsSync ─────────────────────────────────────────

describe("simulateTradovateRiskSettingsSync", () => {
  it("blocked input: attempted=false", async () => {
    const result = await simulateTradovateRiskSettingsSync({
      ...allPassSyncInput,
      brokerEnforcementEnabled: false,
    });
    assert.equal(result.attempted, false);
  });

  it("blocked input: allowed=false", async () => {
    const result = await simulateTradovateRiskSettingsSync({
      ...allPassSyncInput,
      brokerEnforcementEnabled: false,
    });
    assert.equal(result.allowed, false);
  });

  it("blocked input: payloadPreview=null", async () => {
    const result = await simulateTradovateRiskSettingsSync({
      ...allPassSyncInput,
      brokerEnforcementEnabled: false,
    });
    assert.equal(result.payloadPreview, null);
  });

  it("blocked input: skipReason is set", async () => {
    const result = await simulateTradovateRiskSettingsSync({
      ...allPassSyncInput,
      brokerEnforcementEnabled: false,
    });
    assert.ok(typeof result.skipReason === "string" && result.skipReason.length > 0);
  });

  it("allowed input: attempted=true", async () => {
    const result = await simulateTradovateRiskSettingsSync(allPassSyncInput);
    assert.equal(result.attempted, true);
  });

  it("allowed input: allowed=true", async () => {
    const result = await simulateTradovateRiskSettingsSync(allPassSyncInput);
    assert.equal(result.allowed, true);
  });

  it("allowed input: dryRun=true", async () => {
    const result = await simulateTradovateRiskSettingsSync(allPassSyncInput);
    if (!result.attempted) throw new Error("expected attempted=true");
    assert.equal(result.dryRun, true);
  });

  it("allowed input: payloadPreview is present", async () => {
    const result = await simulateTradovateRiskSettingsSync(allPassSyncInput);
    if (!result.attempted) throw new Error("expected attempted=true");
    assert.ok(result.payloadPreview !== null, "payloadPreview should not be null");
    assert.equal(typeof result.payloadPreview, "object");
  });

  it("allowed input: payloadPreview has correct dailyLossAutoLiq", async () => {
    const result = await simulateTradovateRiskSettingsSync({
      ...allPassSyncInput,
      maxDailyLoss: 400,
    });
    if (!result.attempted) throw new Error("expected attempted=true");
    assert.equal(result.payloadPreview?.dailyLossAutoLiq, 400);
  });

  it("allowed input: skipReason=null", async () => {
    const result = await simulateTradovateRiskSettingsSync(allPassSyncInput);
    if (!result.attempted) throw new Error("expected attempted=true");
    assert.equal(result.skipReason, null);
  });
});

// ── Source-level safety: simulateTradovateRiskSettingsSync never calls TradovateClient ──

describe("simulateTradovateRiskSettingsSync source scan", () => {
  it("function source does not contain 'new TradovateClient' or 'client.apply'", () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const src = readFileSync(
      join(__dirname, "tradovate-risk-settings-service.ts"),
      "utf8",
    );

    // Extract just the simulateTradovateRiskSettingsSync function body
    const fnStart = src.indexOf("export async function simulateTradovateRiskSettingsSync");
    assert.ok(fnStart !== -1, "function not found in source");

    // Find the closing brace by tracking brace depth
    let depth = 0;
    let inFn = false;
    let fnEnd = fnStart;
    for (let i = fnStart; i < src.length; i++) {
      if (src[i] === "{") {
        depth++;
        inFn = true;
      } else if (src[i] === "}") {
        depth--;
        if (inFn && depth === 0) {
          fnEnd = i;
          break;
        }
      }
    }

    const fnBody = src.slice(fnStart, fnEnd + 1);
    assert.ok(
      !fnBody.includes("new TradovateClient"),
      "simulateTradovateRiskSettingsSync must not instantiate TradovateClient",
    );
    assert.ok(
      !fnBody.includes("client.apply"),
      "simulateTradovateRiskSettingsSync must not call client.apply*",
    );
    assert.ok(
      !fnBody.includes("client.applyDailyLossLock"),
      "simulateTradovateRiskSettingsSync must not call client.applyDailyLossLock",
    );
  });
});

// ── syncDailyLossRiskSettingToTradovate ───────────────────────────────────────

describe("syncDailyLossRiskSettingToTradovate", () => {
  let savedDryRun: string | undefined;

  before(() => {
    savedDryRun = process.env.ENFORCEMENT_DRY_RUN;
  });

  after(() => {
    if (savedDryRun === undefined) {
      delete process.env.ENFORCEMENT_DRY_RUN;
    } else {
      process.env.ENFORCEMENT_DRY_RUN = savedDryRun;
    }
  });

  it("brokerEnforcementEnabled=false: synced=false, no client call", async () => {
    delete process.env.ENFORCEMENT_DRY_RUN;
    let clientCalled = false;
    const mockClient = {
      applyDailyLossLock: async () => {
        clientCalled = true;
        return { endpoint: "", payload: {}, response: null, confirmed: false, readbackValue: null };
      },
    };

    const result = await syncDailyLossRiskSettingToTradovate(
      { ...allPassSyncInput, brokerEnforcementEnabled: false },
      mockClient as never,
    );

    assert.equal(result.synced, false);
    assert.equal(clientCalled, false, "broker client must not be called when gate fails");
  });

  it("brokerEnforcementEnabled=false: returns gate-blocked skip reason", async () => {
    delete process.env.ENFORCEMENT_DRY_RUN;
    const mockClient = {
      applyDailyLossLock: async () => { throw new Error("should not be called"); },
    };

    const result = await syncDailyLossRiskSettingToTradovate(
      { ...allPassSyncInput, brokerEnforcementEnabled: false },
      mockClient as never,
    );

    assert.equal(result.synced, false);
    assert.ok(result.skipReason?.includes("BROKER_ENFORCEMENT_ENABLED"), result.skipReason ?? "");
  });

  it("ENFORCEMENT_DRY_RUN=true: synced=false, auditNote='dry_run', no client call", async () => {
    process.env.ENFORCEMENT_DRY_RUN = "true";
    let clientCalled = false;
    const mockClient = {
      applyDailyLossLock: async () => {
        clientCalled = true;
        return { endpoint: "", payload: {}, response: null, confirmed: false, readbackValue: null };
      },
    };

    const result = await syncDailyLossRiskSettingToTradovate(
      allPassSyncInput,
      mockClient as never,
    );

    assert.equal(result.synced, false);
    assert.equal(result.auditNote, "dry_run");
    assert.equal(clientCalled, false, "broker client must not be called in dry-run mode");
  });

  it("ENFORCEMENT_DRY_RUN=true: payloadPreview is populated", async () => {
    process.env.ENFORCEMENT_DRY_RUN = "true";
    const mockClient = {
      applyDailyLossLock: async () => { throw new Error("should not be called"); },
    };

    const result = await syncDailyLossRiskSettingToTradovate(
      { ...allPassSyncInput, maxDailyLoss: 250 },
      mockClient as never,
    );

    assert.equal(result.synced, false);
    assert.equal(result.auditNote, "dry_run");
    assert.ok(result.payloadPreview !== null, "payloadPreview should be present in dry-run");
    assert.equal(result.payloadPreview?.dailyLossAutoLiq, 250);
  });

  it("all gates pass + not dry run: calls client.applyDailyLossLock", async () => {
    delete process.env.ENFORCEMENT_DRY_RUN;
    let clientCalled = false;
    let capturedParams: unknown = null;
    const mockClient = {
      applyDailyLossLock: async (params: unknown) => {
        clientCalled = true;
        capturedParams = params;
        return { endpoint: "userAccountAutoLiq/update", payload: {}, response: {}, confirmed: true, readbackValue: 300 };
      },
    };

    const result = await syncDailyLossRiskSettingToTradovate(
      { ...allPassSyncInput, maxDailyLoss: 300 },
      mockClient as never,
    );

    assert.equal(result.synced, true);
    assert.equal(clientCalled, true, "broker client must be called when all gates pass");
    assert.deepEqual(capturedParams, { lossAmountToSet: 300, changesLocked: true });
  });

  it("all gates pass + not dry run: auditNote='broker_write_attempted'", async () => {
    delete process.env.ENFORCEMENT_DRY_RUN;
    const mockClient = {
      applyDailyLossLock: async () => {
        return { endpoint: "userAccountAutoLiq/update", payload: {}, response: {}, confirmed: true, readbackValue: 500 };
      },
    };

    const result = await syncDailyLossRiskSettingToTradovate(
      allPassSyncInput,
      mockClient as never,
    );

    assert.equal(result.synced, true);
    assert.equal(result.auditNote, "broker_write_attempted");
  });

  it("negative maxDailyLoss: uses absolute value when calling client", async () => {
    delete process.env.ENFORCEMENT_DRY_RUN;
    let capturedParams: unknown = null;
    const mockClient = {
      applyDailyLossLock: async (params: unknown) => {
        capturedParams = params;
        return { endpoint: "userAccountAutoLiq/update", payload: {}, response: {}, confirmed: true, readbackValue: 200 };
      },
    };

    await syncDailyLossRiskSettingToTradovate(
      { ...allPassSyncInput, maxDailyLoss: -200 },
      mockClient as never,
    );

    assert.deepEqual(capturedParams, { lossAmountToSet: 200, changesLocked: true });
  });

  it("env='live': gate blocks, no client call", async () => {
    delete process.env.ENFORCEMENT_DRY_RUN;
    let clientCalled = false;
    const mockClient = {
      applyDailyLossLock: async () => {
        clientCalled = true;
        return { endpoint: "", payload: {}, response: null, confirmed: false, readbackValue: null };
      },
    };

    const result = await syncDailyLossRiskSettingToTradovate(
      { ...allPassSyncInput, env: "live" },
      mockClient as never,
    );

    assert.equal(result.synced, false);
    assert.equal(clientCalled, false, "broker client must not be called for live env");
  });

  it("accountAllowlisted=false: synced=false, no client call", async () => {
    delete process.env.ENFORCEMENT_DRY_RUN;
    let clientCalled = false;
    const mockClient = {
      applyDailyLossLock: async () => {
        clientCalled = true;
        return { endpoint: "", payload: {}, response: null, confirmed: false, readbackValue: null };
      },
    };

    const result = await syncDailyLossRiskSettingToTradovate(
      { ...allPassSyncInput, accountAllowlisted: false },
      mockClient as never,
    );

    assert.equal(result.synced, false);
    assert.equal(clientCalled, false, "broker client must not be called when account not allowlisted");
  });

  it("accountAllowlisted=false: gateFailureReason='account_not_allowlisted'", async () => {
    delete process.env.ENFORCEMENT_DRY_RUN;
    const mockClient = {
      applyDailyLossLock: async () => { throw new Error("should not be called"); },
    };

    const result = await syncDailyLossRiskSettingToTradovate(
      { ...allPassSyncInput, accountAllowlisted: false },
      mockClient as never,
    );

    assert.equal(result.synced, false);
    assert.equal(result.auditNote, "gate_blocked");
    assert.equal(result.gateFailureReason, "account_not_allowlisted");
  });

  it("accountAllowlisted=true: passes gate 7 when all other gates pass", async () => {
    process.env.ENFORCEMENT_DRY_RUN = "true";
    const mockClient = {
      applyDailyLossLock: async () => { throw new Error("should not be called"); },
    };

    const result = await syncDailyLossRiskSettingToTradovate(
      { ...allPassSyncInput, accountAllowlisted: true },
      mockClient as never,
    );

    // With dry-run on, should reach dry_run (not gate_blocked)
    assert.equal(result.synced, false);
    assert.equal(result.auditNote, "dry_run");
  });

  it("guardianEnabled=false: synced=false, no client call", async () => {
    delete process.env.ENFORCEMENT_DRY_RUN;
    let clientCalled = false;
    const mockClient = {
      applyDailyLossLock: async () => {
        clientCalled = true;
        return { endpoint: "", payload: {}, response: null, confirmed: false, readbackValue: null };
      },
    };

    const result = await syncDailyLossRiskSettingToTradovate(
      { ...allPassSyncInput, guardianEnabled: false },
      mockClient as never,
    );

    assert.equal(result.synced, false);
    assert.equal(clientCalled, false, "broker client must not be called when guardian inactive");
  });

  it("guardianEnabled=false: gateFailureReason='guardian_inactive'", async () => {
    delete process.env.ENFORCEMENT_DRY_RUN;
    const mockClient = {
      applyDailyLossLock: async () => { throw new Error("should not be called"); },
    };

    const result = await syncDailyLossRiskSettingToTradovate(
      { ...allPassSyncInput, guardianEnabled: false },
      mockClient as never,
    );

    assert.equal(result.synced, false);
    assert.equal(result.auditNote, "gate_blocked");
    assert.equal(result.gateFailureReason, "guardian_inactive");
  });

  it("guardianEnabled=true: passes gate 8 when all other gates pass", async () => {
    process.env.ENFORCEMENT_DRY_RUN = "true";
    const mockClient = {
      applyDailyLossLock: async () => { throw new Error("should not be called"); },
    };

    const result = await syncDailyLossRiskSettingToTradovate(
      { ...allPassSyncInput, guardianEnabled: true },
      mockClient as never,
    );

    // With dry-run on, should reach dry_run (not gate_blocked)
    assert.equal(result.synced, false);
    assert.equal(result.auditNote, "dry_run");
  });

  it("both accountAllowlisted=false and guardianEnabled=false: gate 7 blocks first", async () => {
    delete process.env.ENFORCEMENT_DRY_RUN;
    const mockClient = {
      applyDailyLossLock: async () => { throw new Error("should not be called"); },
    };

    const result = await syncDailyLossRiskSettingToTradovate(
      { ...allPassSyncInput, accountAllowlisted: false, guardianEnabled: false },
      mockClient as never,
    );

    assert.equal(result.synced, false);
    assert.equal(result.gateFailureReason, "account_not_allowlisted");
  });
});
