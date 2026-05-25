/**
 * Source-scan tests for /debug/safety-console.
 *
 * Guards the safety contract: no Tradovate writes, no broker calls,
 * admin/auth gate preserved, QA copy present, C2/C3 NO-GO copy present.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

function src(rel: string): string {
  return readFileSync(resolve(import.meta.dirname, rel), "utf-8");
}

function codeOnly(s: string): string {
  return s
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return t.length > 0 && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("*/");
    })
    .join("\n");
}

const PAGE_SRC = src("page.tsx");
const CODE = codeOnly(PAGE_SRC);

describe("safety-console page — no broker writes", () => {
  it("does not import TradovateClient", () => {
    assert.ok(!CODE.includes("TradovateClient"), "must not import TradovateClient");
  });

  it("does not call any Tradovate write endpoint", () => {
    const brokerWritePatterns = [
      "setDailyLoss",
      "setRiskSetting",
      "setAutoLiq",
      "tradovate.post",
      "tradovatePost",
    ];
    for (const pattern of brokerWritePatterns) {
      assert.ok(!CODE.includes(pattern), `must not reference broker write: ${pattern}`);
    }
  });

  it("does not fetch() to the recovery probe endpoint", () => {
    // The page is a server component — all data comes from Prisma, not fetch() calls.
    // It may mention "recovery-probe" in guidance copy but must not call it.
    const hasFetchCall = CODE.includes("fetch(") && CODE.includes("recovery-probe");
    assert.ok(!hasFetchCall, "must not fetch() to the recovery probe endpoint");
  });

  it("does not call any broker API endpoint via fetch", () => {
    // Server component does DB queries only; no fetch() to Tradovate or internal APIs.
    const forbiddenFetches = [
      "fetch(\"/api/debug/broker",
      "fetch(\"/api/broker",
      "fetch(\"https://demo.tradovateapi",
      "fetch(\"https://live.tradovateapi",
    ];
    for (const pattern of forbiddenFetches) {
      assert.ok(!CODE.includes(pattern), `must not fetch(): ${pattern}`);
    }
  });

  it("does not import or call cancel or flatten actions", () => {
    const forbidden = ["cancelOrder", "flattenPositions", "cancelAll", "flattenAll"];
    for (const pattern of forbidden) {
      assert.ok(!CODE.includes(pattern), `must not reference: ${pattern}`);
    }
  });
});

describe("safety-console page — auth gate preserved", () => {
  it("calls getCurrentUser()", () => {
    assert.ok(CODE.includes("getCurrentUser"), "must call getCurrentUser");
  });

  it("redirects to /login when no user", () => {
    assert.ok(CODE.includes('redirect("/login")'), "must redirect unauthenticated users");
  });

  it("calls isAdminEmail()", () => {
    assert.ok(CODE.includes("isAdminEmail"), "must check isAdminEmail");
  });

  it("calls notFound() for non-admin users", () => {
    assert.ok(CODE.includes("notFound()"), "must call notFound() for non-admin");
  });
});

describe("safety-console page — QA status card present", () => {
  it("references the DEMO7433035 account ID", () => {
    assert.ok(
      CODE.includes("cmottd1z200020do1knjxq582"),
      "must reference the DEMO7433035 accountId",
    );
  });

  it("references DEMO7433035 external ID string", () => {
    assert.ok(CODE.includes("DEMO7433035"), "must show the DEMO7433035 external account ID");
  });

  it("shows C1 QA status card", () => {
    assert.ok(CODE.includes("QaStatusCard"), "must render QaStatusCard component");
  });

  it("shows rule-save write PASS copy", () => {
    assert.ok(CODE.includes("rule-save write"), "must show rule-save write status");
  });
});

describe("safety-console page — C2/C3 NO-GO copy present", () => {
  it("shows NO-GO copy for C2", () => {
    assert.ok(CODE.includes("NO-GO"), "must show NO-GO label for C2/C3");
  });

  it("shows C2/C3 are blocked", () => {
    assert.ok(
      CODE.includes("C2") && CODE.includes("C3"),
      "must reference both C2 and C3 phases",
    );
  });

  it("shows do not enable broker enforcement copy", () => {
    const hasEnforcementWarning =
      CODE.includes("do not enable") ||
      CODE.includes("Do not enable") ||
      CODE.includes("do not set BROKER_ENFORCEMENT_ENABLED") ||
      CODE.includes("BROKER_ENFORCEMENT_ENABLED=true");
    assert.ok(hasEnforcementWarning, "must warn against enabling broker enforcement");
  });
});

