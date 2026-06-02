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
const LOCKOUT = readFileSync(join(HERE, "account-lockout.tsx"), "utf8");

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

  test("menu dropdown portals out so overflow containers cannot clip it", () => {
    // The Dashboard account strip is overflowX:auto (which coerces overflow-y to
    // auto too), so an in-flow absolute dropdown would be clipped. The dropdown
    // must render through a portal anchored to the trigger's bounding rect.
    assert.ok(COMMAND_CENTER.includes('align="left"'), "mobile card must anchor the menu left");
    assert.ok(COMMAND_CENTER.includes('align="right"'), "desktop row must anchor the menu right");
    assert.ok(MENU.includes("createPortal"), "dropdown must portal out so overflow containers can't clip it");
    assert.ok(MENU.includes("getBoundingClientRect"), "dropdown must anchor to the trigger's bounding rect");
    assert.ok(MENU.includes('align === "left"'), "menu must switch anchor edge based on align");
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

// ── 4b. Manual session lockout action ─────────────────────────────────────────

describe("Lock for this CME session", () => {
  test("menu offers 'Lock for this CME session' item", () => {
    assert.ok(
      MENU.includes("Lock for this CME session"),
      "menu must offer 'Lock for this CME session'",
    );
  });

  test("lock action calls POST /api/accounts/:id/lockout (single shared impl, not a broker endpoint)", () => {
    // The fetch lives once, in the shared account-lockout module.
    assert.ok(
      LOCKOUT.includes("/api/accounts/${accountId}/lockout"),
      "shared lockout must POST to /api/accounts/:id/lockout",
    );
    assert.ok(LOCKOUT.includes('method: "POST"'), "lock must use POST");
    // The menu must NOT contain its own fetch — it delegates to useLockout.
    assert.ok(
      !MENU.includes("/api/accounts/${accountId}/lockout"),
      "menu must not re-implement the lockout fetch — it must reuse the shared action",
    );
    assert.ok(
      !LOCKOUT.includes("/api/broker-connections"),
      "lock must not call broker-connection endpoints",
    );
  });

  test("only one POST implementation of the lockout exists (no duplication)", () => {
    const occurrences = (
      (MENU + COMMAND_CENTER + LOCKOUT).match(/\/api\/accounts\/\$\{accountId\}\/lockout/g) ?? []
    ).length;
    assert.equal(occurrences, 1, "the lockout POST must be implemented exactly once (shared module)");
  });

  test("menu reuses the shared useLockout + LockoutConfirmModal", () => {
    assert.ok(MENU.includes("useLockout"), "menu must call the shared useLockout hook");
    assert.ok(MENU.includes("LockoutConfirmModal"), "menu must render the shared LockoutConfirmModal");
  });

  test("shared confirmation dialog has danger badge + confirm/loading", () => {
    assert.ok(MENU.includes("showLockConfirm"), "menu must gate the modal on showLockConfirm state");
    assert.ok(LOCKOUT.includes("data-lock-confirm"), "dialog must have data-lock-confirm attribute for testing");
    assert.ok(LOCKOUT.includes("Danger"), "dialog must show a Danger badge");
    assert.ok(LOCKOUT.includes("Yes, lock this account"), "confirm button must say 'Yes, lock this account'");
    assert.ok(LOCKOUT.includes('busy ? "Locking…"'), "confirm button must show loading state");
  });

  test("shared lock modal shows the session-reset caveat copy", () => {
    assert.ok(
      LOCKOUT.includes("This account is locked or has rule activity today"),
      "dialog must include the session-lock caveat",
    );
    assert.ok(LOCKOUT.includes("17:00"), "dialog must mention 17:00 CT session reset time");
  });

  test("canLock prop hides the lock item when account is already locked", () => {
    assert.ok(
      MENU.includes("canLock"),
      "menu must support canLock prop to hide the item when already locked",
    );
  });

  test("lock does not delete or reference historical data tables", () => {
    const src = stripComments(MENU) + stripComments(LOCKOUT);
    for (const table of [
      "normalizedTradeEvent",
      "accountRiskRules",
      "internalLockEvent",
      "guardianStatus",
      "brokerOrderActionLog",
      "ruleChangeAudit",
    ]) {
      assert.ok(!src.includes(table), `lock must not reference table ${table}`);
    }
  });

  test("command center passes canLock based on account status", () => {
    assert.ok(
      COMMAND_CENTER.includes("canLock={account.status !== \"locked\"}"),
      "command-center must pass canLock=false when account is already locked",
    );
  });
});

// ── 4c. Direct, always-visible Lockout button on dashboard cards ──────────────

describe("Dashboard direct Lockout button (page.tsx + AccountLockoutButton)", () => {
  const PAGE = readFileSync(join(REPO_ROOT, "src", "app", "dashboard", "page.tsx"), "utf8");

  test("page imports + renders AccountLockoutButton inside the active-account card map", () => {
    assert.ok(PAGE.includes("import { AccountLockoutButton }"), "page must import AccountLockoutButton");
    const mapIdx = PAGE.indexOf("activeAccounts.map");
    const btnIdx = PAGE.indexOf("<AccountLockoutButton", mapIdx);
    assert.ok(mapIdx > -1 && btnIdx > -1, "AccountLockoutButton must render inside activeAccounts.map");
    assert.ok(PAGE.includes("accountId={acc.id}"), "button must receive the account id");
  });

  test("direct button renders a visible 'Lockout' label (not hover-only / hidden / sr-only)", () => {
    assert.ok(/Lockout/.test(LOCKOUT), "button must render the text 'Lockout'");
    // Default button style must be always-visible.
    const cls = LOCKOUT.match(/className=\{[\s\S]*?inline-flex h-10[\s\S]*?\}/)?.[0] ?? LOCKOUT;
    for (const banned of ["hidden", "opacity-0", "group-hover", "sr-only", "invisible"]) {
      assert.ok(!cls.includes(banned), `Lockout button must be always-visible — found '${banned}'`);
    }
  });

  test("direct button is danger-styled (solid red pill, white text, press effect)", () => {
    assert.ok(/text-white/.test(LOCKOUT), "Lockout button must use white text (solid red style)");
    assert.ok(/bg-red-[56]00/.test(LOCKOUT), "Lockout button must use solid red background (bg-red-500 or bg-red-600)");
    assert.ok(/rounded-full/.test(LOCKOUT), "Lockout button must be pill-shaped (rounded-full)");
    assert.ok(/active:scale-\[0\.97\]/.test(LOCKOUT), "Lockout button must have subtle active press scale effect");
  });

  test("direct button includes a lock icon (SVG)", () => {
    assert.ok(/<svg[\s\S]*?<\/svg>/.test(LOCKOUT), "Lockout button must include an SVG lock icon");
  });

  test("direct button is rendered above the full-card selection overlay (zIndex group)", () => {
    assert.ok(
      /zIndex:\s*5[\s\S]{0,2500}<AccountLockoutButton/.test(PAGE),
      "the Lockout button must live inside the raised zIndex group so it is clickable above the overlay",
    );
  });

  test("direct button is shown only for allowed/warning (manageable, not locked) accounts", () => {
    assert.ok(
      /\(acc\.status === "allowed" \|\| acc\.status === "warning"\) && \(\s*<AccountLockoutButton/.test(PAGE),
      "Lockout button must be gated on allowed/warning status",
    );
  });

  test("locked accounts do not render the direct Lockout button", () => {
    // The only gate is allowed/warning, which excludes 'locked' by construction.
    const gate = PAGE.match(/\(acc\.status === "allowed" \|\| acc\.status === "warning"\) && \(\s*<AccountLockoutButton/);
    assert.ok(gate, "gate must exist");
    assert.ok(!gate![0].includes('"locked"'), "the Lockout gate must never include the locked status");
  });

  test("existing ⋯ menu lock item still exists alongside the direct button", () => {
    assert.ok(MENU.includes("Lock for this CME session"), "the ⋯ menu lock item must remain");
    assert.ok(PAGE.includes("<AccountManageMenu"), "the ⋯ menu must still render on cards");
  });

  test("both the direct button and the menu reuse the same shared action", () => {
    assert.ok(LOCKOUT.includes("export function AccountLockoutButton"), "shared button exported");
    assert.ok(LOCKOUT.includes("export function useLockout"), "shared hook exported");
    assert.ok(LOCKOUT.includes("export function LockoutConfirmModal"), "shared modal exported");
    assert.ok(MENU.includes("useLockout") && MENU.includes("LockoutConfirmModal"), "menu uses the shared action");
  });

  test("shared lockout introduces no broker / Tradovate write endpoints", () => {
    const src = stripComments(LOCKOUT);
    for (const banned of ["/api/broker", "tradovate", "cancelOrder", "flattenPositions", "userAccountAutoLiq", "placeOrder"]) {
      assert.ok(!src.includes(banned), `shared lockout must not reference '${banned}'`);
    }
  });
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

// ── 6. Production dashboard account cards expose the manage menu ───────────────
//
// Regression guard for the QA finding that the manage menu was only wired into
// the demo-only <CommandCenter> sample, so production account cards (rendered
// inline in page.tsx) had no menu trigger — making "Lock for this CME session"
// unreachable.

describe("Dashboard account cards (page.tsx) render the manage menu", () => {
  const PAGE = readFileSync(join(REPO_ROOT, "src", "app", "dashboard", "page.tsx"), "utf8");

  test("page imports AccountManageMenu", () => {
    assert.ok(
      PAGE.includes('import { AccountManageMenu }'),
      "page.tsx must import AccountManageMenu so production cards can render it",
    );
  });

  test("page renders AccountManageMenu inside the active-accounts card map", () => {
    const mapIdx = PAGE.indexOf("activeAccounts.map");
    const menuIdx = PAGE.indexOf("<AccountManageMenu", mapIdx);
    assert.ok(mapIdx > -1, "page must map over activeAccounts to render cards");
    assert.ok(
      menuIdx > -1,
      "AccountManageMenu must be rendered for every active account card (inside activeAccounts.map)",
    );
  });

  test("each card menu receives the per-account id and label", () => {
    assert.ok(PAGE.includes("accountId={acc.id}"), "card menu must receive the account id");
    assert.ok(PAGE.includes("accountLabel={acc.label}"), "card menu must receive the account label");
  });

  test("card menu uses a visible three-dot trigger (not hover-only / not hidden)", () => {
    const menuIdx = PAGE.indexOf("<AccountManageMenu");
    const block = PAGE.slice(menuIdx, menuIdx + 600);
    // The trigger must show the ⋯ glyph.
    assert.ok(block.includes('triggerLabel="⋯"'), "card menu must use a ⋯ three-dot trigger");
    // The trigger className must not hide it or gate it behind hover.
    const classMatch = block.match(/buttonClassName="([^"]*)"/);
    assert.ok(classMatch, "card menu must set an explicit trigger className");
    const cls = classMatch![1];
    for (const banned of ["hidden", "opacity-0", "group-hover", "sr-only", "invisible"]) {
      assert.ok(!cls.includes(banned), `three-dot trigger must be always-visible — found '${banned}'`);
    }
  });

  test("lock item is gated on a manageable, non-locked status", () => {
    const menuIdx = PAGE.indexOf("<AccountManageMenu");
    const block = PAGE.slice(menuIdx, menuIdx + 600);
    assert.ok(
      block.includes('canLock={acc.status === "allowed" || acc.status === "warning"}'),
      "card menu canLock must be true only for allowed/warning (manageable, not locked) accounts",
    );
  });

  test("menu group is stacked above the full-card selection overlay (zIndex)", () => {
    // The card has a full-card <Link> overlay (absolute inset:0) for selection.
    // The menu wrapper must sit above it so the trigger is clickable.
    assert.ok(
      /zIndex:\s*5[\s\S]{0,2500}<AccountManageMenu/.test(PAGE),
      "the menu wrapper must use a raised zIndex so it is clickable above the selection overlay",
    );
  });

  test("the lock action text is available in the menu when canLock is true", () => {
    assert.ok(
      MENU.includes("Lock for this CME session"),
      "the menu must render the lock action so it is reachable from the card",
    );
  });
});
