/**
 * Contract tests for the Dashboard per-account "Manage" menu and its wiring
 * into the command center.
 *
 * Source-scan approach — verifies the account-management UX invariants:
 *   - account cards/rows expose Manage rules + View trades + Manage account
 *   - the menu holds ONLY account-level actions (no broker/service diagnostics)
 *   - "Remove from Guardrail" reuses the existing guarded archive flow and never
 *     deletes historical data or bypasses the scheduled-removal guard
 *   - Settings stays simplified; the dashboard sidebar stays active-only
 */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const HERE = import.meta.dirname;
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..", "..");

const MENU = readFileSync(join(HERE, "account-manage-menu.tsx"), "utf8");
const COMMAND_CENTER = readFileSync(join(HERE, "command-center.tsx"), "utf8");
const DATA_HELPERS = readFileSync(join(HERE, "data-helpers.ts"), "utf8");

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

// ── 1. Dashboard cards expose account-level actions ───────────────────────────

describe("Dashboard account menu exposes account-level actions", () => {
  test("menu links Manage rules to /rules?scope=account&id=", () => {
    assert.ok(MENU.includes("Manage rules"), "menu must offer 'Manage rules'");
    assert.ok(
      MENU.includes("deriveRulesHref(accountId)"),
      "Manage rules must use deriveRulesHref (=/rules?scope=account&id=<id>)",
    );
  });

  test("menu links View trades to /trades?accountId=", () => {
    assert.ok(MENU.includes("View trades"), "menu must offer 'View trades'");
    assert.ok(
      MENU.includes("deriveTradesHref(accountId)"),
      "View trades must use deriveTradesHref (=/trades?accountId=<id>)",
    );
  });

  test("menu offers an account detail link (Manage account)", () => {
    assert.ok(MENU.includes("Account details"), "menu must offer an account detail entry");
    assert.ok(
      MENU.includes("deriveOpenHref(accountId)"),
      "Account details must use deriveOpenHref",
    );
  });

  test("deriveTradesHref produces /trades?accountId=<id>", () => {
    assert.ok(
      /deriveTradesHref[\s\S]*?\/trades\?accountId=\$\{accountId\}/.test(DATA_HELPERS),
      "deriveTradesHref must return /trades?accountId=<id>",
    );
  });

  test("command center renders AccountManageMenu in both desktop row and mobile card", () => {
    assert.ok(
      COMMAND_CENTER.includes("import { AccountManageMenu }"),
      "command center must import AccountManageMenu",
    );
    // One usage in AccountActions (desktop), one in AccountCard (mobile).
    const count = (COMMAND_CENTER.match(/<AccountManageMenu/g) ?? []).length;
    assert.ok(count >= 2, `AccountManageMenu must render in both row and card (found ${count})`);
  });

  test("each rendered menu passes the account id so every active account gets actions", () => {
    // The Manage menu is the single entry point for account-level actions
    // (the duplicate inline "Rules" link was removed). Every usage must pass
    // the per-account id so the menu links resolve to that account.
    assert.ok(
      COMMAND_CENTER.includes("accountId={account.id}"),
      "AccountManageMenu must receive each account's id",
    );
  });

  test("inline Rules quick link was removed — no duplicate of the menu's Manage rules", () => {
    // QA decision: the inline <Link>Rules</Link> duplicated the menu's
    // "Manage rules" item, so it was removed in favor of the single Manage menu.
    assert.ok(
      !/>\s*Rules\s*</.test(COMMAND_CENTER),
      "command center must not render a standalone inline 'Rules' link",
    );
  });

  test("menu alignment is overflow-safe (left on mobile card, right on desktop row)", () => {
    // The command-center section is overflow-x-hidden; the dropdown must expand
    // into the card, never past it.
    assert.ok(COMMAND_CENTER.includes('align="left"'), "mobile card must anchor the menu left");
    assert.ok(COMMAND_CENTER.includes('align="right"'), "desktop row must anchor the menu right");
    assert.ok(
      MENU.includes('align === "left" ? "left-0" : "right-0"'),
      "menu must switch anchor edge based on align",
    );
  });
});

// ── 2. Menu holds only account-level actions (no service/diagnostics) ─────────

