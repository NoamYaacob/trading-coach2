/**
 * Copy and structure tests for the SIMPLIFIED broker connections section.
 *
 * Normal Settings shows only user-facing information. Technical/diagnostic
 * fields live exclusively on the admin-only /debug/broker-accounts page.
 *
 * Layout:
 *   - Explanation block
 *   - Live connections (BrokerConnectionCard per connection)
 *   - Demo connections (BrokerConnectionCard per connection)
 *   - New — needs setup (pending_decision accounts)
 *   - Archived / inactive (missing from broker)
 *   - AccountDiscoveryHelper ("Why don't I see my new account?")
 */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SECTION_FILE = resolve(import.meta.dirname, "broker-connections-section.tsx");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/** Read a source file with comments stripped — assertions about what the UI
 *  *renders* must ignore explanatory comments that mention removed field names. */
function readNoComments(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function cardSource(): string {
  const src = read(SECTION_FILE);
  const cardStart = src.indexOf("function BrokerConnectionCard");
  const cardEnd = src.indexOf("\nfunction ", cardStart + 1);
  return src.slice(cardStart, cardEnd);
}

/** Source of just the LinkedAccountRow function (the per-account action row). */
function rowSource(): string {
  const src = read(SECTION_FILE);
  const start = src.indexOf("function LinkedAccountRow");
  const end = src.indexOf("\nfunction ", start + 1);
  return src.slice(start, end === -1 ? undefined : end);
}

// ── User-facing card content ──────────────────────────────────────────────────

describe("BrokerConnectionCard — user-facing content only", () => {
  test("BrokerConnectionCard is defined in the component file", () => {
    assert.ok(read(SECTION_FILE).includes("BrokerConnectionCard"));
  });

  test("card shows env badge (Live / Demo)", () => {
    assert.ok(cardSource().includes("envLabel(conn.env)"), "card must display env via envLabel");
  });

  test("card shows provider name (Tradovate)", () => {
    assert.ok(
      cardSource().includes("platformLabel(conn.platform)"),
      "card must show the provider via platformLabel",
    );
  });

  test("card shows a single user-facing status label", () => {
    assert.ok(
      cardSource().includes("userFacingStatus(conn.connectionStatus)"),
      "card must map connectionStatus to a single user-facing status",
    );
  });

  test("card shows a friendly connection identity (provider + env + firm/type)", () => {
    const card = cardSource();
    assert.ok(
      card.includes("deriveConnectionIdentity("),
      "card must derive a friendly identity, not just 'Tradovate'",
    );
    assert.ok(card.includes("{identity}"), "card must render the derived identity");
  });

  test("linked accounts are collapsed by default with Show/Hide toggle", () => {
    const card = cardSource();
    assert.ok(card.includes("<details"), "accounts must be in a collapsed <details>");
    assert.ok(card.includes("Show accounts"), "must offer 'Show accounts'");
    assert.ok(card.includes("Hide accounts"), "must offer 'Hide accounts' when open");
  });

  test("expanded list renders friendly per-account rows", () => {
    const src = read(SECTION_FILE);
    assert.ok(src.includes("LinkedAccountRow"), "must render LinkedAccountRow components");
    assert.ok(
      /tradingAccounts\.map\(\(acct\)[\s\S]*?LinkedAccountRow/.test(src),
      "must map the connection's trading accounts to rows",
    );
  });

  test("identity and account list are based on trading (non-archived, present) accounts", () => {
    const card = cardSource();
    assert.ok(card.includes("tradingAccounts"), "card must compute a tradingAccounts list");
    assert.ok(
      card.includes('a.protectionStatus !== "pending_decision"') &&
        card.includes("a.missingFromBrokerSince == null"),
      "trading accounts must exclude pending-setup and missing accounts",
    );
  });
});

// ── Account-row action pattern (clean primary + compact "More" menu) ──────────

describe("LinkedAccountRow — action pattern", () => {
  test("Manage rules is the prominent primary action (filled, outside the menu)", () => {
    const row = rowSource();
    const idx = row.indexOf("Manage rules");
    assert.ok(idx !== -1, "row must keep a 'Manage rules' action");
    // The primary action links to the account's rules and is a filled button
    // (bg-stone-900), not one of four equal bordered pills.
    assert.ok(
      row.includes("/rules?scope=account&id=${acct.id}"),
      "Manage rules must link to the account rules view",
    );
    assert.ok(
      /Manage rules/.test(row) && row.includes("bg-stone-900"),
      "Manage rules must be visually prominent (filled button)",
    );
  });

  test("does not render four equal bulky sibling pill buttons", () => {
    const row = rowSource();
    // The old layout used a shared ACTION_PILL class on multiple sibling Links.
    assert.ok(
      !row.includes("ACTION_PILL"),
      "row must not use the old bulky equal-pill action layout",
    );
    // Only one of the secondary actions (View trades) is a direct Link; Rename
    // and Remove are components rendered inside the menu.
    const linkCount = (row.match(/<Link\b/g) ?? []).length;
    assert.ok(
      linkCount <= 2,
      `row should have at most two <Link> actions (Manage rules + View trades), found ${linkCount}`,
    );
  });

  test("secondary actions live in a compact 'More' menu (native details, no JS)", () => {
    const row = rowSource();
    assert.ok(row.includes("<details"), "secondary actions must collapse into a <details> menu");
    assert.ok(
      row.includes('aria-label="More account actions"'),
      "the menu trigger must be labelled for accessibility",
    );
  });

  test("the More trigger is discoverable: accessible name, hover and focus states", () => {
    const row = rowSource();
    // Labelled for screen readers AND hover-titled for mouse users.
    assert.ok(
      row.includes('aria-label="More account actions"') &&
        row.includes('title="More account actions"'),
      "the More trigger must expose an accessible label and a hover title",
    );
    // The summary keeps a visible border (a clear circular affordance) and
    // gains a hover + keyboard-focus state so it doesn't read as static text.
    const summaryStart = row.indexOf("<summary");
    const summaryEnd = row.indexOf(">", summaryStart);
    const summary = row.slice(summaryStart, summaryEnd);
    assert.ok(summary.includes("rounded-full") && summary.includes("border"),
      "the More trigger must remain a clear circular bordered button");
    assert.ok(summary.includes("hover:"), "the More trigger must have a hover state");
    assert.ok(summary.includes("focus-visible:"), "the More trigger must have a keyboard-focus state");
  });

  test("Rename, View trades, and Remove all remain accessible inside the menu", () => {
    const row = rowSource();
    assert.ok(row.includes("EditAccountNameButton"), "Rename (EditAccountNameButton) must be present");
    assert.ok(row.includes('variant="menuItem"'), "menu actions must use the menuItem variant");
    assert.ok(row.includes("View trades"), "View trades must remain accessible");
    assert.ok(
      row.includes("/trades?accountId=${acct.id}"),
      "View trades must link to the account trades view",
    );
    assert.ok(row.includes("RemoveAccountButton"), "Remove from Guardrail must remain accessible");
  });

  test("Remove is visually separated and de-emphasised (not a big scary row button)", () => {
    const row = rowSource();
    // A divider precedes the destructive action inside the menu.
    const dividerIdx = row.indexOf("border-t border-stone-100");
    const removeIdx = row.indexOf("RemoveAccountButton");
    assert.ok(dividerIdx !== -1, "a divider must separate the destructive action");
    assert.ok(
      dividerIdx < removeIdx,
      "the divider must come before RemoveAccountButton (visually separated)",
    );
    assert.ok(
      row.includes('variant="menuItem"'),
      "Remove must render in the de-emphasised menuItem variant, not a bulky pill",
    );
  });

  test("long account labels truncate with a title tooltip", () => {
    const row = rowSource();
    assert.ok(
      row.includes("truncate") && row.includes("title={primaryName}"),
      "the primary label must truncate and expose the full value via title",
    );
  });

  test("shows a 'you can rename it' hint only when no custom displayName is set", () => {
    const row = rowSource();
    // The hint text itself.
    assert.ok(
      row.includes("Broker account label · you can rename it"),
      "must hint that the broker label can be renamed",
    );
    // It is gated on the absence of a custom display name…
    assert.ok(
      /hasCustomName\s*=\s*\(acct\.displayName/.test(row),
      "the hint must derive from the account's displayName presence",
    );
    // …and rendered only when !hasCustomName.
    assert.ok(
      /\{!hasCustomName\s*&&[\s\S]*?Broker account label · you can rename it/.test(row),
      "the rename hint must render only when there is no custom displayName",
    );
  });
});

// ── Rename safety: displayName-only write via the existing endpoint ────────────

describe("EditAccountNameButton — rename safety", () => {
  const EDIT_FILE = resolve(import.meta.dirname, "edit-account-name-button.tsx");

  test("sends ONLY { displayName } to the existing user-scoped PATCH endpoint", () => {
    const src = read(EDIT_FILE);
    assert.ok(src.includes('method: "PATCH"'), "must use PATCH");
    assert.ok(
      src.includes("`/api/accounts/${accountId}`"),
      "must call the existing /api/accounts/[id] endpoint",
    );
    assert.ok(
      src.includes("JSON.stringify({ displayName: value.trim() || null })"),
      "must send only displayName (empty → null), never broker identifiers or rules",
    );
  });

  test("never sends broker identifiers, rules, protection, or removal fields", () => {
    // Comments are stripped: the component documents what it does NOT send, so
    // those field names legitimately appear in comments — only code matters.
    const src = readNoComments(EDIT_FILE);
    for (const forbidden of [
      "externalAccountId",
      "label:",
      "riskRules",
      "protectionStatus",
      "isActive",
      "deleteMany",
      ".delete(",
    ]) {
      assert.ok(!src.includes(forbidden), `rename must not reference ${forbidden} in code`);
    }
  });

  test("the menu trigger copy reads 'Edit account name' (clearer than 'Rename account')", () => {
    const src = read(EDIT_FILE);
    assert.ok(
      src.includes('"Edit account name"'),
      "the menuItem trigger label must read 'Edit account name'",
    );
    assert.ok(
      !src.includes('"Rename account"'),
      "the old 'Rename account' copy must be replaced",
    );
  });

  test("the menuItem variant changes styling only, not the request", () => {
    const src = read(EDIT_FILE);
    // The variant prop only switches the trigger label/class; the PATCH body is
    // computed independently of variant.
    assert.ok(src.includes('variant?: "pill" | "menuItem"'), "must offer a variant prop");
    assert.ok(
      !/variant[\s\S]{0,200}body:/.test(src.slice(src.indexOf("handleSave"))),
      "variant must not influence the request body",
    );
  });
});

// ── No technical/diagnostic fields in normal Settings ─────────────────────────

describe("BrokerConnectionCard — no technical fields", () => {
  test("does not render 'Token expires'", () => {
    assert.ok(!readNoComments(SECTION_FILE).includes("Token expires"), "must not show token expiry");
  });

  test("does not render 'Not yet synced' or last-sync diagnostics", () => {
    const src = readNoComments(SECTION_FILE);
    assert.ok(!src.includes("Not yet synced"), "must not show 'Not yet synced'");
    assert.ok(!src.includes("lastReconciliation"), "must not reference lastReconciliation*");
    assert.ok(!src.includes("Last sync"), "must not show 'Last sync'");
  });

  test("does not render 'Can discover new accounts'", () => {
    assert.ok(
      !readNoComments(SECTION_FILE).includes("Can discover"),
      "must not show 'Can discover new accounts'",
    );
  });

  test("does not render 'Tradovate user' / brokerUserId", () => {
    const src = readNoComments(SECTION_FILE);
    assert.ok(!src.includes("Tradovate user"), "must not show 'Tradovate user'");
    assert.ok(!src.includes("brokerUserId"), "must not reference brokerUserId");
    assert.ok(!src.includes("not yet populated"), "must not show '(not yet populated)'");
  });

  test("does not reference token expiry internals (tokenExpiresAt)", () => {
    assert.ok(
      !readNoComments(SECTION_FILE).includes("tokenExpiresAt"),
      "must not reference tokenExpiresAt — OAuth refresh is internal",
    );
  });

  test("BrokerConnectionRow type excludes diagnostic fields", () => {
    const src = readNoComments(SECTION_FILE);
    assert.ok(!src.includes("tokenExpiresAt: Date"), "type must not declare tokenExpiresAt");
    assert.ok(!src.includes("lastReconciliationAt: Date"), "type must not declare lastReconciliationAt");
    assert.ok(!src.includes("brokerUserId: string"), "type must not declare brokerUserId");
  });
});

// ── Status mapping ────────────────────────────────────────────────────────────

describe("userFacingStatus mapping", () => {
  test("connected statuses map to 'Connected'", () => {
    const src = read(SECTION_FILE);
    assert.ok(src.includes('label: "Connected"'), "connected_* must map to 'Connected'");
  });

  test("expired maps to 'Reconnect required'", () => {
    assert.ok(
      read(SECTION_FILE).includes('label: "Reconnect required"'),
      "expired must map to 'Reconnect required'",
    );
  });

  test("connection_error maps to 'Needs reconnect'", () => {
    assert.ok(
      read(SECTION_FILE).includes('label: "Needs reconnect"'),
      "connection_error must map to 'Needs reconnect'",
    );
  });
});

// ── Actions ───────────────────────────────────────────────────────────────────

describe("BrokerConnectionCard — actions", () => {
  test("connected connection shows Disconnect connection", () => {
    assert.ok(
      read(SECTION_FILE).includes("DisconnectConnectionButton"),
      "connected connection must offer DisconnectConnectionButton",
    );
  });

  test("expired connection shows Reconnect CTA with reconnect URL", () => {
    const card = cardSource();
    assert.ok(card.includes("reconnectUrl"), "expired card must use reconnectUrl");
    assert.ok(card.includes("Reconnect"), "expired card must render Reconnect CTA");
  });

  test("reconnectUrlForConnection uses env and reconnect params", () => {
    const src = read(SECTION_FILE);
    assert.ok(src.includes("reconnectUrlForConnection"), "must define reconnectUrlForConnection");
    assert.ok(src.includes("env=${bc.env}&reconnect=${bc.id}"), "reconnect URL must include env and reconnect params");
  });

  test("Remove connection is gated on all linked accounts being archived", () => {
    const card = cardSource();
    assert.ok(
      card.includes("canRemoveConnection") &&
        card.includes('protectionStatus === "archived"') &&
        card.includes("every"),
      "RemoveBrokerConnectionButton must be gated on every linked account being archived",
    );
  });

  test("RemoveBrokerConnectionButton receives conn.id", () => {
    assert.ok(
      cardSource().includes("connectionId={conn.id}"),
      "RemoveBrokerConnectionButton must receive conn.id",
    );
  });
});

// ── Archived accounts collapsed list ──────────────────────────────────────────

describe("BrokerConnectionCard — archived accounts list", () => {
  test("renders archived accounts in a collapsed <details> list", () => {
    const card = cardSource();
    assert.ok(card.includes("<details"), "archived accounts must be in a collapsed list");
    assert.ok(
      card.includes('protectionStatus === "archived"'),
      "must filter archived accounts for the collapsed list",
    );
  });

  test("archived accounts show friendly label, Archived badge, and unlink note", () => {
    const card = cardSource();
    assert.ok(card.includes("deriveAccountDisplayLabel(acct)"), "must show the friendly account label");
    assert.ok(card.includes('label="Archived"'), "must show an Archived badge");
    assert.ok(
      card.includes("Will be unlinked when this connection is removed"),
      "must explain archived accounts will be unlinked on connection removal",
    );
  });
});

// ── Scheduled-removal visibility (no regression from PR #73/#75) ───────────────

describe("BrokerConnectionCard — scheduled removal visibility", () => {
  test("surfaces 'Removal scheduled' when a linked account has a pending archive", () => {
    const card = cardSource();
    assert.ok(card.includes("Removal scheduled"), "must surface scheduled removals");
    assert.ok(
      card.includes('pendingProtectionStatus === "archived"'),
      "scheduled-removal note must check pendingProtectionStatus === 'archived'",
    );
  });

  test("BrokerAccountRow type still includes pendingProtectionStatus", () => {
    assert.ok(
      read(SECTION_FILE).includes("pendingProtectionStatus: string | null"),
      "BrokerAccountRow must keep pendingProtectionStatus",
    );
  });
});

// ── Live / Demo sections ──────────────────────────────────────────────────────

describe("Live and Demo connection sections", () => {
  test("renders 'Live connections' and 'Demo connections' headings", () => {
    const src = read(SECTION_FILE);
    assert.ok(src.includes("Live connections"), "must have 'Live connections' header");
    assert.ok(src.includes("Demo connections"), "must have 'Demo connections' header");
  });

  test("live before demo, filtered by env", () => {
    const src = read(SECTION_FILE);
    assert.ok(src.includes('bc.env === "live"'), "must filter live connections by env");
    assert.ok(src.includes('bc.env === "demo"'), "must filter demo connections by env");
    assert.ok(src.indexOf("Live connections") < src.indexOf("Demo connections"), "live before demo");
  });
});

// ── Explanation block ─────────────────────────────────────────────────────────

describe("explanation block", () => {
  test("includes 'How broker connections work', not hidden in a details", () => {
    const src = read(SECTION_FILE);
    const explanationIdx = src.indexOf("How broker connections work");
    assert.ok(explanationIdx > -1, "must include explanation header");
    // The explanation block itself must not be wrapped in a <details>. Check the
    // 200 chars before the header contain no opening <details summary.
    const preceding = src.slice(Math.max(0, explanationIdx - 200), explanationIdx);
    assert.ok(!preceding.includes("<summary"), "explanation must not be inside a <details>/<summary>");
  });

  test("explanation describes the connection → account relationship", () => {
    const src = read(SECTION_FILE);
    assert.ok(src.includes("permission link to Tradovate"));
    assert.ok(src.includes("live sync and broker-side enforcement pause"));
  });
});

// ── Inactive accounts (standalone section) ────────────────────────────────────

describe("inactive account rows", () => {
  test("uses RemoveAccountButton with honest copy", () => {
    const src = read(SECTION_FILE);
    assert.ok(src.includes("No longer active in Tradovate"), "inactive copy must be honest");
    assert.ok(src.includes("RemoveAccountButton"), "inactive section must use RemoveAccountButton");
  });

  test("RemoveAccountButton appears after the Archived / inactive header", () => {
    const src = read(SECTION_FILE);
    const header = src.indexOf("Archived / inactive");
    const removeButton = src.lastIndexOf("RemoveAccountButton");
    assert.ok(header !== -1 && removeButton > header, "remove button must follow the header");
  });

  test("classifyAccounts excludes archived accounts from standalone buckets", () => {
    const src = read(SECTION_FILE);
    const fnStart = src.indexOf("function classifyAccounts");
    const fnEnd = src.indexOf("\nfunction ", fnStart + 1);
    const fnSrc = src.slice(fnStart, fnEnd);
    assert.ok(
      fnSrc.includes('protectionStatus !== "archived"'),
      "classifyAccounts must exclude archived accounts",
    );
  });
});

// ── Section structure ─────────────────────────────────────────────────────────

describe("section structure", () => {
  test("handles empty state (no broker connected yet)", () => {
    assert.ok(read(SECTION_FILE).includes("No broker connected yet"));
  });

  test("does not render old static 'Tradovate Demo — connection expired' string", () => {
    assert.ok(!read(SECTION_FILE).includes("Tradovate Demo — connection expired"));
  });

  test("AccountDiscoveryHelper is imported and rendered", () => {
    assert.ok(read(SECTION_FILE).includes("AccountDiscoveryHelper"));
  });

  test("does not embed ambient market-hours text", () => {
    const src = read(SECTION_FILE);
    assert.ok(!src.includes("Available today"));
    assert.ok(!src.includes("Available tomorrow"));
  });
});

// ── Settings page wiring ──────────────────────────────────────────────────────

describe("Settings page — full account inventory + simplified connection query", () => {
  test("settings page loads archived accounts with brokerConnectionId for the cards", () => {
    const pageSrc = readFileSync(resolve(import.meta.dirname, "../page.tsx"), "utf8");
    assert.ok(
      pageSrc.includes('"archived"') && pageSrc.includes("OR"),
      "settings connectedAccounts query must include archived accounts via OR clause",
    );
  });

  test("settings page brokerConnection query no longer selects diagnostic fields", () => {
    // Strip comments so the explanatory note in the query (which names the
    // excluded fields) doesn't produce a false negative.
    const pageSrc = readFileSync(resolve(import.meta.dirname, "../page.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const bcQueryStart = pageSrc.indexOf("prisma.brokerConnection.findMany");
    const bcQueryEnd = pageSrc.indexOf("orderBy", bcQueryStart);
    const bcQuery = pageSrc.slice(bcQueryStart, bcQueryEnd);
    assert.ok(!bcQuery.includes("tokenExpiresAt"), "must not select tokenExpiresAt");
    assert.ok(!bcQuery.includes("lastReconciliation"), "must not select lastReconciliation*");
    assert.ok(!bcQuery.includes("brokerUserId"), "must not select brokerUserId");
  });

  test("settings sidebar still excludes archived accounts (protected/monitor_only only)", () => {
    const pageSrc = readFileSync(resolve(import.meta.dirname, "../page.tsx"), "utf8");
    assert.ok(
      pageSrc.includes("sidebarAccounts") &&
        pageSrc.includes('"protected"') &&
        pageSrc.includes('"monitor_only"'),
      "sidebar must still filter to protected/monitor_only only",
    );
  });
});