describe("safety-console page — safety copy banner", () => {
  it("shows SafetyCopyBanner component", () => {
    assert.ok(CODE.includes("SafetyCopyBanner"), "must render SafetyCopyBanner");
  });

  it("shows read-only console copy", () => {
    assert.ok(
      CODE.includes("Read-only console") || CODE.includes("read-only"),
      "must show read-only disclaimer",
    );
  });

  it("states page does not write to Tradovate", () => {
    assert.ok(
      CODE.includes("does not write to Tradovate"),
      "must explicitly state no Tradovate writes",
    );
  });
});

describe("safety-console page — internal-lock diagnostic present", () => {
  it("shows InternalLockDiagnosticSection component", () => {
    assert.ok(
      CODE.includes("InternalLockDiagnosticSection"),
      "must render InternalLockDiagnosticSection",
    );
  });

  it("imports canApplyInternalLock", () => {
    assert.ok(
      PAGE_SRC.includes("canApplyInternalLock"),
      "must import canApplyInternalLock",
    );
  });

  it("imports evaluateDryRunRules", () => {
    assert.ok(
      PAGE_SRC.includes("evaluateDryRunRules"),
      "must import evaluateDryRunRules",
    );
  });

  it("imports buildInternalLockDedupKey", () => {
    assert.ok(
      PAGE_SRC.includes("buildInternalLockDedupKey"),
      "must import buildInternalLockDedupKey",
    );
  });
});

describe("safety-console page — activation candidates section present", () => {
  it("shows DailyLossActivationCandidatesSection component", () => {
    assert.ok(
      CODE.includes("DailyLossActivationCandidatesSection"),
      "must render DailyLossActivationCandidatesSection",
    );
  });

  it("imports hasValidConsent for consent gate", () => {
    assert.ok(PAGE_SRC.includes("hasValidConsent"), "must import hasValidConsent");
  });

  it("imports parseTradovateMasterId", () => {
    assert.ok(
      PAGE_SRC.includes("parseTradovateMasterId"),
      "must import parseTradovateMasterId",
    );
  });
});

describe("safety-console page — full account table present", () => {
  it("shows FullAccountTable component", () => {
    assert.ok(CODE.includes("FullAccountTable"), "must render FullAccountTable");
  });

  it("shows canUseForRecoveryProbePreview field", () => {
    assert.ok(
      CODE.includes("canUseForRecoveryProbePreview"),
      "must derive and show canUseForRecoveryProbePreview",
    );
  });

  it("shows connectionStatus and permissionLevel columns", () => {
    assert.ok(CODE.includes("connectionStatus"), "must show connectionStatus");
    assert.ok(CODE.includes("permissionLevel"), "must show permissionLevel");
  });
});

describe("safety-console page — no env mutation", () => {
  it("does not assign to process.env", () => {
    assert.ok(!CODE.includes("process.env ="), "must not assign to process.env");
    assert.ok(
      !CODE.includes("process.env.BROKER_ENFORCEMENT_ENABLED ="),
      "must not mutate BROKER_ENFORCEMENT_ENABLED",
    );
  });

  it("only reads from process.env, never writes", () => {
    const envWritePattern = /process\.env\.\w+\s*=/;
    assert.ok(!envWritePattern.test(CODE), "must not write to any process.env key");
  });
});

describe("safety-console page — overall status banner copy", () => {
  it("does not say 'All safety checks passing'", () => {
    assert.ok(
      !CODE.includes("All safety checks passing"),
      "must not use misleading 'All safety checks passing' label",
    );
  });

  it("says 'Safe mode active' for the safe state", () => {
    assert.ok(
      CODE.includes("Safe mode active"),
      "must use 'Safe mode active' copy for the safe/green state",
    );
  });

  it("clarifies safe state means inert not rollout-ready", () => {
    assert.ok(
      CODE.includes("inert") || CODE.includes("not rollout-ready") || CODE.includes("enforcement disabled"),
      "must clarify safe state means enforcement is disabled, not that rollout is ready",
    );
  });
});

