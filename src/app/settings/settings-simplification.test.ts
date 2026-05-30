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

// ── F. Settings section hierarchy ─────────────────────────────────────────────

describe("F. Settings section order for a normal user", () => {
  const PAGE = read("./page.tsx");

  // Index of each section's SectionCard title (or heading) in source order.
  function pos(label: string): number {
    const i = PAGE.indexOf(label);
    assert.ok(i !== -1, `section "${label}" must be present`);
    return i;
  }

  test("sections appear in the order Account → Plan & Billing → Broker connections → Alerts & Telegram → Security → Danger zone", () => {
    const account = pos('title="Account"');
    const plan = pos('title="Plan & Billing"');
    const broker = pos('title="Broker connections"');
    const alerts = pos('title="Alerts & Telegram"');
    const security = pos('title="Security"');
    const danger = pos("Danger zone");

    assert.ok(account < plan, "Account before Plan & Billing");
    assert.ok(plan < broker, "Plan & Billing before Broker connections");
    assert.ok(broker < alerts, "Broker connections before Alerts & Telegram");
    assert.ok(alerts < security, "Alerts & Telegram before Security");
    assert.ok(security < danger, "Security before Danger zone");
  });

  test("Broker connections appears before the Telegram alerts section and Security", () => {
    const broker = pos('title="Broker connections"');
    const alerts = pos('title="Alerts & Telegram"');
    const security = pos('title="Security"');
    assert.ok(broker < alerts, "Broker connections must come before the Alerts & Telegram section");
    assert.ok(broker < security, "Broker connections must come before Security");
  });
});

describe("F. Product status is hidden from the main Settings flow", () => {
  const PAGE = read("./page.tsx");

  test("Product status is not a top-level Settings section", () => {
    // It must not be rendered as its own SectionCard.
    assert.ok(
      !PAGE.includes('title="Product status"') && !PAGE.includes('title="Connections"'),
      "Product status / Connections must not be a top-level section",
    );
  });

  test("Product status lives inside a collapsed Advanced <details> (hidden by default)", () => {
    // Anchor on the unique ProductStatusPanel render (the literal word
    // "Advanced" also appears as a humanizeExperience return value).
    const panelIdx = PAGE.indexOf("<ProductStatusPanel");
    assert.ok(panelIdx !== -1, "must still render ProductStatusPanel");
    const detailsBefore = PAGE.lastIndexOf("<details", panelIdx);
    assert.ok(detailsBefore !== -1, "ProductStatusPanel must be inside a <details>");
    // The enclosing <details> opening tag must NOT have `open` → collapsed by default.
    const openTag = PAGE.slice(detailsBefore, PAGE.indexOf(">", detailsBefore));
    assert.ok(!/\bopen\b/.test(openTag), "Advanced <details> must not be open by default");
    // The "Advanced" summary label must sit between that <details> and the panel.
    const advancedSummary = PAGE.indexOf("Advanced", detailsBefore);
    assert.ok(
      advancedSummary !== -1 && advancedSummary < panelIdx,
      "the Advanced summary must precede the product status content",
    );
  });

  test("Advanced/Product status sits near the bottom — after Security, before Danger zone", () => {
    const security = PAGE.indexOf('title="Security"');
    const panel = PAGE.indexOf("<ProductStatusPanel");
    const danger = PAGE.indexOf("Danger zone");
    assert.ok(security < panel, "Product status panel must come after Security");
    assert.ok(panel < danger, "Product status panel must come before Danger zone");
  });
});

// ── G. Broker card: friendly identity + collapsed accounts ────────────────────

