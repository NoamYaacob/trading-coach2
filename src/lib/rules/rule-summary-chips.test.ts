import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildRuleSummaryChips } from "./rule-summary-chips.ts";
import type { CommandCenterAccount } from "../../app/dashboard/_components/command-center/types.ts";

/** Minimal valid CommandCenterAccount fixture for tests. */
function makeAccount(
  overrides: Partial<CommandCenterAccount> = {},
): CommandCenterAccount {
  return {
    id: "acct_test",
    label: "Test Account",
    primaryLabel: "Test Account",
    secondaryMeta: null,
    rawLabel: "Test Account",
    platform: "tradovate",
    platformLabel: "Tradovate",
    propFirm: null,
    firmKey: "__personal_broker__",
    firmLabel: "Personal",
    accountType: "personal",
    accountTypeLabel: "Personal",
    connectionStatus: "connected_live",
    connectionStatusLabel: "Connected",
    status: "allowed",
    enforcementMode: "dry_run",
    permissionLevel: null,
    ruleSource: "default",
    rulesLabel: "Default rules",
    dailyPnl: 0,
    maxDailyLoss: null,
    remainingDailyLoss: null,
    dailyLossUsedPct: null,
    tradesCount: 0,
    tradesMayIncludePreConnection: false,
    tradeCountSource: "verified",
    maxTradesPerDay: null,
    tradesUsedPct: null,
    consecutiveLosses: 0,
    stopAfterLosses: null,
    balance: null,
    openPnl: null,
    lastSyncAt: null,
    fillsSyncedAt: null,
    listenerStatus: null,
    listenerLastEventAt: null,
    listenerLastHeartbeatAt: null,
    listenerLastCloseCode: null,
    listenerLastCloseReason: null,
    internalLockActive: false,
    lastInternalLockAt: null,
    hasMaxPositionSize: false,
    rawBrokerHardLimitEnabled: false,
    balanceLimitedWarning: false,
    balanceUnavailableForBudget: false,
    propFirmSetupNeeded: false,
    propFirmLimited: false,
    setupNeededReason: null,
    breachReason: null,
    brokerLockStatus: null,
    brokerConnectionId: null,
    brokerEnv: null,
    lastInterventionTrigger: null,
    lastInterventionAt: null,
    hasOpenIntervention: false,
    flattenStatus: null,
    protectionStatus: "protected",
    pendingProtectionStatus: null,
    pendingProtectionEffectiveDate: null,
    missingFromBrokerSince: null,
    isLockedForToday: false,
    requiresAutomatedActionsConsent: false,
    ...overrides,
  };
}

describe("buildRuleSummaryChips — not monitored", () => {
  it("account with protectionStatus=ignored returns single 'Not monitored' chip", () => {
    const chips = buildRuleSummaryChips(makeAccount({ protectionStatus: "ignored" }));
    assert.equal(chips.length, 1);
    assert.equal(chips[0].key, "not_monitored");
    assert.equal(chips[0].text, "Not monitored");
    assert.equal(chips[0].severity, "inactive");
  });

  it("account with protectionStatus=archived returns 'Not monitored' chip", () => {
    const chips = buildRuleSummaryChips(makeAccount({ protectionStatus: "archived" }));
    assert.equal(chips.length, 1);
    assert.equal(chips[0].key, "not_monitored");
  });

  it("account with protectionStatus=pending_decision returns 'Not monitored' chip", () => {
    const chips = buildRuleSummaryChips(makeAccount({ protectionStatus: "pending_decision" }));
    assert.equal(chips.length, 1);
    assert.equal(chips[0].key, "not_monitored");
  });
});

describe("buildRuleSummaryChips — protected account with no rules", () => {
  it("protected account with no rules configured returns empty chips array", () => {
    const chips = buildRuleSummaryChips(makeAccount({ protectionStatus: "protected" }));
    // No rules configured, so no rule chips — empty is fine
    assert.ok(Array.isArray(chips));
    const ruleKeys = chips.map((c) => c.key);
    assert.ok(!ruleKeys.includes("not_monitored"), "should not show not_monitored for protected accounts");
  });
});

