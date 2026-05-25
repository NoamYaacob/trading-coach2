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
