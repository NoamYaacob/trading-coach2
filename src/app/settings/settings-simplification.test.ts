/**
 * Settings simplification contract tests.
 *
 * Verifies that normal Settings is user-facing and simple, while the admin-only
 * /debug/broker-accounts page retains the full technical diagnostics.
 *
 * Source-scan approach — no database or rendering required.
 */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(rel: string): string {
  return readFileSync(resolve(import.meta.dirname, rel), "utf8");
}

function readNoComments(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

// ── A. Telegram disconnect ────────────────────────────────────────────────────

describe("A. Telegram disconnect", () => {
  const COMPONENT = "./_components/telegram-connection.tsx";
  const ROUTE = "../api/telegram/disconnect/route.ts";

  test("connected state shows a 'Disconnect Telegram' button", () => {
    const src = read(COMPONENT);
    assert.ok(src.includes("Disconnect Telegram"), "connected state must offer disconnect");
  });

  test("disconnect button calls POST /api/telegram/disconnect", () => {
    const src = read(COMPONENT);
    assert.ok(
      src.includes("/api/telegram/disconnect"),
      "component must call the disconnect endpoint",
    );
    assert.ok(src.includes('method: "POST"'), "disconnect must use POST");
  });

  test("disconnect refreshes the page after success", () => {
    const src = read(COMPONENT);
    assert.ok(src.includes("router.refresh()"), "must refresh after disconnect");
  });

  test("disconnect endpoint exists and requires authentication", () => {
    const src = read(ROUTE);
    assert.ok(src.includes("export async function POST"), "route must export POST");
    assert.ok(src.includes("getCurrentUser"), "route must authenticate");
    assert.ok(src.includes("status: 401"), "route must reject unauthenticated requests");
  });

  test("disconnect only removes telegram rows — not broker/rules/trading data", () => {
    const src = readNoComments(ROUTE);
    assert.ok(src.includes("telegramConnection.deleteMany"), "must remove the telegram connection");
    // Must NOT touch any trading/broker/rule/audit tables.
    for (const table of [
      "connectedAccount",
      "brokerConnection",
      "riskRules",
      "accountRiskRules",
      "normalizedTradeEvent",
      "internalLockEvent",
      "guardianStatus",
      "brokerOrderActionLog",
      "ruleChangeAudit",
    ]) {
      assert.ok(
        !new RegExp(`prisma\\.${table}\\.`).test(src),
        `telegram disconnect must not touch prisma.${table}`,
      );
    }
  });

  test("disconnect scopes deletes to the current user", () => {
    const src = read(ROUTE);
    assert.ok(
      src.includes("userId: currentUser.id"),
      "disconnect must scope deletes to the authenticated user",
    );
  });
});

// ── B. Plan & Billing ─────────────────────────────────────────────────────────

describe("B. Plan & Billing", () => {
  const PLAN = "./_components/plan-billing.tsx";
  const PAGE = "./page.tsx";

  test("settings renders a Plan & Billing section", () => {
    assert.ok(read(PAGE).includes("Plan & Billing"), "must render Plan & Billing section");
    assert.ok(read(PAGE).includes("PlanBilling"), "must render the PlanBilling component");
  });

  test("plan component shows current plan status", () => {
    const src = read(PLAN);
    assert.ok(src.includes("Current plan"), "must show current plan");
    assert.ok(src.includes("Trial active"), "must render a friendly trial label");
  });

  test("plan CTA is honest — routes to /pricing, no fake billing portal", () => {
    assert.ok(read(PLAN).includes("/pricing"), "CTA must route to /pricing");
    assert.ok(read(PLAN).includes("View plans"), "CTA must be labelled 'View plans'");
    // Strip comments — the doc comment legitimately mentions "Stripe" to explain
    // why the CTA is honest. Only the rendered code must avoid faking a portal.
    const code = readNoComments(PLAN);
    assert.ok(
      !/stripe/i.test(code) && !code.includes("billingPortal"),
      "must not fake a Stripe/billing portal in rendered code",
    );
  });
});

// ── C. Simplified broker connections (normal Settings) ────────────────────────

describe("C. Broker connections — simplified normal Settings", () => {
  const SECTION = "./_components/broker-connections-section.tsx";

  test("does not render 'Token expires'", () => {
    assert.ok(!readNoComments(SECTION).includes("Token expires"));
  });

  test("does not render 'Not yet synced'", () => {
    assert.ok(!readNoComments(SECTION).includes("Not yet synced"));
  });

  test("does not render 'Can discover new accounts'", () => {
    assert.ok(!readNoComments(SECTION).includes("Can discover"));
  });

  test("does not render 'Tradovate user: (not yet populated)'", () => {
    const src = readNoComments(SECTION);
    assert.ok(!src.includes("Tradovate user"));
    assert.ok(!src.includes("not yet populated"));
  });

  test("shows a user-facing status (Connected / Reconnect required / Needs reconnect)", () => {
    const src = read(SECTION);
    assert.ok(src.includes('"Connected"'));
    assert.ok(src.includes('"Reconnect required"'));
    assert.ok(src.includes('"Needs reconnect"'));
  });
});

// ── D. Debug page retains technical diagnostics ───────────────────────────────

describe("D. Debug page keeps full technical diagnostics", () => {
  const DEBUG = "../debug/broker-accounts/page.tsx";

  test("debug page still selects/renders tokenExpiresAt", () => {
    assert.ok(read(DEBUG).includes("tokenExpiresAt"), "debug page must keep tokenExpiresAt");
  });

  test("debug page still selects/renders brokerUserId", () => {
    assert.ok(read(DEBUG).includes("brokerUserId"), "debug page must keep brokerUserId");
  });

  test("debug page still selects/renders lastReconciliation diagnostics", () => {
    assert.ok(read(DEBUG).includes("lastReconciliation"), "debug page must keep lastReconciliation*");
  });

  test("debug page still exists (not deleted)", () => {
    assert.ok(read(DEBUG).length > 0, "debug page must not be deleted");
  });
});

// ── E. Discovery helper — user-friendly ───────────────────────────────────────

describe("E. 'Why don't I see my new account?' helper", () => {
  const HELPER = "./_components/account-discovery-helper.tsx";

  test("keeps the Run sync now action", () => {
    const src = read(HELPER);
    assert.ok(src.includes("Run sync now"), "must keep 'Run sync now'");
    assert.ok(src.includes("/api/accounts/sync-all"), "must POST to sync-all");
  });

  test("covers the five user-facing reasons", () => {
    const src = read(HELPER);
    assert.ok(src.includes("Wrong Tradovate login") || src.includes("Wrong Tradovate"), "wrong login");
    assert.ok(src.includes("Live vs Demo") || src.includes("Demo connection only"), "live/demo mismatch");
    assert.ok(src.includes("reconnect"), "reconnect");
    assert.ok(src.includes("activated"), "prop firm activation");
    assert.ok(src.includes("New account needs setup"), "appears as needs setup");
  });

  test("drops the most technical jargon (active=false code, OAuth token)", () => {
    const src = read(HELPER);
    assert.ok(!src.includes("active=false"), "must not show raw active=false code");
    assert.ok(!src.includes("OAuth token"), "must not surface OAuth token jargon");
  });
});
