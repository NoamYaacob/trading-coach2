/**
 * Source-scan tests for GET /api/debug/symbol-limits-diagnostics.
 *
 * The endpoint is a read-only Phase 4E QA diagnostic. These tests assert,
 * without a DB or network, that it:
 *   - is auth-gated (session + x-cron-secret)
 *   - performs no DB writes and no broker calls
 *   - uses the Phase A symbol-limits helpers
 *   - checks the DEMO7433035 QA preset (NQ=1, MNQ=10, ES=1, MES=10, fallback 4)
 *   - scopes the account lookup to the current user
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTE = resolve(import.meta.dirname, "./route.ts");

function src(): string {
  return readFileSync(ROUTE, "utf8");
}

// ── Auth ──────────────────────────────────────────────────────────────────────

describe("symbol-limits-diagnostics: auth", () => {
  it("requires an authenticated session (401)", () => {
    const s = src();
    assert.ok(s.includes("getCurrentUser"), "must call getCurrentUser");
    assert.ok(s.includes('"unauthorized"') && s.includes("{ status: 401 }"), "must 401 when no user");
  });

  it("requires the x-cron-secret header (403)", () => {
    const s = src();
    assert.ok(s.includes('"x-cron-secret"'), "must read the x-cron-secret header");
    assert.ok(s.includes("process.env.CRON_SECRET"), "must compare against CRON_SECRET");
    assert.ok(s.includes('"forbidden"') && s.includes("{ status: 403 }"), "must 403 on secret mismatch");
  });

  it("scopes the account lookup to the current user (user isolation)", () => {
    const s = src();
    assert.ok(
      s.includes("userId: currentUser.id"),
      "the account query must be scoped to userId: currentUser.id",
    );
  });
});

// ── Read-only — no writes ────────────────────────────────────────────────────

describe("symbol-limits-diagnostics: read-only", () => {
  it("performs no Prisma write operations", () => {
    const s = src();
    for (const writeOp of [
      ".create(",
      ".createMany(",
      ".update(",
      ".updateMany(",
      ".upsert(",
      ".delete(",
      ".deleteMany(",
    ]) {
      assert.ok(!s.includes(writeOp), `endpoint must not call ${writeOp} — it is read-only`);
    }
  });

  it("only uses read queries (findFirst / findUnique / findMany)", () => {
    const s = src();
    assert.ok(
      s.includes("prisma.connectedAccount.findFirst") &&
        s.includes("prisma.ruleChangeAudit.findFirst"),
      "endpoint must read the account and the latest audit with findFirst",
    );
  });

  it("declares readOnly: true in the safety block", () => {
    assert.ok(src().includes("readOnly: true"), "safety block must report readOnly: true");
  });
});

// ── No broker calls ───────────────────────────────────────────────────────────

describe("symbol-limits-diagnostics: no broker calls", () => {
  it("does not import or reference TradovateClient", () => {
    assert.ok(!src().includes("TradovateClient"), "endpoint must not reference TradovateClient");
  });

  it("does not call applyMaxPositionSize", () => {
    // The safety block declares applyMaxPositionSizeCalled: false — scan for a
    // call form (with paren), not the declarative field name.
    assert.ok(!src().includes("applyMaxPositionSize("), "endpoint must not call applyMaxPositionSize");
  });

  it("does not call executeDailyLossSync", () => {
    assert.ok(!src().includes("executeDailyLossSync"), "endpoint must not call executeDailyLossSync");
  });

  it("does not write a BrokerRiskSettingsSyncAudit row", () => {
    const s = src();
    // The safety block declares brokerRiskSettingsSyncAuditWritten: false —
    // scan for the writer function and the prisma write, not the field name.
    assert.ok(
      !s.includes("writeBrokerRiskSettingsSyncAudit") &&
        !s.includes("brokerRiskSettingsSyncAudit.create"),
      "endpoint must not write a BrokerRiskSettingsSyncAudit row",
    );
  });

  it("does not trigger broker sync", () => {
    const s = src();
    assert.ok(!s.includes("tradovate-sync") && !s.includes("runTradovateSync"), "endpoint must not trigger a sync");
  });
});

// ── Symbol-limits helpers ─────────────────────────────────────────────────────

describe("symbol-limits-diagnostics: uses Phase A helpers", () => {
  it("uses parseSymbolLimits and resolveSymbolLimit", () => {
    const s = src();
    assert.ok(s.includes("parseSymbolLimits"), "must use parseSymbolLimits");
    assert.ok(s.includes("resolveSymbolLimit"), "must use resolveSymbolLimit");
  });
});

// ── DEMO7433035 QA preset ─────────────────────────────────────────────────────

describe("symbol-limits-diagnostics: preset checks", () => {
  it("checks NQ=1, MNQ=10, ES=1, MES=10", () => {
    const s = src();
    assert.ok(s.includes('hasLimit("NQ", 1)'), "must check NQ=1");
    assert.ok(s.includes('hasLimit("MNQ", 10)'), "must check MNQ=10");
    assert.ok(s.includes('hasLimit("ES", 1)'), "must check ES=1");
    assert.ok(s.includes('hasLimit("MES", 10)'), "must check MES=10");
  });

  it("checks the global fallback equals 4", () => {
    assert.ok(
      src().includes("maxContracts === 4"),
      "must check the global fallback maxContracts is 4",
    );
  });

  it("exposes the expectedPresetCheck flags", () => {
    const s = src();
    for (const flag of ["hasNQ1", "hasMNQ10", "hasES1", "hasMES10", "globalFallbackIs4"]) {
      assert.ok(s.includes(flag), `response must include the ${flag} preset flag`);
    }
  });

  it("previews the evaluator for NQ, MNQ, ES, MES and CL (fallback)", () => {
    const s = src();
    for (const symbol of ["NQ", "MNQ", "ES", "MES", "CL"]) {
      assert.ok(
        s.includes(`preview("${symbol}"`),
        `evaluatorPreview must cover ${symbol}`,
      );
    }
  });

  it("returns a GO / NO_GO verdict", () => {
    const s = src();
    assert.ok(s.includes('"GO"') && s.includes('"NO_GO"'), "must return a GO/NO_GO verdict");
  });
});

// ── Eligibility section ───────────────────────────────────────────────────────

describe("symbol-limits-diagnostics: eligibility section", () => {
  it("computes eligibility via the pure deriveSymbolLimitsQaEligibility helper", () => {
    const s = src();
    assert.ok(
      s.includes("deriveSymbolLimitsQaEligibility"),
      "route must delegate eligibility logic to the pure helper",
    );
    assert.ok(
      s.includes('from "./eligibility"'),
      "route must import the eligibility helper",
    );
  });

  it("includes the eligibility section in the response", () => {
    assert.ok(/\n\s*eligibility,/.test(src()), "response must include the eligibility section");
  });

  it("reuses the shared session-trade-guard helper for signal 3", () => {
    const s = src();
    assert.ok(
      s.includes("countTradeEventsThisSession"),
      "route must reuse countTradeEventsThisSession from session-trade-guard",
    );
    assert.ok(
      !s.includes("getAccountIdsWithTradeToday") || s.includes("countTradeEventsThisSession"),
      "must not reimplement the trade-event lookup",
    );
  });

  it("reuses the CME trading-day + session-start helpers", () => {
    const s = src();
    assert.ok(s.includes("deriveCmeTradingDayKey"), "must reuse deriveCmeTradingDayKey");
    assert.ok(s.includes("getCmeSessionStartForKey"), "must reuse getCmeSessionStartForKey");
  });

  it("reads LiveSessionState read-only (findUnique, no write)", () => {
    assert.ok(
      src().includes("prisma.liveSessionState.findUnique"),
      "must read LiveSessionState with findUnique",
    );
  });

  it("verdict explains that live QA should wait when the account is not editable", () => {
    const s = src();
    assert.ok(
      s.includes("Wait until the next CME session reset") &&
        s.includes("another untraded connected demo account"),
      "verdict must tell the caller to wait for the session reset or use another account",
    );
  });

  it("does not bypass, reset, or mutate the session lock", () => {
    const s = src();
    for (const forbidden of [
      "liveSessionState.update",
      "liveSessionState.upsert",
      "liveSessionState.delete",
      "reset-session-state",
    ]) {
      assert.ok(!s.includes(forbidden), `endpoint must not touch the session lock (${forbidden})`);
    }
  });
});

// ── session-trade-guard count helper ─────────────────────────────────────────

describe("countTradeEventsThisSession (session-trade-guard)", () => {
  const GUARD = resolve(import.meta.dirname, "../../../../lib/rules/session-trade-guard.ts");

  it("is a read-only count query reusing TRADE_EVENT_TYPES", () => {
    const s = readFileSync(GUARD, "utf8");
    assert.ok(s.includes("countTradeEventsThisSession"), "helper must exist");
    const fnIdx = s.indexOf("export async function countTradeEventsThisSession");
    assert.ok(fnIdx !== -1, "helper must be exported");
    const body = s.slice(fnIdx, fnIdx + 400);
    assert.ok(body.includes(".count("), "must use prisma .count() — read-only");
    assert.ok(body.includes("TRADE_EVENT_TYPES"), "must reuse the shared TRADE_EVENT_TYPES filter");
    for (const writeOp of [".create(", ".update(", ".upsert(", ".delete("]) {
      assert.ok(!body.includes(writeOp), `count helper must not ${writeOp}`);
    }
  });
});