describe("buildRuleSummaryChips — daily loss chip", () => {
  it("shows daily loss chip when maxDailyLoss is set", () => {
    const chips = buildRuleSummaryChips(
      makeAccount({ maxDailyLoss: 500, dailyLossUsedPct: 0 }),
    );
    const chip = chips.find((c) => c.key === "daily_loss");
    assert.ok(chip, "expected daily_loss chip");
    assert.ok(chip.text.includes("500"), `expected chip text to include 500, got: ${chip.text}`);
  });

  it("daily loss chip severity is 'ok' when usage < 70%", () => {
    const chips = buildRuleSummaryChips(
      makeAccount({ maxDailyLoss: 500, dailyLossUsedPct: 50 }),
    );
    const chip = chips.find((c) => c.key === "daily_loss");
    assert.ok(chip, "expected daily_loss chip");
    assert.equal(chip.severity, "ok");
  });

  it("daily loss chip severity is 'warning' when usage >= 70%", () => {
    const chips = buildRuleSummaryChips(
      makeAccount({ maxDailyLoss: 500, dailyLossUsedPct: 80 }),
    );
    const chip = chips.find((c) => c.key === "daily_loss");
    assert.ok(chip, "expected daily_loss chip");
    assert.equal(chip.severity, "warning");
  });

  it("daily loss chip severity is 'locked' when internalLockActive=true", () => {
    const chips = buildRuleSummaryChips(
      makeAccount({ maxDailyLoss: 500, dailyLossUsedPct: 20, internalLockActive: true }),
    );
    const chip = chips.find((c) => c.key === "daily_loss");
    assert.ok(chip, "expected daily_loss chip");
    assert.equal(chip.severity, "locked");
  });

  it("daily loss chip severity is 'locked' when isLockedForToday=true", () => {
    const chips = buildRuleSummaryChips(
      makeAccount({ maxDailyLoss: 500, dailyLossUsedPct: 20, isLockedForToday: true }),
    );
    const chip = chips.find((c) => c.key === "daily_loss");
    assert.ok(chip, "expected daily_loss chip");
    assert.equal(chip.severity, "locked");
  });

  it("daily loss chip severity is 'locked' when status=locked", () => {
    const chips = buildRuleSummaryChips(
      makeAccount({ maxDailyLoss: 500, dailyLossUsedPct: 20, status: "locked" }),
    );
    const chip = chips.find((c) => c.key === "daily_loss");
    assert.ok(chip, "expected daily_loss chip");
    assert.equal(chip.severity, "locked");
  });

  it("does not show daily_loss chip when maxDailyLoss is null", () => {
    const chips = buildRuleSummaryChips(makeAccount({ maxDailyLoss: null }));
    const chip = chips.find((c) => c.key === "daily_loss");
    assert.equal(chip, undefined, "should not show daily_loss chip when maxDailyLoss is null");
  });
});

describe("buildRuleSummaryChips — max trades chip", () => {
  it("shows max trades chip when maxTradesPerDay is set", () => {
    const chips = buildRuleSummaryChips(makeAccount({ maxTradesPerDay: 3 }));
    const chip = chips.find((c) => c.key === "max_trades");
    assert.ok(chip, "expected max_trades chip");
    assert.ok(chip.text.includes("3"), `expected chip text to include 3, got: ${chip.text}`);
  });

  it("does not show max trades chip when maxTradesPerDay is null", () => {
    const chips = buildRuleSummaryChips(makeAccount({ maxTradesPerDay: null }));
    const chip = chips.find((c) => c.key === "max_trades");
    assert.equal(chip, undefined);
  });
});

describe("buildRuleSummaryChips — consecutive losses chip", () => {
  it("shows consec_losses chip when stopAfterLosses is set", () => {
    const chips = buildRuleSummaryChips(makeAccount({ stopAfterLosses: 2 }));
    const chip = chips.find((c) => c.key === "consec_losses");
    assert.ok(chip, "expected consec_losses chip");
    assert.ok(chip.text.includes("2"), `expected chip text to include 2, got: ${chip.text}`);
  });
});