describe("G. Broker card friendly identity and account list", () => {
  const SECTION = read("./_components/broker-connections-section.tsx");

  test("connection card shows a friendly identity, not just 'Tradovate'", () => {
    assert.ok(
      SECTION.includes("deriveConnectionIdentity(") && SECTION.includes("{identity}"),
      "card must render a derived friendly identity (provider + env + firm/type)",
    );
  });

  test("linked accounts are collapsed by default behind Show/Hide accounts", () => {
    assert.ok(SECTION.includes("Show accounts"), "must offer 'Show accounts'");
    assert.ok(SECTION.includes("Hide accounts"), "must offer 'Hide accounts'");
    // Native <details> => collapsed by default (no `open` on the accounts list).
    assert.ok(SECTION.includes("<details"), "accounts must live in a <details>");
  });

  test("each account row shows a friendly label and account-level actions", () => {
    assert.ok(SECTION.includes("LinkedAccountRow"), "must render per-account rows");
    assert.ok(SECTION.includes("deriveAccountDisplayLabel(acct)"), "rows must use the friendly label");
    assert.ok(SECTION.includes("Manage rules"), "row must offer Manage rules");
    assert.ok(SECTION.includes("View trades"), "row must offer View trades");
    assert.ok(SECTION.includes("RemoveAccountButton"), "row must offer Remove via the guarded flow");
  });

  test("per-account Remove uses the guarded archive flow (no DELETE)", () => {
    // RemoveAccountButton POSTs protectionStatus=archived to the protection
    // endpoint; it must never issue a DELETE for account removal.
    const removeBtn = read("./_components/remove-account-button.tsx");
    assert.ok(removeBtn.includes("/api/accounts/") && removeBtn.includes("protection"), "must hit protection endpoint");
    assert.ok(removeBtn.includes('"archived"'), "must send protectionStatus archived");
    assert.ok(
      !/method:\s*["']DELETE["']/.test(removeBtn),
      "account removal must not use DELETE",
    );
  });

  test("friendly label is used (does not surface a raw label-only fallback for firm accounts)", () => {
    const SECTION_NO_COMMENTS = readNoComments("./_components/broker-connections-section.tsx");
    // The card must route account naming through the shared helper, not print
    // acct.label directly in the trading-account rows.
    assert.ok(
      SECTION_NO_COMMENTS.includes("deriveAccountDisplayLabel"),
      "card must use deriveAccountDisplayLabel for account naming",
    );
  });

  test("archived accounts stay in their own collapsed list", () => {
    assert.ok(
      SECTION.includes("archived account(s) under this connection"),
      "archived accounts must remain in a separate collapsed list",
    );
  });
});

// ── H. Friendly account labels across surfaces + schema ───────────────────────

describe("H. displayName field + friendly labels", () => {
  const REPO = resolve(import.meta.dirname, "..", "..", "..");

  test("ConnectedAccount schema has a displayName field", () => {
    const schema = readFileSync(resolve(REPO, "prisma", "schema.prisma"), "utf8");
    const model = schema.slice(
      schema.indexOf("model ConnectedAccount"),
      schema.indexOf("}", schema.indexOf("model ConnectedAccount")),
    );
    assert.ok(/displayName\s+String\?/.test(model), "ConnectedAccount must declare displayName String?");
  });

  test("a migration adds the displayName column", () => {
    const dir = resolve(REPO, "prisma", "migrations", "20260530000000_add_display_name_to_connected_account");
    const sql = readFileSync(resolve(dir, "migration.sql"), "utf8");
    assert.ok(
      /ALTER TABLE "ConnectedAccount" ADD COLUMN "displayName"/.test(sql),
      "migration must add the displayName column",
    );
  });

  test("PATCH /api/accounts/[id] accepts displayName and clears blank to null", () => {
    const route = readFileSync(resolve(REPO, "src", "app", "api", "accounts", "[id]", "route.ts"), "utf8");
    assert.ok(route.includes("displayName"), "PATCH must accept displayName");
    assert.ok(route.includes("displayName?.trim() || null"), "blank displayName must clear to null");
  });

  test("settings query selects displayName / propFirm / accountType for friendly labels", () => {
    const page = readFileSync(resolve(REPO, "src", "app", "settings", "page.tsx"), "utf8");
    assert.ok(page.includes("displayName: true"), "settings must select displayName");
    assert.ok(page.includes("propFirm: true"), "settings must select propFirm");
    assert.ok(page.includes("accountType: true"), "settings must select accountType");
  });

  test("settings sidebar uses the friendly label, not the raw broker label", () => {
    const page = readFileSync(resolve(REPO, "src", "app", "settings", "page.tsx"), "utf8");
    assert.ok(
      page.includes("deriveAccountDisplayLabel(acc)"),
      "sidebar must render the friendly label",
    );
  });
});