describe("safety-console page — web vs listener env distinction", () => {
  it("labels web runtime env as not controlling listener-worker", () => {
    assert.ok(
      CODE.includes("Does NOT control listener-worker") ||
        CODE.includes("does NOT control listener-worker") ||
        CODE.includes("not authoritative"),
      "must label web runtime as not authoritative for listener",
    );
  });

  it("labels listener-worker env as authoritative", () => {
    assert.ok(
      CODE.includes("authoritative"),
      "must label listener-worker env as authoritative",
    );
  });

  it("explains GUARDRAIL_INTERNAL_LOCK_ENABLED web value is not authoritative for listener", () => {
    assert.ok(
      CODE.includes("GUARDRAIL_INTERNAL_LOCK_ENABLED") &&
        (CODE.includes("web/app process") || CODE.includes("web process") || CODE.includes("listener-worker") ),
      "must clarify GUARDRAIL_INTERNAL_LOCK_ENABLED web vs listener distinction",
    );
  });
});

describe("safety-console page — C1 vs C2/C3 distinction in checklist", () => {
  it("C1 checklist says TRADOVATE_LISTENER_ENABLE_LIVE is required for C1", () => {
    assert.ok(
      CODE.includes("TRADOVATE_LISTENER_ENABLE_LIVE"),
      "must mention TRADOVATE_LISTENER_ENABLE_LIVE in C1 checklist",
    );
  });

  it("C1 checklist says C1 does NOT need BROKER_ENFORCEMENT_ENABLED", () => {
    assert.ok(
      CODE.includes("C1 does NOT need BROKER_ENFORCEMENT_ENABLED") ||
        CODE.includes("C1 does not need BROKER_ENFORCEMENT_ENABLED") ||
        (CODE.includes("does NOT need") && CODE.includes("BROKER_ENFORCEMENT_ENABLED")),
      "must clarify C1 does not need BROKER_ENFORCEMENT_ENABLED",
    );
  });

  it("distinguishes C1 (internal lock) from C2/C3 (broker writes)", () => {
    assert.ok(
      CODE.includes("C2/C3 broker writes") ||
        CODE.includes("gates C2/C3") ||
        CODE.includes("C2/C3 broker-write"),
      "must explain BROKER_ENFORCEMENT_ENABLED gates C2/C3 broker writes, not C1",
    );
  });
});