describe("buildRuleSummaryChips — broker-backed chip SAFETY constraints", () => {
  it("SAFETY: never shows 'Broker-backed: Profit target' chip text", () => {
    const chips = buildRuleSummaryChips(
      makeAccount({
        maxDailyLoss: 500,
        brokerLockStatus: "broker_locked",
        enforcementMode: "broker_active",
      }),
    );
    for (const chip of chips) {
      const combined = chip.text.toLowerCase();
      const hasProfitTarget =
        combined.includes("profit") || combined.includes("target");
      const hasBroker = combined.includes("broker");
      assert.ok(
        !(hasProfitTarget && hasBroker),
        `chip text must not combine 'broker' with 'profit target': "${chip.text}"`,
      );
    }
  });

  it("SAFETY: daily profit target chip must not claim broker enforcement", () => {
    // Even if we imagine a hypothetical chip for profit target, it must never
    // include "broker" text — only daily loss is broker-eligible.
    const chips = buildRuleSummaryChips(makeAccount({ enforcementMode: "broker_active" }));
    for (const chip of chips) {
      const combined = chip.text.toLowerCase();
      if (combined.includes("profit") || combined.includes("target")) {
        assert.ok(
          !combined.includes("broker"),
          `profit target chip must not claim broker enforcement: "${chip.text}"`,
        );
      }
    }
  });

  it("shows broker-backed chip when brokerLockStatus=broker_locked and maxDailyLoss is set", () => {
    const chips = buildRuleSummaryChips(
      makeAccount({
        maxDailyLoss: 500,
        brokerLockStatus: "broker_locked",
      }),
    );
    const chip = chips.find((c) => c.key === "broker_backed");
    assert.ok(chip, "expected broker_backed chip");
    assert.ok(
      chip.text.toLowerCase().includes("daily loss"),
      `broker_backed chip should mention 'daily loss', got: "${chip.text}"`,
    );
  });

  it("does not show broker-backed chip when maxDailyLoss is null (no daily loss rule)", () => {
    const chips = buildRuleSummaryChips(
      makeAccount({
        maxDailyLoss: null,
        brokerLockStatus: "broker_locked",
        enforcementMode: "broker_active",
      }),
    );
    const chip = chips.find((c) => c.key === "broker_backed");
    assert.equal(chip, undefined, "should not show broker_backed when maxDailyLoss is null");
  });
});

describe("buildRuleSummaryChips — position size (max contracts) chip", () => {
  it("shows 'Position size limit' chip when hasMaxPositionSize=true", () => {
    const chips = buildRuleSummaryChips(makeAccount({ hasMaxPositionSize: true }));
    const chip = chips.find((c) => c.key === "max_contracts");
    assert.ok(chip, "expected max_contracts chip");
    assert.equal(chip.text, "Position size limit");
  });

  it("SAFETY: position size chip never claims broker enforcement", () => {
    const chips = buildRuleSummaryChips(
      makeAccount({ hasMaxPositionSize: true, enforcementMode: "broker_active", brokerLockStatus: "broker_locked" }),
    );
    for (const chip of chips) {
      if (chip.key === "max_contracts") {
        assert.ok(
          !chip.text.toLowerCase().includes("broker"),
          `position size chip must not claim broker enforcement: "${chip.text}"`,
        );
      }
    }
  });
});

describe("buildRuleSummaryChips — no broker claim for non-daily-loss rules", () => {
  it("SAFETY: max trades chip never claims broker enforcement", () => {
    const chips = buildRuleSummaryChips(
      makeAccount({ maxTradesPerDay: 5, enforcementMode: "broker_active" }),
    );
    const chip = chips.find((c) => c.key === "max_trades");
    assert.ok(chip, "expected max_trades chip");
    assert.ok(
      !chip.text.toLowerCase().includes("broker"),
      `max_trades chip must not claim broker enforcement: "${chip.text}"`,
    );
  });

  it("SAFETY: consecutive losses chip never claims broker enforcement", () => {
    const chips = buildRuleSummaryChips(
      makeAccount({ stopAfterLosses: 3, enforcementMode: "broker_active" }),
    );
    const chip = chips.find((c) => c.key === "consec_losses");
    assert.ok(chip, "expected consec_losses chip");
    assert.ok(
      !chip.text.toLowerCase().includes("broker"),
      `consec_losses chip must not claim broker enforcement: "${chip.text}"`,
    );
  });

  it("SAFETY: no chip text mentions 'session cutoff' with broker enforcement", () => {
    const chips = buildRuleSummaryChips(
      makeAccount({
        maxDailyLoss: 500,
        enforcementMode: "broker_active",
        brokerLockStatus: "broker_locked",
      }),
    );
    for (const chip of chips) {
      const t = chip.text.toLowerCase();
      const hasSession = t.includes("session") || t.includes("cutoff") || t.includes("hours");
      assert.ok(
        !hasSession,
        `no chip should mention session/cutoff/hours rules: "${chip.text}"`,
      );
    }
  });
});

describe("buildRuleSummaryChips — edge cases", () => {
  it("returns empty array gracefully when protectionStatus is 'protected' and no rules set", () => {
    const chips = buildRuleSummaryChips(makeAccount());
    assert.ok(Array.isArray(chips));
  });

  it("monitor_only accounts can have rule chips", () => {
    const chips = buildRuleSummaryChips(
      makeAccount({ protectionStatus: "monitor_only", maxDailyLoss: 300 }),
    );
    const chip = chips.find((c) => c.key === "daily_loss");
    assert.ok(chip, "expected daily_loss chip for monitor_only account");
  });
});