describe("Manage menu is account-level only", () => {
  test("menu does not expose broker connection / service-level actions", () => {
    const src = stripComments(MENU);
    assert.ok(!src.includes("Disconnect connection"), "no broker connection disconnect here");
    assert.ok(!src.includes("Reconnect"), "no broker reconnect here (service-level lives elsewhere)");
    assert.ok(!src.includes("/api/broker-connections"), "must not call broker-connection endpoints");
  });

  test("menu shows no broker technical diagnostics", () => {
    const src = stripComments(MENU);
    for (const term of [
      "tokenExpiresAt",
      "brokerUserId",
      "lastReconciliation",
      "Token expires",
      "Not yet synced",
      "Can discover",
      "connectionStatus",
    ]) {
      assert.ok(!src.includes(term), `menu must not surface '${term}'`);
    }
  });
});

// ── 3. Removal uses the existing guarded archive flow only ────────────────────

describe("Remove from Guardrail reuses the guarded archive flow", () => {
  test("menu offers 'Remove from Guardrail' behind a confirm step", () => {
    assert.ok(MENU.includes("Remove from Guardrail"), "menu must offer remove");
    assert.ok(MENU.includes("confirmingRemove"), "remove must require a confirm step");
  });

  test("removal calls buildArchiveRequest + parseArchiveResponse (the guarded flow)", () => {
    assert.ok(
      MENU.includes("buildArchiveRequest") && MENU.includes("parseArchiveResponse"),
      "removal must reuse the shared archive helpers",
    );
  });

  test("buildArchiveRequest targets the guarded protection endpoint with archived", () => {
    const helpers = readFileSync(join(HERE, "archive-account-helpers.ts"), "utf8");
    assert.ok(
      helpers.includes("/api/accounts/${accountId}/protection"),
      "archive must POST to the protection endpoint (which enforces the removal guard)",
    );
    assert.ok(
      helpers.includes('protectionStatus: "archived"'),
      "archive must send protectionStatus: archived",
    );
  });

  test("menu honors deferred archive (applied=false) — does not force removal", () => {
    // parseArchiveResponse returns success:false when applied=false; the menu
    // surfaces that as an error instead of removing the row, so a locked account
    // cannot be archived immediately from here.
    const helpers = readFileSync(join(HERE, "archive-account-helpers.ts"), "utf8");
    assert.ok(
      helpers.includes("applied") && helpers.includes("deferred"),
      "archive parser must treat applied=false as a deferred (guarded) outcome",
    );
  });

  test("menu never deletes historical data or uses DELETE", () => {
    const src = stripComments(MENU);
    assert.ok(!/method:\s*["']DELETE["']/.test(src), "menu must not issue DELETE requests");
    for (const table of [
      "normalizedTradeEvent",
      "accountRiskRules",
      "internalLockEvent",
      "guardianStatus",
      "brokerOrderActionLog",
      "ruleChangeAudit",
    ]) {
      assert.ok(!src.includes(table), `menu must not reference historical table ${table}`);
    }
  });

  test("canRemove prop allows hiding remove where unsafe/unsupported", () => {
    assert.ok(MENU.includes("canRemove"), "menu must support a canRemove gate");
  });
});

// ── 4. Settings stays simplified (no regression) ──────────────────────────────

describe("Settings does not regain technical fields", () => {
  const SECTION = stripComments(
    readFileSync(
      join(REPO_ROOT, "src", "app", "settings", "_components", "broker-connections-section.tsx"),
      "utf8",
    ),
  );
  for (const term of ["Token expires", "tokenExpiresAt", "Not yet synced", "Can discover", "brokerUserId"]) {
    test(`settings broker section still hides '${term}'`, () => {
      assert.ok(!SECTION.includes(term), `settings must not show '${term}'`);
    });
  }
});

// ── 5. Dashboard sidebar remains active accounts only ─────────────────────────

describe("Dashboard sidebar stays active-only", () => {
  test("dashboard sidebar uses the active-account partition", () => {
    const page = readFileSync(join(REPO_ROOT, "src", "app", "dashboard", "page.tsx"), "utf8");
    assert.ok(
      page.includes("partitionAccountsByActive") && page.includes("activeAccounts"),
      "dashboard sidebar must derive from partitionAccountsByActive(active)",
    );
  });
});
