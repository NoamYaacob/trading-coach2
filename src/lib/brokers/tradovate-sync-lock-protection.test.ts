/**
 * Source-scan contract tests for manual lockout persistence across sync.
 *
 * Priority 1 fix: Tradovate sync must not downgrade riskState from STOPPED
 * to NORMAL while an active InternalLockEvent exists (clearedAt=null,
 * activeDedupKey!=null).
 *
 * These tests read source files to verify the invariants hold structurally,
 * without requiring a live database.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd(), "src");
function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

const sync = read("lib/brokers/tradovate-sync.ts");
const lockoutHelpers = read("app/api/accounts/[id]/lockout/lockout-helpers.ts");
const lockoutRoute = read("app/api/accounts/[id]/lockout/route.ts");
const commandCenterData = read("app/dashboard/_components/command-center/data.ts");
const dataHelpers = read("app/dashboard/_components/command-center/data-helpers.ts");

describe("Priority 1 — manual lock creates riskState=STOPPED", () => {
  it("lockout plan sets riskState STOPPED on liveSessionState upsert", () => {
    assert.ok(
      lockoutHelpers.includes('riskState: "STOPPED"'),
      "buildManualLockoutPlan must set riskState: STOPPED on the LiveSessionState payload",
    );
  });

  it("lockout route upserts liveSessionState and internalLockEvent atomically", () => {
    assert.ok(
      lockoutRoute.includes("liveSessionState.upsert"),
      "route must upsert LiveSessionState",
    );
    assert.ok(
      lockoutRoute.includes("internalLockEvent.upsert"),
      "route must upsert InternalLockEvent",
    );
    assert.ok(
      lockoutRoute.includes("prisma.$transaction"),
      "both upserts must be in a single transaction",
    );
  });

  it("lockout plan writes clearedAt=null activeDedupKey — marks the lock as active", () => {
    assert.ok(
      lockoutHelpers.includes("activeDedupKey"),
      "plan must include activeDedupKey so the lock is recognised as active (clearedAt=null + activeDedupKey!=null)",
    );
  });
});

describe("Priority 1 — sync cannot downgrade STOPPED while active InternalLockEvent exists", () => {
  it("sync checks for active InternalLockEvent before writing riskState", () => {
    assert.ok(
      sync.includes("internalLockEvent.count"),
      "sync must query InternalLockEvent count before persisting riskState",
    );
    assert.ok(
      sync.includes("clearedAt: null") && sync.includes("activeDedupKey: { not: null }"),
      "sync must filter for clearedAt=null AND activeDedupKey!=null to detect active locks",
    );
  });

  it("sync overrides newRiskState to STOPPED via the pure shouldHoldRiskStateStopped helper", () => {
    assert.ok(
      sync.includes("shouldHoldRiskStateStopped"),
      "sync must route the hold decision through the pure, tested shouldHoldRiskStateStopped helper",
    );
    assert.ok(
      sync.includes('newRiskState = "STOPPED"'),
      "sync must force riskState=STOPPED when the helper returns true",
    );
  });

  it("sync imports shouldHoldRiskStateStopped from the internal-lock-evaluator", () => {
    assert.ok(
      sync.includes('shouldHoldRiskStateStopped } from "../guardian-engine/internal-lock-evaluator"') ||
        /import\s*\{[^}]*shouldHoldRiskStateStopped[^}]*\}\s*from\s*["']\.\.\/guardian-engine\/internal-lock-evaluator["']/.test(sync),
      "sync must import shouldHoldRiskStateStopped from the guardian-engine internal-lock-evaluator",
    );
  });

  it("sync skips the active-lock DB query when the session has rolled over (isStale)", () => {
    // isStale means the session rolled over — old locks are cleared by the
    // session-end cleanup block. Querying/holding when isStale would re-lock
    // an account that should be reset for the new session.
    assert.ok(
      sync.includes("!isStale && newRiskState"),
      "active-lock query must be gated on !isStale to allow session-rollover resets",
    );
    assert.ok(
      sync.includes("isStale,") || sync.includes("isStale\n"),
      "isStale must be passed into shouldHoldRiskStateStopped so the helper can skip the hold on rollover",
    );
  });

  it("session-end cleanup clears active locks by setting clearedAt + activeDedupKey=null", () => {
    assert.ok(
      sync.includes("clearedBy: \"session_end\"") &&
        sync.includes("activeDedupKey: null"),
      "CME session-end cleanup must set clearedAt + activeDedupKey=null to release the lock slot",
    );
  });

  it("session-end cleanup is gated on isStale (only runs on rollover)", () => {
    assert.ok(
      sync.includes("if (isStale)"),
      "InternalLockEvent cleanup must only run when isStale=true (CME session rollover)",
    );
  });
});

describe("Priority 1 — dashboard shows locked state and hides Lockout button", () => {
  it("dashboard loads internalLockEvents where clearedAt=null", () => {
    assert.ok(
      commandCenterData.includes("internalLockEvents") &&
        commandCenterData.includes("clearedAt: null"),
      "dashboard data loader must fetch active InternalLockEvent rows (clearedAt=null)",
    );
  });

  it("deriveStatus returns 'locked' for riskState=STOPPED", () => {
    assert.ok(
      dataHelpers.includes('riskState === "STOPPED"') &&
        dataHelpers.includes('"locked"'),
      "deriveStatus must return 'locked' when riskState=STOPPED",
    );
  });

  it("Lockout button is only shown for allowed/warning accounts — hidden when locked", () => {
    const dashboardPage = read("app/dashboard/page.tsx");
    assert.ok(
      dashboardPage.includes('acc.status === "allowed" || acc.status === "warning"') &&
        dashboardPage.includes("AccountLockoutButton"),
      "AccountLockoutButton must only render for allowed/warning status — locked accounts do not show it",
    );
    // When riskState=STOPPED, status becomes 'locked' and the button is hidden.
    assert.ok(
      !dashboardPage.includes('acc.status === "locked"') ||
        !dashboardPage.match(/acc\.status === "locked"[^{]*AccountLockoutButton/s),
      "locked accounts must not receive the AccountLockoutButton",
    );
  });
});

describe("Priority 1 — lock is per-account only", () => {
  it("InternalLockEvent query is scoped to accountId — no cross-account leakage", () => {
    assert.ok(
      sync.includes("where: { accountId, clearedAt: null"),
      "active-lock check must scope InternalLockEvent to the specific accountId",
    );
  });

  it("lockout plan embeds accountId in activeDedupKey — keys are per-account", () => {
    // buildInternalLockDedupKey format: `${accountId}:${ruleType}:${tradingDay}:internal_lock`
    assert.ok(
      lockoutHelpers.includes("buildInternalLockDedupKey") &&
        lockoutHelpers.includes("input.accountId"),
      "dedup key must incorporate accountId so locks are per-account",
    );
  });
});
