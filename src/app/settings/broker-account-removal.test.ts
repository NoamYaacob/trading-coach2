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
  test("guard checks LiveSessionState.riskState === STOPPED for today", () => {
    const src = readLib("account-removal-guard.ts");
    assert.ok(
      src.includes("STOPPED"),
      "guard must check LiveSessionState.riskState === STOPPED",
    );
    assert.ok(
      src.includes("riskState"),
      "guard must read riskState from LiveSessionState",
    );
  });

  test("guard checks LiveSessionState.cooldownActive", () => {
    const src = readLib("account-removal-guard.ts");
    assert.ok(
      src.includes("cooldownActive"),
      "guard must check cooldownActive flag on session state",
    );
  });

  test("guard only uses today's session state (sessionDate check)", () => {
    const src = readLib("account-removal-guard.ts");
    assert.ok(
      src.includes("sessionDate") && src.includes("todayKey"),
      "guard must compare sessionDate to todayKey so stale session state is ignored",
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

  test("guard queries internalLockEvent by tradingDay key", () => {
    const src = readLib("account-removal-guard.ts");
    assert.ok(
      src.includes("tradingDay") && src.includes("todayKey"),
      "guard must filter InternalLockEvent by today's trading day key",
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
    const src = readLib("account-removal-guard.ts");
    assert.ok(
      src.includes("missingFromBrokerSince"),
      "guard must check missingFromBrokerSince as a bypass condition",
    );
    assert.ok(
      src.includes("canRemoveNow: true") && src.includes("missingFromBrokerSince"),
      "guard must return canRemoveNow: true for accounts missing from broker",
    );
    assert.ok(
      src.includes("missingFromBrokerSince != null"),
      "guard must check missingFromBrokerSince != null for the bypass",
    );
  });

  test("guard bypasses all checks for ignored/archived accounts", () => {
    const src = readLib("account-removal-guard.ts");
    assert.ok(
      src.includes('"ignored"') && src.includes('"archived"'),
      "guard must bypass checks for ignored and archived accounts",
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
    const src = readLib("account-removal-guard.ts");
    assert.ok(src.includes("canRemoveNow"), "guard must return canRemoveNow");
    assert.ok(src.includes("lockReason"), "guard must return lockReason");
    assert.ok(src.includes("nextTradingDay"), "guard must return nextTradingDay");
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