describe("safety-console page — trade_limit (maxTradesPerDay) status surfaced", () => {
  it("Demo7Diagnosis type includes maxTradesPerDay", () => {
    assert.ok(
      CODE.includes("maxTradesPerDay: number | null"),
      "Demo7Diagnosis must include maxTradesPerDay so the trade_limit panel can render",
    );
  });

  it("Demo7Diagnosis type includes tradesCount and tradeCountSource", () => {
    assert.ok(
      CODE.includes("tradesCount: number | null"),
      "Demo7Diagnosis must include tradesCount from LiveSessionState",
    );
    assert.ok(
      CODE.includes("tradeCountSource: string | null"),
      "Demo7Diagnosis must include tradeCountSource so suppression is visible",
    );
  });

  it("Demo7Diagnosis derives activeTradeLimitLock from lock events", () => {
    assert.ok(
      CODE.includes("activeTradeLimitLock"),
      "must derive activeTradeLimitLock so the operator sees whether a trade_limit InternalLockEvent is live",
    );
    assert.ok(
      CODE.includes('ruleType === "trade_limit"'),
      "must filter by ruleType === 'trade_limit' when deriving activeTradeLimitLock",
    );
  });

  it("QaStatusCard renders a trade_limit row", () => {
    assert.ok(
      CODE.includes("trade_limit internal lock"),
      "QaStatusCard must show a 'trade_limit internal lock' row alongside C1/C2/C3",
    );
  });

  it("trade_limit row shows N/maxTradesPerDay usage", () => {
    assert.ok(
      CODE.includes("tradesCount=") && CODE.includes("maxTradesPerDay="),
      "live state line must include tradesCount=N/maxTradesPerDay=N",
    );
  });

  it("QaTargetFocusCard shows trade_limit badge", () => {
    assert.ok(
      CODE.includes("tradeLimitLabel"),
      "QaTargetFocusCard must compute a trade_limit badge label",
    );
    assert.ok(
      CODE.includes('"trade_limit: LOCKED"') || CODE.includes("trade_limit: LOCKED"),
      "trade_limit badge must surface a LOCKED state",
    );
  });

  it("InternalLockDiagnosticSection shows tradesCount and maxTradesPerDay rows", () => {
    assert.ok(
      CODE.includes('label="tradesCount"'),
      "diagnostic dl must include a tradesCount row",
    );
    assert.ok(
      CODE.includes('label="maxTradesPerDay"'),
      "diagnostic dl must include a maxTradesPerDay row",
    );
    assert.ok(
      CODE.includes('label="tradeCountSource"'),
      "diagnostic dl must include a tradeCountSource row so suppression cause is visible",
    );
  });

  it("documents trade_limit semantics: inclusive allowance, lock fires when EXCEEDED", () => {
    // Semantics: maxTradesPerDay is the inclusive allowance. With cap=3, trades
    // 1–3 are permitted; the lock fires on trade 4. The copy must reflect this
    // — NOT the older "inclusive cap" / >= phrasing which implied at-cap locks.
    assert.ok(
      CODE.includes("Inclusive allowance") || CODE.includes("inclusive allowance"),
      "must document 'inclusive allowance' semantics for trade_limit",
    );
    assert.ok(
      CODE.includes("tradesCount &gt; maxTradesPerDay") ||
        CODE.includes("tradesCount > maxTradesPerDay"),
      "must document the > (strict) comparison so the allowance behavior is explicit",
    );
    assert.ok(
      !CODE.includes("tradesCount &gt;= maxTradesPerDay") &&
        !CODE.includes("tradesCount >= maxTradesPerDay"),
      "must not document the OLD >= comparison — it locked at the cap, which the product no longer wants",
    );
  });

  it("surfaces an AT CAP state distinct from LOCKED", () => {
    // Under the new semantics, tradesCount === maxTradesPerDay is at the cap
    // but still within the allowance. The console must show this as a
    // pre-lock state (e.g. "AT CAP — next trade locks") rather than LOCKED.
    assert.ok(
      CODE.includes("AT CAP") || CODE.includes("next trade locks"),
      "must surface the at-cap state with copy distinct from LOCKED",
    );
  });

  it("does not call any broker write for trade_limit", () => {
    // The diagnostic panel is read-only — never calls a broker endpoint, even
    // in the trade_limit copy. Reiterates the safety contract.
    const forbidden = [
      "setRiskSetting",
      "setAutoLiq",
      "userAccountAutoLiq",
      "cancelOrder",
      "flattenPositions",
      "applyBrokerDayLockout",
    ];
    for (const banned of forbidden) {
      assert.ok(!CODE.includes(banned), `trade_limit panel must not reference broker write: ${banned}`);
    }
  });
});

describe("safety-console page — QaTargetFocusCard present", () => {
  it("renders QaTargetFocusCard component", () => {
    assert.ok(
      CODE.includes("QaTargetFocusCard"),
      "must render QaTargetFocusCard component",
    );
  });

  it("shows quick link anchors to key sections", () => {
    assert.ok(CODE.includes("#qa-status"), "must have #qa-status anchor link");
    assert.ok(CODE.includes("#internal-lock"), "must have #internal-lock anchor link");
    assert.ok(CODE.includes("#rollout-readiness"), "must have #rollout-readiness anchor link");
    assert.ok(CODE.includes("#broker-sync"), "must have #broker-sync anchor link");
  });

  it("shows rule-save PASS badge in focus card", () => {
    assert.ok(
      CODE.includes("rule-save: PASS") || CODE.includes("rule-save PASS"),
      "must show rule-save PASS badge in focus card",
    );
  });

  it("shows C2/C3 NO-GO badges in focus card", () => {
    assert.ok(
      CODE.includes("C2: NO-GO") || CODE.includes("C3: NO-GO"),
      "must show C2/C3 NO-GO badges in focus card",
    );
  });
});
