/**
 * Contract tests for the broker account removal safety system.
 *
 * Source-scan approach — no database required. All assertions verify that
 * critical invariants are encoded in the source files themselves.
 */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  decideRemovalEligibility,
  type RemovalDecisionInput,
} from "../../lib/account-removal-eligibility.ts";

function read(rel: string): string {
  return readFileSync(resolve(import.meta.dirname, rel), "utf8");
}

function readLib(rel: string): string {
  return readFileSync(resolve(import.meta.dirname, "../../lib", rel), "utf8");
}

function readApi(rel: string): string {
  return readFileSync(resolve(import.meta.dirname, "../../app/api", rel), "utf8");
}

// ── account-removal-guard.ts ──────────────────────────────────────────────────

describe("account-removal-guard checks all lock sources", () => {
  // The lock-decision logic lives in account-removal-eligibility.ts (pure,
  // prisma-free), while the DB reads live in account-removal-guard.ts. Content
  // checks that assert decision logic read both files; DB-query-structure
  // checks read only the guard.
  const combined = () =>
    readLib("account-removal-guard.ts") + "\n" + readLib("account-removal-eligibility.ts");

  test("guard checks LiveSessionState.riskState === STOPPED for today", () => {
    const src = combined();
    assert.ok(
      src.includes("STOPPED"),
      "decision must check LiveSessionState.riskState === STOPPED",
    );
    assert.ok(
      src.includes("riskState"),
      "decision/guard must read riskState from LiveSessionState",
    );
  });

  test("guard checks LiveSessionState.cooldownActive", () => {
    const src = combined();
    assert.ok(
      src.includes("cooldownActive"),
      "decision must check cooldownActive flag on session state",
    );
  });

  test("guard only uses today's session state (sessionDate check)", () => {
    const src = combined();
    assert.ok(
      src.includes("sessionDate") && src.includes("todayKey"),
      "decision must compare sessionDate to todayKey so stale session state is ignored",
    );
  });

  test("guard checks InternalLockEvent with clearedAt null", () => {
    const src = readLib("account-removal-guard.ts");
    assert.ok(
      src.includes("internalLockEvent"),
      "guard must query internalLockEvent table",
    );
    assert.ok(
      src.includes("clearedAt: null"),
      "guard must filter for active locks (clearedAt null)",
    );
  });

  test("guard does NOT restrict the active-lock query by tradingDay", () => {
    const src = readLib("account-removal-guard.ts");
    // The active InternalLockEvent query must match on clearedAt IS NULL alone,
    // not tradingDay — otherwise an uncleared lock stops blocking removal once
    // the CT calendar day rolls past the lock's CME session day.
    const lockQueryMatch = src.match(
      /internalLockEvent\.findFirst\(\{\s*where:\s*\{([^}]*)\}/,
    );
    assert.ok(lockQueryMatch, "guard must call internalLockEvent.findFirst with a where clause");
    const whereClause = lockQueryMatch![1];
    assert.ok(
      whereClause.includes("clearedAt: null"),
      "active-lock query must filter on clearedAt: null",
    );
    assert.ok(
      !whereClause.includes("tradingDay"),
      "active-lock query must NOT filter by tradingDay — clearedAt: null is the authoritative active signal",
    );
  });

  test("guard uses per-account lock signals only (not per-user aggregate)", () => {
    const src = readLib("account-removal-guard.ts");
    // GuardianStatus is per-user (userId @unique) — using it would incorrectly
    // block removal of clean accounts when a different account is locked.
    // The guard must not query GuardianStatus.
    assert.ok(
      !src.includes("guardianStatus.findFirst") && !src.includes("guardianStatus.findUnique"),
      "guard must not query GuardianStatus (per-user model — would block unrelated accounts)",
    );
    // LiveSessionState and InternalLockEvent are per-account — these are correct.
    assert.ok(
      src.includes("liveSessionState.findUnique"),
      "guard must use liveSessionState.findUnique (per-account)",
    );
    assert.ok(
      src.includes("internalLockEvent.findFirst"),
      "guard must use internalLockEvent.findFirst (per-account)",
    );
  });

  test("guard bypasses all checks for unavailable accounts (missingFromBrokerSince set)", () => {
    const src = combined();
    assert.ok(
      src.includes("missingFromBrokerSince"),
      "decision must check missingFromBrokerSince as a bypass condition",
    );
    assert.ok(
      src.includes("canRemoveNow: true") && src.includes("missingFromBrokerSince"),
      "decision must return canRemoveNow: true for accounts missing from broker",
    );
    assert.ok(
      src.includes("missingFromBrokerSince != null"),
      "decision must check missingFromBrokerSince != null for the bypass",
    );
  });

  test("guard bypasses all checks for ignored/archived accounts", () => {
    const src = combined();
    assert.ok(
      src.includes('"ignored"') && src.includes('"archived"'),
      "decision must bypass checks for ignored and archived accounts",
    );
  });

  test("guard validates userId === userId param (ownership check)", () => {
    const src = readLib("account-removal-guard.ts");
    assert.ok(
      src.includes("userId"),
      "guard must include userId in the account lookup to enforce ownership",
    );
  });

  test("guard returns canRemoveNow, lockReason, nextTradingDay shape", () => {
    const src = combined();
    assert.ok(src.includes("canRemoveNow"), "decision must return canRemoveNow");
    assert.ok(src.includes("lockReason"), "decision must return lockReason");
    assert.ok(src.includes("nextTradingDay"), "decision must return nextTradingDay");
  });
});

// ── decideRemovalEligibility — pure behavioral matrix ─────────────────────────
//
// Behavioral tests for the pure decision function (no DB). These exercise the
// real branch logic, including the CME-session / CT-calendar day-boundary fix:
// an active InternalLockEvent (clearedAt IS NULL) must defer removal even when
// its tradingDay no longer matches today's CT calendar key.

describe("decideRemovalEligibility — active internal lock across day boundary", () => {
  // Base input: a clean, present account with no session lock and no active lock.
  // The day-boundary scenario from production: CT calendar day = 2026-06-01,
  // CME session lock belongs to tradingDay 2026-05-31.
  function baseInput(): RemovalDecisionInput {
    return {
      accountFound: true,
      missingFromBrokerSince: null,
      protectionStatus: "protected",
      sessionDate: "2026-05-31", // stale relative to todayKey → session check skipped
      todayKey: "2026-06-01",
      riskState: "STOPPED",
      cooldownActive: false,
      activeInternalLock: null,
      nextTradingDay: "2026-06-02",
    };
  }

  test("active InternalLockEvent (clearedAt null) blocks removal even when tradingDay != CT calendar day", () => {
    const input = baseInput();
    // The active lock is present (the DB query no longer filters by tradingDay,
    // so this represents the 2026-05-31 lock surfacing on the 2026-06-01 CT day).
    input.activeInternalLock = { ruleType: "daily_loss_limit" };
    const result = decideRemovalEligibility(input);
    assert.equal(result.canRemoveNow, false, "must defer removal while an active lock exists");
    assert.equal(result.lockReason, "internal_lock:daily_loss_limit");
    assert.equal(result.nextTradingDay, "2026-06-02");
  });

  test("cleared InternalLockEvent (passed as null active lock) does not block", () => {
    const input = baseInput();
    // A cleared lock is excluded by the clearedAt: null query, so the decision
    // function receives activeInternalLock = null.
    input.activeInternalLock = null;
    const result = decideRemovalEligibility(input);
    assert.equal(result.canRemoveNow, true, "cleared lock must not block removal");
    assert.equal(result.lockReason, null);
  });

  test("STOPPED same-day session still blocks (session_stopped) regardless of lock", () => {
    const input = baseInput();
    input.sessionDate = "2026-06-01"; // matches todayKey → session check active
    input.riskState = "STOPPED";
    input.activeInternalLock = null;
    const result = decideRemovalEligibility(input);
    assert.equal(result.canRemoveNow, false);
    assert.equal(result.lockReason, "session_stopped");
  });

  test("cooldown same-day session still blocks (cooldown_active)", () => {
    const input = baseInput();
    input.sessionDate = "2026-06-01";
    input.riskState = "NORMAL";
    input.cooldownActive = true;
    input.activeInternalLock = null;
    const result = decideRemovalEligibility(input);
    assert.equal(result.canRemoveNow, false);
    assert.equal(result.lockReason, "cooldown_active");
  });

  test("clean account with no locks can be removed now", () => {
    const input = baseInput();
    input.sessionDate = "2026-06-01";
    input.riskState = "NORMAL";
    input.cooldownActive = false;
    input.activeInternalLock = null;
    const result = decideRemovalEligibility(input);
    assert.equal(result.canRemoveNow, true);
    assert.equal(result.lockReason, null);
  });

  test("bypass: missingFromBrokerSince set → removable even with an active lock", () => {
    const input = baseInput();
    input.missingFromBrokerSince = new Date("2026-05-30T00:00:00Z");
    input.activeInternalLock = { ruleType: "daily_loss_limit" };
    const result = decideRemovalEligibility(input);
    assert.equal(result.canRemoveNow, true, "missing-from-broker bypass takes precedence");
    assert.equal(result.lockReason, null);
  });

  test("bypass: protectionStatus archived/ignored → removable even with an active lock", () => {
    for (const status of ["archived", "ignored"]) {
      const input = baseInput();
      input.protectionStatus = status;
      input.activeInternalLock = { ruleType: "daily_loss_limit" };
      const result = decideRemovalEligibility(input);
      assert.equal(result.canRemoveNow, true, `${status} bypass must allow removal`);
      assert.equal(result.lockReason, null);
    }
  });

  test("account not found → not removable (account_not_found)", () => {
    const input = baseInput();
    input.accountFound = false;
    const result = decideRemovalEligibility(input);
    assert.equal(result.canRemoveNow, false);
    assert.equal(result.lockReason, "account_not_found");
  });

  test("non-daily-loss active lock also blocks with its ruleType", () => {
    const input = baseInput();
    input.activeInternalLock = { ruleType: "max_position_size" };
    const result = decideRemovalEligibility(input);
    assert.equal(result.canRemoveNow, false);
    assert.equal(result.lockReason, "internal_lock:max_position_size");
  });
});

// ── archive protection route ──────────────────────────────────────────────────

describe("archive API applies removal guard before archiving", () => {
  test("protection route imports and calls checkAccountRemovalEligibility", () => {
    const src = readApi("accounts/[id]/protection/route.ts");
    assert.ok(
      src.includes("checkAccountRemovalEligibility"),
      "protection route must import and call checkAccountRemovalEligibility",
    );
    assert.ok(
      src.includes("from \"@/lib/account-removal-guard\"") ||
        src.includes("account-removal-guard"),
      "protection route must import from account-removal-guard",
    );
  });

  test("archive path defers via pendingProtectionStatus when locked", () => {
    const src = readApi("accounts/[id]/protection/route.ts");
    assert.ok(
      src.includes("pendingProtectionStatus") && src.includes('"archived"'),
      "archive path must set pendingProtectionStatus to 'archived' when locked",
    );
    assert.ok(
      src.includes("pendingProtectionEffectiveDate"),
      "archive path must set pendingProtectionEffectiveDate when deferring",
    );
  });

  test("archive deferred response includes rule_breach_or_lock reason", () => {
    const src = readApi("accounts/[id]/protection/route.ts");
    assert.ok(
      src.includes("rule_breach_or_lock"),
      "archive deferred response must have reason=rule_breach_or_lock",
    );
  });

  test("archive deferral message warns about next session reset", () => {
    const src = readApi("accounts/[id]/protection/route.ts");
    assert.ok(
      src.includes("next trading session reset"),
      "deferred archive message must mention 'next trading session reset'",
    );
  });

  test("archive does NOT delete NormalizedTradeEvent", () => {
    const src = readApi("accounts/[id]/protection/route.ts");
    assert.ok(
      !src.includes("normalizedTradeEvent.delete"),
      "archive route must not delete NormalizedTradeEvent rows",
    );
    assert.ok(
      !src.includes("tradeEvent.delete"),
      "archive route must not delete trade event rows",
    );
  });

  test("archive does NOT delete AccountRiskRules", () => {
    const src = readApi("accounts/[id]/protection/route.ts");
    assert.ok(
      !src.includes("accountRiskRule.delete"),
      "archive route must not delete AccountRiskRules rows",
    );
  });

  test("archive does NOT delete InternalLockEvent", () => {
    const src = readApi("accounts/[id]/protection/route.ts");
    assert.ok(
      !src.includes("internalLockEvent.delete"),
      "archive route must not delete InternalLockEvent rows",
    );
  });

  test("archive route validates userId ownership", () => {
    const src = readApi("accounts/[id]/protection/route.ts");
    assert.ok(
      src.includes("userId: user.id"),
      "archive route must validate that the account belongs to the requesting user",
    );
  });
});

// ── broker connection disconnect route ────────────────────────────────────────

describe("broker connection disconnect handles mixed accounts correctly", () => {
  test("disconnect endpoint exists and uses POST method", () => {
    const src = readApi("broker-connections/[id]/disconnect/route.ts");
    assert.ok(
      src.includes("export async function POST"),
      "disconnect route must export POST handler",
    );
  });

  test("disconnect endpoint validates user ownership via userId", () => {
    const src = readApi("broker-connections/[id]/disconnect/route.ts");
    assert.ok(
      src.includes("userId: currentUser.id"),
      "disconnect route must include userId in the connection lookup",
    );
  });

  test("disconnect endpoint iterates all linked accounts", () => {
    const src = readApi("broker-connections/[id]/disconnect/route.ts");
    assert.ok(
      src.includes("brokerConnectionId: id") || src.includes("linkedAccounts"),
      "disconnect route must load and iterate linked accounts",
    );
    assert.ok(
      src.includes("for (const acct of"),
      "disconnect route must loop over accounts",
    );
  });

  test("disconnect endpoint calls checkAccountRemovalEligibility per account", () => {
    const src = readApi("broker-connections/[id]/disconnect/route.ts");
    assert.ok(
      src.includes("checkAccountRemovalEligibility"),
      "disconnect route must call checkAccountRemovalEligibility for each account",
    );
  });

  test("disconnect endpoint archives clean accounts immediately", () => {
    const src = readApi("broker-connections/[id]/disconnect/route.ts");
    assert.ok(
      src.includes("archived_now"),
      "disconnect route must produce archived_now result for clean accounts",
    );
  });

  test("disconnect endpoint schedules locked accounts via pendingProtectionStatus", () => {
    const src = readApi("broker-connections/[id]/disconnect/route.ts");
    assert.ok(
      src.includes("pendingProtectionStatus"),
      "disconnect route must set pendingProtectionStatus for locked accounts",
    );
    assert.ok(
      src.includes("scheduled"),
      "disconnect route must produce scheduled result for locked accounts",
    );
  });

  test("disconnect endpoint returns structured result", () => {
    const src = readApi("broker-connections/[id]/disconnect/route.ts");
    assert.ok(src.includes('"removed_now"'), "result must include removed_now status");
    assert.ok(src.includes('"partial"'), "result must include partial status");
    assert.ok(src.includes("affectedAccounts"), "result must include affectedAccounts array");
    assert.ok(src.includes("connectionDeleted"), "result must indicate whether connection was deleted");
    assert.ok(src.includes("effectiveAt"), "result must include effectiveAt for scheduled removals");
  });

  test("disconnect only deletes connection when no active accounts remain", () => {
    const src = readApi("broker-connections/[id]/disconnect/route.ts");
    assert.ok(
      src.includes("remainingActive === 0"),
      "disconnect must only delete the connection when remainingActive === 0",
    );
  });

  test("disconnect does NOT delete NormalizedTradeEvent", () => {
    const src = readApi("broker-connections/[id]/disconnect/route.ts");
    assert.ok(
      !src.includes("normalizedTradeEvent.delete"),
      "disconnect route must not delete NormalizedTradeEvent rows",
    );
  });

  test("disconnect does NOT delete AccountRiskRules", () => {
    const src = readApi("broker-connections/[id]/disconnect/route.ts");
    assert.ok(
      !src.includes("accountRiskRule.delete"),
      "disconnect route must not delete AccountRiskRules rows",
    );
  });

  test("disconnect does NOT delete GuardianStatus history", () => {
    const src = readApi("broker-connections/[id]/disconnect/route.ts");
    assert.ok(
      !src.includes("guardianStatus.delete"),
      "disconnect route must not delete GuardianStatus rows",
    );
  });

  test("disconnect applies rate limiting", () => {
    const src = readApi("broker-connections/[id]/disconnect/route.ts");
    assert.ok(
      src.includes("checkRateLimit"),
      "disconnect route must apply rate limiting",
    );
  });
});

// ── UI: pending removal badge ─────────────────────────────────────────────────

describe("UI shows pending removal badge for scheduled removals", () => {
  test("broker-connections-section shows Removal scheduled badge", () => {
    const src = read("./_components/broker-connections-section.tsx");
    assert.ok(
      src.includes("Removal scheduled"),
      "section must show 'Removal scheduled' badge when pendingProtectionStatus is archived",
    );
  });

  test("removal badge checks pendingProtectionStatus === 'archived'", () => {
    const src = read("./_components/broker-connections-section.tsx");
    assert.ok(
      src.includes('pendingProtectionStatus === "archived"'),
      "badge must be conditional on pendingProtectionStatus === 'archived'",
    );
  });

  test("BrokerAccountRow type includes pendingProtectionStatus field", () => {
    const src = read("./_components/broker-connections-section.tsx");
    assert.ok(
      src.includes("pendingProtectionStatus: string | null"),
      "BrokerAccountRow must declare pendingProtectionStatus field",
    );
  });

  test("DisconnectConnectionButton is imported and used in BrokerConnectionCard", () => {
    const src = read("./_components/broker-connections-section.tsx");
    assert.ok(
      src.includes("DisconnectConnectionButton"),
      "section must import and render DisconnectConnectionButton",
    );
  });
});

// ── UI: DisconnectConnectionButton ────────────────────────────────────────────

describe("DisconnectConnectionButton safety copy", () => {
  test("confirmation dialog mentions that historical data is preserved", () => {
    const src = read("./_components/disconnect-connection-button.tsx");
    assert.ok(
      src.includes("preserved") || src.includes("Historical"),
      "dialog must mention historical data preservation",
    );
  });

  test("confirmation dialog warns about rule-bypass prevention", () => {
    const src = read("./_components/disconnect-connection-button.tsx");
    assert.ok(
      src.includes("locked") || src.includes("rule activity"),
      "dialog must warn about rule-bypass prevention",
    );
  });

  test("result shows per-account outcome (immediate vs scheduled)", () => {
    const src = read("./_components/disconnect-connection-button.tsx");
    assert.ok(
      src.includes("archived_now") || src.includes("archived now"),
      "result must differentiate immediate removals",
    );
    assert.ok(
      src.includes("scheduled"),
      "result must differentiate scheduled removals",
    );
  });

  test("button POSTs to /api/broker-connections/:id/disconnect", () => {
    const src = read("./_components/disconnect-connection-button.tsx");
    assert.ok(
      src.includes("/disconnect"),
      "button must POST to the /disconnect endpoint",
    );
  });

  test("confirmation is a centered modal, not an inline red warning box that can overflow", () => {
    const src = read("./_components/disconnect-connection-button.tsx");
    // Confirmation now uses the shared centered ConfirmDialog…
    assert.ok(src.includes("ConfirmDialog"), "disconnect must confirm via the shared ConfirmDialog modal");
    assert.ok(src.includes('title="Disconnect this connection?"'), "modal must carry the disconnect title");
    // …and must NOT expand the old inline red warning container.
    assert.ok(
      !src.includes("border-red-100") && !src.includes("bg-red-50/60"),
      "the old inline red warning box must be gone",
    );
  });

  test("disconnect modal copy matches the agreed wording", () => {
    const src = read("./_components/disconnect-connection-button.tsx");
    assert.ok(
      src.includes("All linked accounts under this connection will be removed from Guardrail monitoring."),
      "modal body must use the agreed copy",
    );
    assert.ok(
      src.includes("at the next trading session reset to prevent bypassing your own rules"),
      "modal note must keep the rule-bypass-prevention warning",
    );
  });
});

// ── RemoveAccountButton uses archive (soft-delete) ───────────────────────────

describe("RemoveAccountButton uses archive endpoint, not hard delete", () => {
  test("RemoveAccountButton calls POST /api/accounts/:id/protection", () => {
    const src = read("./_components/remove-account-button.tsx");
    assert.ok(
      src.includes("/protection"),
      "RemoveAccountButton must POST to /api/accounts/:id/protection",
    );
    assert.ok(
      src.includes('"archived"'),
      "RemoveAccountButton must send protectionStatus: archived",
    );
  });

  test("RemoveAccountButton does NOT call DELETE", () => {
    const src = read("./_components/remove-account-button.tsx");
    assert.ok(
      !src.includes('method: "DELETE"') && !src.includes("method: 'DELETE'"),
      "RemoveAccountButton must not use DELETE method — soft-delete only",
    );
  });

  test("RemoveAccountButton shows scheduled message when removal is deferred", () => {
    const src = read("./_components/remove-account-button.tsx");
    assert.ok(
      src.includes("scheduled"),
      "RemoveAccountButton must handle scheduled response and show a message",
    );
  });

  test("RemoveAccountButton mentions historical data preservation", () => {
    const src = read("./_components/remove-account-button.tsx");
    assert.ok(
      src.includes("preserved") || src.includes("Historical data"),
      "RemoveAccountButton dialog must mention data preservation",
    );
  });
});

// ── Pending archive self-promotion ───────────────────────────────────────────

describe("pending archive promotion — cron path exists and self-resolves", () => {
  test("pending-connected-account-promoter.ts exists and exports the promoter function", () => {
    const src = readLib("pending-connected-account-promoter.ts");
    assert.ok(
      src.includes("promotePendingConnectedAccountProtection"),
      "pending-connected-account-promoter.ts must export promotePendingConnectedAccountProtection",
    );
  });

  test("promoter queries pendingProtectionStatus = 'archived'", () => {
    const src = readLib("pending-connected-account-promoter.ts");
    assert.ok(
      src.includes('pendingProtectionStatus: "archived"'),
      "promoter must filter rows by pendingProtectionStatus = 'archived'",
    );
  });

  test("promoter compares effectiveDate to todayKey (date-gate logic present)", () => {
    const src = readLib("pending-connected-account-promoter.ts");
    assert.ok(
      src.includes("todayKey"),
      "promoter must compute todayKey and gate on it",
    );
    assert.ok(
      src.includes("effectiveDate"),
      "promoter must reference effectiveDate in its gating logic",
    );
  });

  test("cron route wires the connected-account promoter", () => {
    const src = readApi("cron/promote-pending-rules/route.ts");
    assert.ok(
      src.includes("promotePendingConnectedAccountProtection"),
      "promote-pending-rules cron must call promotePendingConnectedAccountProtection",
    );
  });

  test("cron route returns promotedAccountProtectionCount in response", () => {
    const src = readApi("cron/promote-pending-rules/route.ts");
    assert.ok(
      src.includes("promotedAccountProtectionCount"),
      "cron response must include promotedAccountProtectionCount so callers can observe promotions",
    );
  });

  test("promoter sets protectionStatus = 'archived' on promotion", () => {
    const src = readLib("pending-connected-account-promoter.ts");
    assert.ok(
      src.includes('protectionStatus: "archived"'),
      "promoter must write protectionStatus: 'archived'",
    );
  });

  test("promoter clears both pending fields on promotion", () => {
    const src = readLib("pending-connected-account-promoter.ts");
    assert.ok(
      src.includes("pendingProtectionStatus: null"),
      "promoter must clear pendingProtectionStatus",
    );
    assert.ok(
      src.includes("pendingProtectionEffectiveDate: null"),
      "promoter must clear pendingProtectionEffectiveDate",
    );
  });

  test("promoter source does not reference forbidden historical tables", () => {
    const src = readLib("pending-connected-account-promoter.ts");
    for (const forbidden of [
      "normalizedTradeEvent",
      "accountRiskRules",
      "internalLockEvent",
      "guardianStatus",
      "brokerOrderActionLog",
      "ruleChangeAudit",
      "deleteMany",
      ".delete(",
    ]) {
      assert.ok(
        !src.includes(forbidden),
        `pending-connected-account-promoter.ts must not reference '${forbidden}'`,
      );
    }
  });
});

// ── No user can remove another user's data ────────────────────────────────────

describe("ownership enforcement", () => {
  test("archive route enforces userId on account lookup", () => {
    const src = readApi("accounts/[id]/protection/route.ts");
    const lookupIdx = src.indexOf("connectedAccount.findFirst");
    const userIdx = src.indexOf("userId: user.id", lookupIdx);
    assert.ok(
      userIdx !== -1 && userIdx < lookupIdx + 500,
      "account lookup must include userId constraint to prevent cross-user access",
    );
  });

  test("disconnect route enforces userId on connection lookup", () => {
    const src = readApi("broker-connections/[id]/disconnect/route.ts");
    const lookupIdx = src.indexOf("brokerConnection.findFirst");
    const userIdx = src.indexOf("userId: currentUser.id", lookupIdx);
    assert.ok(
      userIdx !== -1 && userIdx < lookupIdx + 300,
      "connection lookup must include userId constraint to prevent cross-user access",
    );
  });

  test("guard enforces userId on account lookup", () => {
    const src = readLib("account-removal-guard.ts");
    const lookupIdx = src.indexOf("connectedAccount.findFirst");
    const userIdx = src.indexOf("userId", lookupIdx);
    assert.ok(
      userIdx !== -1 && userIdx < lookupIdx + 200,
      "guard account lookup must include userId constraint",
    );
  });
});
