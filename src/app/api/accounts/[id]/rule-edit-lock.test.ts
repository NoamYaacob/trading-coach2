/**
 * Server-side rule-edit lock — coverage across every mutating rule action.
 *
 * Confirms (by source-scan, the repo's API-route test style) that the
 * "already traded today" lock is enforced on the SERVER for:
 *   - update / edit existing rules        (PATCH, has existing rules → blocked)
 *   - delete / clear rules                (PATCH riskRules: null → blocked)
 *   - copy rules from another account      (copy route → blocked if replaces)
 *
 * And that first-time creation stays allowed (only adds protection, never
 * weakens), per product decision:
 *   - traded today + NO existing rules → create allowed
 *   - traded today + existing rules    → update/delete/copy blocked
 *
 * The user-facing 423 message must be identical everywhere:
 *   "You already started trading this account today. To protect your rules,
 *    changes will be available next trading day."
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HERE = import.meta.dirname;
const PATCH_ROUTE = resolve(HERE, "./route.ts");
const COPY_ROUTE = resolve(HERE, "./rules/copy/route.ts");

function read(p: string): string {
  return readFileSync(p, "utf8");
}

const LOCK_MESSAGE =
  "You already started trading this account today. To protect your rules, changes will be available next trading day.";

// ── PATCH route: lock uses the CME trading-day helper + all 3 signals ─────────

describe("PATCH /api/accounts/[id] — server-side rule-edit lock", () => {
  const src = read(PATCH_ROUTE);

  it("anchors the lock to the CME trading day", () => {
    assert.ok(src.includes("deriveCmeTradingDayKey"), "must use deriveCmeTradingDayKey");
    assert.ok(src.includes("getCmeSessionStartForKey"), "must derive the CME session start");
  });

  it("checks all three traded-today signals", () => {
    assert.ok(src.includes("tradesCount"), "signal 1: LiveSessionState.tradesCount");
    assert.ok(src.includes("lastTradeAt"), "signal 2: LiveSessionState.lastTradeAt");
    assert.ok(
      src.includes("getAccountIdsWithTradeToday"),
      "signal 3: NormalizedTradeEvent fills via getAccountIdsWithTradeToday",
    );
  });

  it("returns 423 session_already_traded when traded + not first-time", () => {
    assert.ok(src.includes('"session_already_traded"'), "must use session_already_traded reason");
    assert.ok(src.includes("{ status: 423 }"), "must return 423 status");
  });

  it("gates the reject on !isFirstTimeSetup (update/delete blocked, create allowed)", () => {
    assert.ok(
      /if\s*\(!isFirstTimeSetup\s*&&\s*\(liveStateHasTraded\s*\|\|\s*hasTradeEventToday\)\)/.test(src),
      "the 423 reject must be gated by !isFirstTimeSetup && (traded signals)",
    );
    assert.ok(
      src.includes("const isFirstTimeSetup = !existingAccountRules"),
      "isFirstTimeSetup must be derived from whether AccountRiskRules already exist",
    );
  });

  it("delete/clear flows through the same lock (riskRules === null is !== undefined)", () => {
    // The whole lock block lives inside `if (body.riskRules !== undefined)`,
    // and delete is `body.riskRules === null` (which is !== undefined), so a
    // delete on an account with existing rules is blocked after trading.
    assert.ok(
      src.includes("if (body.riskRules !== undefined)"),
      "lock block must wrap every riskRules mutation including null (delete)",
    );
    assert.ok(
      src.includes("body.riskRules === null"),
      "delete path must be the riskRules === null branch inside the locked block",
    );
  });

  it("uses the exact user-facing lock message", () => {
    assert.ok(src.includes(LOCK_MESSAGE), "PATCH 423 must use the canonical lock message");
  });
});

// ── Copy route: lock blocks replace, exempts first-time ───────────────────────

describe("POST /api/accounts/[id]/rules/copy — server-side rule-edit lock", () => {
  const src = read(COPY_ROUTE);

  it("anchors the lock to the CME trading day with all 3 signals", () => {
    assert.ok(src.includes("deriveCmeTradingDayKey"), "must use deriveCmeTradingDayKey");
    assert.ok(src.includes("tradesCount"), "signal 1");
    assert.ok(src.includes("lastTradeAt"), "signal 2");
    assert.ok(src.includes("getAccountIdsWithTradeToday"), "signal 3");
  });

  it("computes isFirstTimeSetup from the TARGET account's existing rules", () => {
    assert.ok(
      src.includes("const isFirstTimeSetup = !existingTargetRules"),
      "must detect first-time setup from the target account's existing rules",
    );
    assert.ok(
      src.includes("where: { accountId: id }") && src.includes("accountId: true"),
      "must query existing AccountRiskRules for the target id",
    );
  });

  it("blocks copy that replaces existing rules after trading (gated by !isFirstTimeSetup)", () => {
    assert.ok(
      /if\s*\(!isFirstTimeSetup\s*&&\s*\(liveStateHasTraded\s*\|\|\s*hasTradeEventToday\)\)/.test(src),
      "copy lock must be gated by !isFirstTimeSetup",
    );
    assert.ok(src.includes("{ status: 423 }"), "must return 423 when blocked");
  });

  it("uses the exact user-facing lock message", () => {
    assert.ok(src.includes(LOCK_MESSAGE), "copy 423 must use the canonical lock message");
  });

  it("writes a RuleChangeAudit row on the blocked path", () => {
    assert.ok(src.includes("writeRuleChangeAudit"), "must audit blocked copy");
    assert.ok(src.includes("allowed: false"), "blocked audit must set allowed: false");
  });
});

// ── Cross-surface message consistency ─────────────────────────────────────────

describe("rule-edit lock message is consistent across server + client", () => {
  const files = [
    PATCH_ROUTE,
    COPY_ROUTE,
    resolve(HERE, "../../../../app/rules/page.tsx"),
    resolve(HERE, "../../../../app/rules/_components/copy-rules-modal.tsx"),
  ];

  for (const f of files) {
    it(`uses the canonical lock message in ${f.split("/").slice(-2).join("/")}`, () => {
      assert.ok(read(f).includes(LOCK_MESSAGE), "must use the canonical lock message");
    });
  }
});
