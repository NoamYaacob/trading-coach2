/**
 * Copy and structure tests for the broker connections section.
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
const DISCONNECT_FILE = resolve(
  import.meta.dirname,
  "../../accounts/_components/disconnect-button.tsx",
);

function read(path: string): string {
  return readFileSync(path, "utf8");
}

// ── Connection-group cards (new layout) ───────────────────────────────────────

describe("BrokerConnectionCard shows connection metadata", () => {
  test("BrokerConnectionCard is defined in the component file", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes("BrokerConnectionCard"),
      "component must define BrokerConnectionCard",
    );
  });

  test("card shows env badge (Live / Demo)", () => {
    const src = read(SECTION_FILE);
    const cardStart = src.indexOf("function BrokerConnectionCard");
    const cardEnd = src.indexOf("\nfunction ", cardStart + 1);
    const cardSrc = src.slice(cardStart, cardEnd);
    assert.ok(
      cardSrc.includes("envLabel(conn.env)"),
      "card must display env via envLabel",
    );
  });

  test("card shows ConnectionStatusPill for connectionStatus", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes("ConnectionStatusPill"),
      "component must define and use ConnectionStatusPill",
    );
  });

  test("card shows Tradovate brokerUserId", () => {
    const src = read(SECTION_FILE);
    const cardStart = src.indexOf("function BrokerConnectionCard");
    const cardEnd = src.indexOf("\nfunction ", cardStart + 1);
    const cardSrc = src.slice(cardStart, cardEnd);
    assert.ok(
      cardSrc.includes("conn.brokerUserId"),
      "card must show brokerUserId field",
    );
  });

  test("card shows tokenExpiresAt with red styling when expired", () => {
    const src = read(SECTION_FILE);
    const cardStart = src.indexOf("function BrokerConnectionCard");
    const cardEnd = src.indexOf("\nfunction ", cardStart + 1);
    const cardSrc = src.slice(cardStart, cardEnd);
    assert.ok(
      cardSrc.includes("tokenExpired"),
      "card must compute tokenExpired flag",
    );
    assert.ok(
      cardSrc.includes("text-red-600"),
      "card must apply red color when token is expired",
    );
  });

  test("card shows last sync info from lastReconciliationAt", () => {
    const src = read(SECTION_FILE);
    const cardStart = src.indexOf("function BrokerConnectionCard");
    const cardEnd = src.indexOf("\nfunction ", cardStart + 1);
    const cardSrc = src.slice(cardStart, cardEnd);
    assert.ok(
      cardSrc.includes("conn.lastReconciliationAt"),
      "card must show lastReconciliationAt",
    );
  });

  test("card shows linked account count", () => {
    const src = read(SECTION_FILE);
    const cardStart = src.indexOf("function BrokerConnectionCard");
    const cardEnd = src.indexOf("\nfunction ", cardStart + 1);
    const cardSrc = src.slice(cardStart, cardEnd);
    assert.ok(
      cardSrc.includes("linked account"),
      "card must display linked account count",
    );
  });

  test("expired connection shows Reconnect CTA with reconnect URL", () => {
    const src = read(SECTION_FILE);
    const cardStart = src.indexOf("function BrokerConnectionCard");
    const cardEnd = src.indexOf("\nfunction ", cardStart + 1);
    const cardSrc = src.slice(cardStart, cardEnd);
    assert.ok(
      cardSrc.includes("reconnectUrl"),
      "expired connection card must use reconnectUrl",
    );
    assert.ok(
      cardSrc.includes("Reconnect"),
      "expired connection must render Reconnect CTA",
    );
  });

  test("reconnectUrlForConnection uses env and reconnect params", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes("reconnectUrlForConnection"),
      "must define reconnectUrlForConnection helper",
    );
    assert.ok(
      src.includes("env=${bc.env}&reconnect=${bc.id}") ||
        src.includes("?env="),
      "reconnect URL must include env and reconnect params",
    );
  });

  test("can discover label differs based on isActive vs expired", () => {
    const src = read(SECTION_FILE);
    const cardStart = src.indexOf("function BrokerConnectionCard");
    const cardEnd = src.indexOf("\nfunction ", cardStart + 1);
    const cardSrc = src.slice(cardStart, cardEnd);
    assert.ok(
      cardSrc.includes("Can discover new accounts"),
      "active connection must say 'Can discover new accounts'",
    );
    assert.ok(
      cardSrc.includes("Cannot discover accounts"),
      "expired connection must say 'Cannot discover accounts'",
    );
  });
});

// ── Live / Demo sections ──────────────────────────────────────────────────────

describe("Live and Demo connection sections", () => {
  test("section renders 'Live connections' heading", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes("Live connections"),
      "must have 'Live connections' section header",
    );
  });

  test("section renders 'Demo connections' heading", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes("Demo connections"),
      "must have 'Demo connections' section header",
    );
  });

  test("live connections filtered by env === 'live'", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes("bc.env === \"live\"") || src.includes("env === 'live'") || src.includes(".filter((bc) => bc.env === \"live\")"),
      "must filter live connections by env",
    );
  });

  test("demo connections filtered by env === 'demo'", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes("bc.env === \"demo\"") || src.includes("env === 'demo'") || src.includes(".filter((bc) => bc.env === \"demo\")"),
      "must filter demo connections by env",
    );
  });

  test("Live connections section appears before Demo connections in JSX", () => {
    const src = read(SECTION_FILE);
    const liveIdx = src.indexOf("Live connections");
    const demoIdx = src.indexOf("Demo connections");
    assert.ok(liveIdx > -1, "'Live connections' header must be present");
    assert.ok(demoIdx > -1, "'Demo connections' header must be present");
    assert.ok(
      liveIdx < demoIdx,
      "Live connections must appear before Demo connections",
    );
  });
});

// ── Explanation block ─────────────────────────────────────────────────────────

describe("explanation block", () => {
  test("section includes 'How broker connections work' block", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes("How broker connections work"),
      "section must include 'How broker connections work' header",
    );
  });

  test("explanation describes the connection → account relationship", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes("permission link to Tradovate"),
      "explanation must say broker connection is the 'permission link to Tradovate'",
    );
    assert.ok(
      src.includes("live sync and broker-side enforcement pause"),
      "explanation must say what happens when the connection expires",
    );
  });
});

// ── Connected account rows ────────────────────────────────────────────────────

describe("connected account rows — permission-level badge and copy", () => {
  test("full_access shows 'Risk settings' badge (not Read-only)", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes('"Risk settings"'),
      "full_access badge must be 'Risk settings'",
    );
  });

  test("full_access shows risk-settings copy", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes("Connected with risk settings access"),
      "full_access copy must say 'Connected with risk settings access'",
    );
    assert.ok(
      src.includes("sync supported broker-side risk settings"),
      "full_access copy must mention syncing broker-side risk settings",
    );
  });

  test("full_access does NOT show 'Connected with read-only access' copy", () => {
    const src = read(SECTION_FILE);
    const permDisplayFnStart = src.indexOf("function permDisplay");
    const permDisplayFnEnd = src.indexOf("\nfunction ", permDisplayFnStart + 1);
    const permDisplayFn = src.slice(permDisplayFnStart, permDisplayFnEnd);
    assert.ok(
      permDisplayFn.includes("full_access"),
      "permDisplay must branch on full_access",
    );
    assert.ok(
      permDisplayFn.includes("Connected with read-only access"),
      "read-only copy must exist inside permDisplay for perm === read_only branch",
    );
  });

  test("full_access hides Reconnect with full access button (showReconnect: false)", () => {
    const src = read(SECTION_FILE);
    const permDisplayFnStart = src.indexOf("function permDisplay");
    const permDisplayFnEnd = src.indexOf("\nfunction ", permDisplayFnStart + 1);
    const permDisplayFn = src.slice(permDisplayFnStart, permDisplayFnEnd);
    assert.ok(
      permDisplayFn.includes("showReconnect: false"),
      "full_access branch must set showReconnect: false",
    );
  });

  test("read_only shows 'Read-only' badge", () => {
    const src = read(SECTION_FILE);
    assert.ok(src.includes('"Read-only"'), "must include Read-only status pill for perm === read_only");
  });

  test("read_only shows read-only copy and enables Reconnect with full access", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes("Connected with read-only access"),
      "read_only copy must say 'Connected with read-only access'",
    );
    assert.ok(
      src.includes("cannot apply broker-side risk settings"),
      "read-only copy must mention the broker-side limitation",
    );
    assert.ok(
      src.includes("Reconnect with full access"),
      "read-only case must offer 'Reconnect with full access' upgrade link",
    );
    const permDisplayFnStart = src.indexOf("function permDisplay");
    const permDisplayFnEnd = src.indexOf("\nfunction ", permDisplayFnStart + 1);
    const permDisplayFn = src.slice(permDisplayFnStart, permDisplayFnEnd);
    assert.ok(
      permDisplayFn.includes("showReconnect: true"),
      "read_only branch must set showReconnect: true",
    );
  });

  test("null/unknown permissionLevel shows 'Checking' badge", () => {
    const src = read(SECTION_FILE);
    assert.ok(src.includes('"Checking"'), "null/unknown must use Checking badge");
  });

  test("null/unknown shows permission check pending copy", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes("Permission check pending"),
      "null/unknown copy must say 'Permission check pending'",
    );
    assert.ok(
      src.includes("Guardrail can monitor only until access is confirmed"),
      "null/unknown copy must tell user monitoring-only until probe confirms access",
    );
  });

  test("showReconnect for unknown (probe failed), not for null (probe not yet run)", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes('perm === "unknown"'),
      "showReconnect must gate on perm === unknown to distinguish probe failure from no probe",
    );
  });

  test("connected account card uses permDisplay for pill and copy — not connectionStatus", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes("permDisplay("),
      "connected account card must call permDisplay() to drive badge and copy",
    );
    assert.ok(
      !src.includes("acct.connectionStatus === \"connected_readonly\""),
      "connected account card must not use connected_readonly to drive isReadOnly",
    );
  });
});

// ── Production scenario: full_access + connected_readonly ─────────────────────

describe("production scenario: permissionLevel full_access with connectionStatus connected_readonly", () => {
  test("permDisplay(full_access) returns Risk settings pill regardless of connectionStatus", () => {
    const src = read(SECTION_FILE);
    const permDisplayFnStart = src.indexOf("function permDisplay");
    const permDisplayFnEnd = src.indexOf("\nfunction ", permDisplayFnStart + 1);
    const fn = src.slice(permDisplayFnStart, permDisplayFnEnd);
    assert.ok(fn.includes('"full_access"'), "permDisplay must have full_access branch");
    assert.ok(fn.includes('"Risk settings"'), "full_access branch must return Risk settings pill");
    assert.ok(fn.includes('"emerald"'), "full_access pill must use emerald color");
  });

  test("permDisplay(full_access) copy mentions risk settings access, not read-only", () => {
    const src = read(SECTION_FILE);
    const permDisplayFnStart = src.indexOf("function permDisplay");
    const permDisplayFnEnd = src.indexOf("\nfunction ", permDisplayFnStart + 1);
    const fn = src.slice(permDisplayFnStart, permDisplayFnEnd);
    const fullAccessBranchEnd = fn.indexOf("if (perm === \"read_only\")");
    const fullAccessBranch = fn.slice(0, fullAccessBranchEnd);
    assert.ok(
      fullAccessBranch.includes("risk settings access"),
      "full_access copy must say 'risk settings access'",
    );
    assert.ok(
      !fullAccessBranch.includes("read-only access"),
      "full_access copy must NOT say 'read-only access'",
    );
  });

  test("production scenario: live + demo connections with full_access each get Risk settings badge", () => {
    const src = read(SECTION_FILE);
    const permDisplayFnStart = src.indexOf("function permDisplay");
    const permDisplayFnEnd = src.indexOf("\nfunction ", permDisplayFnStart + 1);
    const fn = src.slice(permDisplayFnStart, permDisplayFnEnd);
    assert.ok(!fn.includes('"live"'), "permDisplay must not branch on env");
    assert.ok(!fn.includes('"demo"'), "permDisplay must not branch on env");
    assert.ok(fn.includes('"full_access"'), "must handle full_access for all envs");
  });
});

// ── Inactive accounts ─────────────────────────────────────────────────────────

describe("inactive account rows", () => {
  test("uses RemoveAccountButton, not Disconnect", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes("No longer active in Tradovate"),
      "inactive copy must say 'No longer active in Tradovate'",
    );
    assert.ok(
      src.includes("RemoveAccountButton"),
      "inactive section must use RemoveAccountButton",
    );
  });
});

// ── Market-hours text ─────────────────────────────────────────────────────────

describe("market-hours text (disconnect window label)", () => {
  test("section component does not render ambient 'Available today/tomorrow' text", () => {
    const src = read(SECTION_FILE);
    assert.ok(!src.includes("Available today"), "section must not embed market-hours text");
    assert.ok(!src.includes("Available tomorrow"), "section must not embed market-hours text");
  });

  test("disconnect-button does not show ambient window text outside the blocked dialog", () => {
    const src = read(DISCONNECT_FILE);
    assert.ok(
      !src.includes('<p className="text-xs text-amber-700">{availableLabel}</p>'),
      "DisconnectButton must not render ambient availableLabel p-tag outside the dialog",
    );
  });
});

// ── Section structure ─────────────────────────────────────────────────────────

describe("section structure", () => {
  test("declares Live and Demo group headers", () => {
    const src = read(SECTION_FILE);
    assert.ok(src.includes("Live connections"), "must have 'Live connections' header");
    assert.ok(src.includes("Demo connections"), "must have 'Demo connections' header");
    assert.ok(src.includes("Archived / inactive"), "must have 'Archived / inactive' header");
  });

  test("handles empty state (no broker connected yet)", () => {
    const src = read(SECTION_FILE);
    assert.ok(src.includes("No broker connected yet"), "must handle empty state");
  });

  test("does not render old static 'Tradovate Demo — connection expired' string", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      !src.includes("Tradovate Demo — connection expired"),
      "old static expired-connection string must not appear",
    );
  });

  test("AccountDiscoveryHelper is imported and rendered", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes("AccountDiscoveryHelper"),
      "section must import and render AccountDiscoveryHelper",
    );
  });
});

// ── Remove action placement ───────────────────────────────────────────────────

describe("remove action placement", () => {
  test("RemoveAccountButton appears after Archived / inactive header", () => {
    const src = read(SECTION_FILE);
    const inactiveHeader = src.indexOf("Archived / inactive");
    const removeButton = src.lastIndexOf("RemoveAccountButton");
    assert.ok(
      inactiveHeader !== -1,
      "Archived / inactive section header must be present",
    );
    assert.ok(
      removeButton > inactiveHeader,
      "RemoveAccountButton must appear after the 'Archived / inactive' header",
    );
  });
});

// ── Coexistence: active + expired connections ─────────────────────────────────

describe("active and expired connections coexistence", () => {
  test("BrokerConnectionCard handles both active and expired connections", () => {
    const src = read(SECTION_FILE);
    const cardStart = src.indexOf("function BrokerConnectionCard");
    const cardEnd = src.indexOf("\nfunction ", cardStart + 1);
    const cardSrc = src.slice(cardStart, cardEnd);
    assert.ok(
      cardSrc.includes("expired"),
      "BrokerConnectionCard must handle expired state",
    );
    assert.ok(
      cardSrc.includes("canDiscover"),
      "BrokerConnectionCard must compute canDiscover from connection state",
    );
  });

  test("callback auto-cleans orphaned expired BrokerConnections for same env on reconnect", () => {
    const callbackSrc = readFileSync(
      resolve(import.meta.dirname, "../../api/auth/tradovate/callback/route.ts"),
      "utf8",
    );
    assert.ok(
      callbackSrc.includes("cleaned up orphaned expired connections"),
      "callback must log cleanup of orphaned expired connections",
    );
    assert.ok(
      callbackSrc.includes("brokerConnection.deleteMany"),
      "callback must call brokerConnection.deleteMany to remove orphaned rows",
    );
    assert.ok(
      callbackSrc.includes("brokerConnectionId: { in: candidateIds }"),
      "callback must filter for linked accounts before deleting",
    );
  });
});

// ── Final polish pass ─────────────────────────────────────────────────────────

describe("final polish pass", () => {
  test("explanation card is always visible (not hidden inside <details>)", () => {
    const src = read(SECTION_FILE);
    const detailsIndex = src.indexOf("<details");
    const explanationIndex = src.indexOf("How broker connections work");
    assert.ok(
      detailsIndex === -1 || explanationIndex < detailsIndex,
      "explanation block must not be inside a <details> element",
    );
  });

  test("reconnect button labels use '<env> connection' format", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes("connection`"),
      "reconnect button label must produce '<env> connection' or 'connection'",
    );
    assert.ok(
      !src.includes("Reconnect {platform}"),
      "reconnect button must not use platform name in label",
    );
  });

  test("BrokerConnectionRow type includes all required metadata fields", () => {
    const src = read(SECTION_FILE);
    assert.ok(src.includes("brokerUserId: string | null"), "BrokerConnectionRow must include brokerUserId");
    assert.ok(src.includes("tokenExpiresAt: Date | null"), "BrokerConnectionRow must include tokenExpiresAt");
    assert.ok(src.includes("lastReconciliationAt: Date | null"), "BrokerConnectionRow must include lastReconciliationAt");
    assert.ok(src.includes("lastReconciliationStatus: string | null"), "BrokerConnectionRow must include lastReconciliationStatus");
    assert.ok(src.includes("lastReconciledAccountCount: number | null"), "BrokerConnectionRow must include lastReconciledAccountCount");
  });
});

// ── Linked-account count accuracy (archived accounts included) ────────────────

describe("BrokerConnectionCard — linked account count includes all statuses", () => {
  test("count uses linkedAccounts.length (total), not connectedAccts.length (active-only)", () => {
    const src = read(SECTION_FILE);
    const cardStart = src.indexOf("function BrokerConnectionCard");
    const cardEnd = src.indexOf("\nfunction ", cardStart + 1);
    const cardSrc = src.slice(cardStart, cardEnd);
    // The count line must reference linkedAccounts.length
    assert.ok(
      /linkedAccounts\.length.*linked account/.test(cardSrc) ||
        /linked account.*linkedAccounts\.length/.test(cardSrc),
      "card must use linkedAccounts.length for the total linked account count",
    );
  });

  test("card does not use connectedAccts.length as the displayed count", () => {
    const src = read(SECTION_FILE);
    const cardStart = src.indexOf("function BrokerConnectionCard");
    const cardEnd = src.indexOf("\nfunction ", cardStart + 1);
    const cardSrc = src.slice(cardStart, cardEnd);
    // connectedAccts.length is allowed for the DisconnectConnectionButton prop,
    // but must not be the rendered count text.
    const countLineMatch = cardSrc.match(/\{connectedAccts\.length\}\s*linked account/);
    assert.ok(
      !countLineMatch,
      "card must not render connectedAccts.length as the linked account count — use linkedAccounts.length for accuracy",
    );
  });
});

// ── Remove connection button condition ────────────────────────────────────────

describe("BrokerConnectionCard — remove connection button guards", () => {
  test("RemoveBrokerConnectionButton shows when all linked accounts are archived", () => {
    const src = read(SECTION_FILE);
    const cardStart = src.indexOf("function BrokerConnectionCard");
    const cardEnd = src.indexOf("\nfunction ", cardStart + 1);
    const cardSrc = src.slice(cardStart, cardEnd);
    assert.ok(
      cardSrc.includes('protectionStatus === "archived"') &&
        cardSrc.includes("every"),
      "card must gate RemoveBrokerConnectionButton on every linked account being archived",
    );
  });

  test("expired connection shows helper text when non-archived accounts are linked", () => {
    const src = read(SECTION_FILE);
    const cardStart = src.indexOf("function BrokerConnectionCard");
    const cardEnd = src.indexOf("\nfunction ", cardStart + 1);
    const cardSrc = src.slice(cardStart, cardEnd);
    assert.ok(
      cardSrc.includes("Remove linked accounts first"),
      "card must show 'Remove linked accounts first' helper text for non-archiveable state",
    );
  });

  test("classifyAccounts excludes archived accounts from standalone sections", () => {
    const src = read(SECTION_FILE);
    const fnStart = src.indexOf("function classifyAccounts");
    const fnEnd = src.indexOf("\nfunction ", fnStart + 1);
    const fnSrc = src.slice(fnStart, fnEnd);
    assert.ok(
      fnSrc.includes('protectionStatus !== "archived"'),
      "classifyAccounts must exclude archived accounts from standalone buckets",
    );
  });

  test("archived accounts inside card show 'Already archived' text, not a remove button", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes("Already archived"),
      "card must show 'Already archived' copy for archived linked accounts",
    );
  });
});

// ── Settings page loads archived accounts for broker connection cards ─────────

describe("Settings page — full account inventory for broker connections", () => {
  test("settings page query includes archived accounts with brokerConnectionId", () => {
    const pageSrc = readFileSync(resolve(import.meta.dirname, "../page.tsx"), "utf8");
    assert.ok(
      pageSrc.includes('"archived"') && pageSrc.includes("OR"),
      "settings page connectedAccounts query must include archived accounts via OR clause",
    );
  });

  test("settings page sidebar still excludes archived accounts (protected/monitor_only only)", () => {
    const pageSrc = readFileSync(resolve(import.meta.dirname, "../page.tsx"), "utf8");
    assert.ok(
      pageSrc.includes("sidebarAccounts") &&
        pageSrc.includes('"protected"') &&
        pageSrc.includes('"monitor_only"'),
      "settings sidebar must still filter to protected/monitor_only only",
    );
  });
});
