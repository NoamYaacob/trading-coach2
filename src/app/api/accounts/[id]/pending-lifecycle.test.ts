/**
 * Audit-tier tests that pin the pending-rule lifecycle.
 *
 * Current state (verified against the source tree):
 *   - pendingPayloadJson + pendingEffectiveDate are WRITTEN by the locked
 *     branch of /api/rules and /api/accounts/[id].
 *   - They are CLEARED (set to JsonNull / null) when the user saves again
 *     during an unlocked window OR when the cron promotes them.
 *   - They are READ (display-only) by app/rules/page.tsx and
 *     account-rules-form.tsx to render the pending panel.
 *   - They are PROMOTED into the active columns by the cron route at
 *     /api/cron/promote-pending-rules, which calls
 *     src/lib/pending-rule-promoter.ts. Eligibility is anchored to the CME
 *     trading-day key (deriveCmeTradingDayKey).
 *
 * These tests guard against silent regressions:
 *   - Promotion-related Prisma writes can only originate from the two
 *     PATCH routes or the promoter library — anything else is suspect.
 *   - The promoter cron must exist and reference the promoter library.
 *   - UI copy must reflect that pending will activate automatically.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..", "..", "..");
const SRC_ROOT = join(REPO_ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      walk(full, out);
    } else if (
      st.isFile() &&
      (full.endsWith(".ts") || full.endsWith(".tsx")) &&
      !full.endsWith(".test.ts") &&
      !full.endsWith(".spec.ts") &&
      !full.endsWith(".d.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

const SOURCE_FILES = walk(SRC_ROOT);

// ── Pending payload write paths are exactly as documented ────────────────────

test("pendingPayloadJson is written from exactly two routes (default rules + account)", () => {
  const writers = SOURCE_FILES.filter((f) => {
    const src = readFileSync(f, "utf8");
    return /pendingPayloadJson:\s*payload|pendingPayloadJson:\s*cleaned/.test(src);
  });
  // Strip the repo prefix for stable assertions across machines.
  const rel = writers.map((f) => f.slice(REPO_ROOT.length + 1)).sort();
  assert.deepEqual(
    rel,
    [
      "src/app/api/accounts/[id]/route.ts",
      "src/app/api/rules/route.ts",
    ],
    "Only the two PATCH routes should write pendingPayloadJson — any new writer needs the audit re-run",
  );
});

// ── Promotion code is centralised ────────────────────────────────────────────

test("only the promoter library and the two PATCH routes touch pending+active rules", () => {
  // A real promoter reads pendingPayloadJson and UPDATEs / DELETEs the
  // matching rules row. We assert that the only files doing both are the
  // documented locations, so a half-baked alt-promoter can't sneak in.
  const allowed = new Set<string>([
    "src/app/api/accounts/[id]/route.ts",
    "src/app/api/rules/route.ts",
    "src/lib/pending-rule-promoter.ts",
    // Copy endpoint clears pendingPayloadJson (sets to JsonNull) when copying
    // rules so the target starts clean with no inherited pending changes.
    "src/app/api/accounts/[id]/rules/copy/route.ts",
  ]);
  const suspicious = SOURCE_FILES.filter((f) => {
    const src = readFileSync(f, "utf8");
    const readsPending = /pendingPayloadJson/.test(src);
    if (!readsPending) return false;
    const writesRules =
      /accountRiskRules\.(update|upsert|delete)|riskRules\.(update|upsert)/i.test(src);
    if (!writesRules) return false;
    const rel = f.slice(REPO_ROOT.length + 1);
    return !allowed.has(rel);
  });
  assert.deepEqual(
    suspicious,
    [],
    "Pending-payload promotion may only happen in /api/rules, /api/accounts/[id], or src/lib/pending-rule-promoter.ts",
  );
});

test("the promoter cron route exists and is wired to the promoter library", () => {
  const path = join(SRC_ROOT, "app", "api", "cron", "promote-pending-rules", "route.ts");
  const src = readFileSync(path, "utf8");
  assert.ok(
    /promotePendingRules/.test(src),
    "cron route must call promotePendingRules from the promoter library",
  );
  assert.ok(
    /x-cron-secret/.test(src),
    "cron route must require the same x-cron-secret header as other crons",
  );
});

test("the promoter activation gate is anchored to CME logic, not raw UTC dates", () => {
  const promoterSrc = readFileSync(
    join(SRC_ROOT, "lib", "pending-rule-promoter.ts"),
    "utf8",
  );
  const activationSrc = readFileSync(
    join(SRC_ROOT, "lib", "rule-activation-window.ts"),
    "utf8",
  );
  // The promoter delegates safety to canActivateRulesNow, which internally
  // calls the CME helpers (isCmeMaintenanceWindow, isCmeWeekendClose,
  // isCmeMarketOpen). Together they anchor activation to America/Chicago.
  assert.ok(
    /canActivateRulesNow/.test(promoterSrc),
    "promoter must call canActivateRulesNow as the activation gate",
  );
  assert.ok(
    /isCmeMaintenanceWindow|isCmeWeekendClose|isCmeMarketOpen/.test(activationSrc),
    "activation helper must use the CME session helpers, not local/UTC time",
  );
});

test("the promoter library never imports a Tradovate / broker SDK", () => {
  const src = readFileSync(join(SRC_ROOT, "lib", "pending-rule-promoter.ts"), "utf8");
  // Strip line + block comments before scanning for broker imports / calls so
  // a comment that explicitly says "this module does not call Tradovate" can
  // stay in the source for human readers without tripping the regex.
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.ok(
    !/from\s+["']@\/lib\/brokers\//.test(stripped),
    "promoter must not import from @/lib/brokers — promotion is a DB activation step only",
  );
  assert.ok(
    !/TradovateClient|tradovate-client|brokers\/tradovate/.test(stripped),
    "promoter code must not reference any Tradovate runtime symbol",
  );
});

// ── Default-template pending banner now reflects the wired promoter ──────────

test("default template pending banner says pending will activate at the next safe window", () => {
  // Activation is gated by the per-row SAFETY window enforced by the cron +
  // canActivateRulesNow (CME maintenance / weekend close / market closed /
  // account locked). The banner copy must reflect that mechanism, not a
  // calendar "edit window".
  const src = readFileSync(join(SRC_ROOT, "app", "rules", "page.tsx"), "utf8");
  assert.ok(
    src.includes("will activate automatically at the next safe window"),
    "default template pending banner must say 'will activate automatically at the next safe window'",
  );
});

test("default template pending banner no longer claims 'not wired yet'", () => {
  const src = readFileSync(join(SRC_ROOT, "app", "rules", "page.tsx"), "utf8");
  assert.ok(
    !src.includes("automatic activation is not wired yet"),
    "the 'not wired yet' line must be removed now that the promoter exists",
  );
});

// ── Pending lock-write isolation (account override never touches default) ────

test("account-route pending write only touches AccountRiskRules", () => {
  const src = readFileSync(
    join(SRC_ROOT, "app", "api", "accounts", "[id]", "route.ts"),
    "utf8",
  );
  // The locked-save branch should upsert AccountRiskRules and never RiskRules.
  // Find the block that writes pendingPayloadJson and confirm it's scoped to
  // accountRiskRules.upsert.
  const lockedBlock = src.match(/eligibility\.canEditNow[\s\S]*?prisma\.accountRiskRules\.upsert/);
  assert.ok(lockedBlock, "expected locked-save branch to upsert accountRiskRules");
  // Same block must NOT call prisma.riskRules.{update|upsert}.
  const lockedSegment = lockedBlock![0];
  assert.ok(
    !/prisma\.riskRules\.(update|upsert)/.test(lockedSegment),
    "locked-save branch in /api/accounts/[id] must not write to RiskRules (default template)",
  );
});

test("default-template-route pending write only touches RiskRules", () => {
  const src = readFileSync(join(SRC_ROOT, "app", "api", "rules", "route.ts"), "utf8");
  // The locked-save branch should upsert RiskRules and never AccountRiskRules.
  const lockedBlock = src.match(/eligibility\.canEditNow[\s\S]*?prisma\.riskRules\.upsert/);
  assert.ok(lockedBlock, "expected locked-save branch to upsert riskRules");
  const lockedSegment = lockedBlock![0];
  assert.ok(
    !/prisma\.accountRiskRules\.(update|upsert)/.test(lockedSegment),
    "locked-save branch in /api/rules must not write to AccountRiskRules (account overrides)",
  );
});

// ── pendingEffectiveDate uses CME trading-day key, not local/UTC midnight ────

test("pendingEffectiveDate is computed from eligibility.nextAllowedAt (CME-anchored)", () => {
  const accountSrc = readFileSync(
    join(SRC_ROOT, "app", "api", "accounts", "[id]", "route.ts"),
    "utf8",
  );
  const rulesSrc = readFileSync(
    join(SRC_ROOT, "app", "api", "rules", "route.ts"),
    "utf8",
  );
  // Both should use eligibility.nextAllowedAt, not Date.now or new Date().
  for (const [path, src] of [
    ["accounts/[id]/route.ts", accountSrc] as const,
    ["rules/route.ts", rulesSrc] as const,
  ]) {
    assert.ok(
      /eligibility\.nextAllowedAt/.test(src),
      `${path} must derive pendingEffectiveDate from eligibility.nextAllowedAt (CME-aware), not local/UTC time`,
    );
  }
});

// ── session_already_traded enforcement ───────────────────────────────────────

const accountRouteSrc = readFileSync(
  join(REPO_ROOT, "src/app/api/accounts/[id]/route.ts"),
  "utf8",
);
const rulesRouteSrc = readFileSync(
  join(REPO_ROOT, "src/app/api/rules/route.ts"),
  "utf8",
);

test("account route selects tradesCount and sessionDate from LiveSessionState", () => {
  assert.ok(
    /tradesCount:\s*true/.test(accountRouteSrc),
    "account route must select tradesCount from liveSessionState",
  );
  assert.ok(
    /sessionDate:\s*true/.test(accountRouteSrc),
    "account route must select sessionDate from liveSessionState",
  );
});

test("account route rejects with 423 + session_already_traded when tradesCount > 0", () => {
  assert.ok(
    /session_already_traded/.test(accountRouteSrc),
    "account route must contain session_already_traded rejection",
  );
  assert.ok(
    /tradesCount.*>\s*0|liveState\?\.tradesCount/.test(accountRouteSrc),
    "account route must check tradesCount > 0",
  );
  assert.ok(
    /status:\s*423/.test(accountRouteSrc),
    "account route must return 423 for session_already_traded",
  );
});

test("account route writes RuleChangeAudit with blockReason session_already_traded", () => {
  assert.ok(
    /blockReason:\s*["']session_already_traded["']/.test(accountRouteSrc),
    "account route must write RuleChangeAudit blockReason: 'session_already_traded'",
  );
});

test("account route uses deriveCmeTradingDayKey to anchor the session day check", () => {
  assert.ok(
    /deriveCmeTradingDayKey/.test(accountRouteSrc),
    "account route must call deriveCmeTradingDayKey for CME-anchored session day",
  );
});

test("rules route selects tradesCount and sessionDate from LiveSessionState", () => {
  assert.ok(
    /tradesCount:\s*true/.test(rulesRouteSrc),
    "rules route must select tradesCount from liveSessionState",
  );
  assert.ok(
    /sessionDate:\s*true/.test(rulesRouteSrc),
    "rules route must select sessionDate from liveSessionState",
  );
});

test("rules route rejects with 423 + session_already_traded when any account has traded", () => {
  assert.ok(
    /session_already_traded/.test(rulesRouteSrc),
    "rules route must contain session_already_traded rejection",
  );
  assert.ok(
    /status:\s*423/.test(rulesRouteSrc),
    "rules route must return 423 for session_already_traded",
  );
});

test("rules route writes RuleChangeAudit with blockReason session_already_traded", () => {
  assert.ok(
    /blockReason:\s*["']session_already_traded["']/.test(rulesRouteSrc),
    "rules route must write RuleChangeAudit blockReason: 'session_already_traded'",
  );
});

test("rules route uses deriveCmeTradingDayKey to anchor the session day check", () => {
  assert.ok(
    /deriveCmeTradingDayKey/.test(rulesRouteSrc),
    "rules route must call deriveCmeTradingDayKey for CME-anchored session day",
  );
});

test("account route 423 message for session_already_traded references the session", () => {
  assert.ok(
    /already traded/.test(accountRouteSrc),
    "account route 423 message must say 'already traded'",
  );
  assert.ok(
    /session resets/.test(accountRouteSrc),
    "account route 423 message must say 'session resets'",
  );
});

test("rules page selects tradesCount and sessionDate from LiveSessionState", () => {
  const pagesSrc = readFileSync(join(REPO_ROOT, "src/app/rules/page.tsx"), "utf8");
  assert.ok(
    /tradesCount:\s*true/.test(pagesSrc),
    "rules page must select tradesCount for hasAlreadyTradedToday",
  );
  assert.ok(
    /sessionDate:\s*true/.test(pagesSrc),
    "rules page must select sessionDate for hasAlreadyTradedToday",
  );
  assert.ok(
    /hasAlreadyTradedToday/.test(pagesSrc),
    "rules page must compute hasAlreadyTradedToday",
  );
});

// ── First-fill race condition fix ─────────────────────────────────────────────
// The lock must trigger as soon as a trade event exists, not only after the
// sync cron has incremented tradesCount. Tests below pin the multi-signal approach.

const guardSrc = readFileSync(
  join(REPO_ROOT, "src/lib/rules/session-trade-guard.ts"),
  "utf8",
);

test("account route selects lastTradeAt from LiveSessionState", () => {
  assert.ok(
    /lastTradeAt:\s*true/.test(accountRouteSrc),
    "account route must select lastTradeAt from liveSessionState to catch first-fill race",
  );
});

test("rules route selects lastTradeAt from LiveSessionState", () => {
  assert.ok(
    /lastTradeAt:\s*true/.test(rulesRouteSrc),
    "rules route must select lastTradeAt from liveSessionState to catch first-fill race",
  );
});

test("account route blocks when lastTradeAt is today even if tradesCount is 0", () => {
  // Route must check deriveCmeTradingDayKey(lastTradeAt) === tradingDayKey
  // independently of tradesCount, so the lock fires before the first sync completes.
  assert.ok(
    /lastTradeAt/.test(accountRouteSrc),
    "account route must check liveState.lastTradeAt as a secondary lock signal",
  );
  assert.ok(
    /deriveCmeTradingDayKey\(liveState/.test(accountRouteSrc),
    "account route must call deriveCmeTradingDayKey on liveState.lastTradeAt for CME-anchored check",
  );
});

test("rules route blocks when any account has lastTradeAt today", () => {
  assert.ok(
    /lastTradeAt/.test(rulesRouteSrc),
    "rules route must check lastTradeAt as a secondary lock signal",
  );
  assert.ok(
    /deriveCmeTradingDayKey\(s\.lastTradeAt/.test(rulesRouteSrc),
    "rules route must call deriveCmeTradingDayKey on lastTradeAt for CME-anchored check",
  );
});

test("account route queries NormalizedTradeEvent for first-fill race protection", () => {
  assert.ok(
    /getAccountIdsWithTradeToday/.test(accountRouteSrc),
    "account route must call getAccountIdsWithTradeToday to check NormalizedTradeEvent",
  );
  assert.ok(
    /session-trade-guard/.test(accountRouteSrc),
    "account route must import from session-trade-guard",
  );
});

test("rules route queries NormalizedTradeEvent for any user account", () => {
  assert.ok(
    /getAccountIdsWithTradeToday/.test(rulesRouteSrc),
    "rules route must call getAccountIdsWithTradeToday to check NormalizedTradeEvent",
  );
  assert.ok(
    /session-trade-guard/.test(rulesRouteSrc),
    "rules route must import from session-trade-guard",
  );
});

test("account route blocks when NormalizedTradeEvent exists today even if LiveSessionState is stale", () => {
  // hasTradeEventToday flag must be used in the 423 rejection condition
  assert.ok(
    /hasTradeEventToday/.test(accountRouteSrc),
    "account route must use hasTradeEventToday in the lock condition",
  );
  assert.ok(
    /liveStateHasTraded\s*\|\|\s*hasTradeEventToday|hasTradeEventToday\s*\|\|\s*liveStateHasTraded/.test(
      accountRouteSrc,
    ),
    "account route must reject when either liveStateHasTraded OR hasTradeEventToday is true",
  );
});

test("default template blocks when any account has a NormalizedTradeEvent today", () => {
  assert.ok(
    /tradeEventIds/.test(rulesRouteSrc),
    "rules route must compute tradeEventIds from NormalizedTradeEvent",
  );
  assert.ok(
    /liveStateTradedIds\.size\s*>\s*0\s*\|\|\s*tradeEventIds\.size\s*>\s*0|tradeEventIds\.size\s*>\s*0\s*\|\|\s*liveStateTradedIds\.size\s*>\s*0/.test(
      rulesRouteSrc,
    ),
    "rules route must block when either liveStateTradedIds OR tradeEventIds is non-empty",
  );
});

test("first-time setup exemption still bypasses session_already_traded check", () => {
  // isFirstTimeSetup must guard the hard-reject block in the account route
  assert.ok(
    /!isFirstTimeSetup.*liveStateHasTraded|!isFirstTimeSetup.*hasTradeEventToday/.test(
      accountRouteSrc,
    ),
    "account route must gate session_already_traded block behind !isFirstTimeSetup",
  );
});

test("account route writes RuleChangeAudit with blockReason=session_already_traded for all paths", () => {
  // The audit write must still be present for the broadened condition
  const auditMatches = accountRouteSrc.match(
    /blockReason:\s*["']session_already_traded["']/g,
  );
  assert.ok(
    auditMatches != null && auditMatches.length >= 1,
    "account route must write RuleChangeAudit blockReason: session_already_traded",
  );
});

test("session-trade-guard makes no broker calls (no tradovate import)", () => {
  assert.ok(
    !guardSrc.includes("tradovate-client"),
    "session-trade-guard must not import tradovate-client — no broker calls allowed from rule-save path",
  );
  assert.ok(
    !guardSrc.includes("fetch("),
    "session-trade-guard must not call fetch — pure DB read only",
  );
  assert.ok(
    !guardSrc.includes("tradovate-ensure-token"),
    "session-trade-guard must not import tradovate-ensure-token",
  );
});

test("session-trade-guard queries NormalizedTradeEvent for fill/closed event types", () => {
  assert.ok(
    /normalizedTradeEvent/.test(guardSrc),
    "session-trade-guard must query normalizedTradeEvent",
  );
  assert.ok(
    /fill/.test(guardSrc),
    "session-trade-guard must include 'fill' event type in query",
  );
  assert.ok(
    /trade_closed/.test(guardSrc),
    "session-trade-guard must include 'trade_closed' event type in query",
  );
});

test("session-trade-guard uses occurredAt >= sessionStart as the time boundary", () => {
  assert.ok(
    /occurredAt.*gte.*sessionStart|sessionStart.*occurredAt/.test(guardSrc),
    "session-trade-guard must filter by occurredAt >= sessionStart for CME session scoping",
  );
});
