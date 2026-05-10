/**
 * Copy and structure tests for the broker connections section.
 *
 * Three-group layout:
 *   - Needs attention   (expired connection groups)
 *   - Connected accounts (live / read-only)
 *   - Archived / inactive (missing from broker)
 *
 * Source-scan approach mirrors the existing account-rules-form-copy tests.
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

// ── Grouped expired cards ─────────────────────────────────────────────────────

describe("expired connection grouping", () => {
  test("renders one card per broker connection group, not one card per account", () => {
    const src = read(SECTION_FILE);
    // The section JSX maps over expiredGroups (connection-level), not individual accounts.
    assert.ok(
      src.includes("expiredGroups.map"),
      "section must iterate over expiredGroups in JSX, not over individual needsAttention accounts",
    );
    // ExpiredConnectionGroupCard must be the card component (not an inline per-account card).
    assert.ok(
      src.includes("ExpiredConnectionGroupCard"),
      "section must render ExpiredConnectionGroupCard — one card per connection group",
    );
  });

  test("grouped card title says '<Platform> <Env> connection expired'", () => {
    const src = read(SECTION_FILE);
    // ExpiredConnectionGroupCard must produce a title string that includes
    // "connection expired" so the user sees a connection-level message.
    assert.ok(
      src.includes("connection expired"),
      "group card title must contain 'connection expired'",
    );
  });

  test("grouped card shows 'Affects N accounts' for multi-account groups", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes("Affects"),
      "grouped card must include 'Affects' count for multi-account groups",
    );
    assert.ok(
      src.includes("accounts"),
      "grouped card must pluralise to 'accounts' when count > 1",
    );
  });

  test("grouped card renders each affected account label in the account list", () => {
    const src = read(SECTION_FILE);
    // Inside the group card, group.accounts.map renders each acct.label.
    assert.ok(
      src.includes("group.accounts.map"),
      "group card must iterate group.accounts to list each affected account",
    );
    assert.ok(
      src.includes("{acct.label}"),
      "group card must render {acct.label} for each account in the list",
    );
  });

  test("reconnect CTA is rendered once per group (not per account)", () => {
    const src = read(SECTION_FILE);
    // The Reconnect Link inside ExpiredConnectionGroupCard uses group.reconnectUrl —
    // the URL is computed once per connection group in groupExpiredByConnection,
    // not recalculated inline per account in the JSX.
    assert.ok(
      src.includes("group.reconnectUrl"),
      "reconnect link must use group.reconnectUrl — one link per connection group",
    );
    // groupExpiredByConnection assigns reconnectUrl once per group, not per render.
    assert.ok(
      src.includes("groupExpiredByConnection"),
      "section must call groupExpiredByConnection to produce one group per connection",
    );
  });

  test("reconnect copy explains that reconnecting restores affected accounts", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes("reconnect to resume live sync and broker-side risk settings"),
      "group card copy must explain the reconnect benefit",
    );
  });

  test("remove action is NOT a primary button next to Reconnect on grouped cards", () => {
    const src = read(SECTION_FILE);
    // RemoveAccountButton must not appear inside ExpiredConnectionGroupCard.
    // It should only appear in the inactive section.
    // The grouped card JSX ends at the closing of ExpiredConnectionGroupCard.
    // The safest check: RemoveAccountButton must follow the "Archived / inactive" header.
    const inactiveHeader = src.indexOf("Archived / inactive");
    const removeButton = src.lastIndexOf("RemoveAccountButton");
    assert.ok(
      inactiveHeader !== -1,
      "Archived / inactive section header must be present",
    );
    assert.ok(
      removeButton > inactiveHeader,
      "RemoveAccountButton must appear only after the 'Archived / inactive' header, not in expired group cards",
    );
  });
});

// ── Orphaned connections (no linked accounts) ─────────────────────────────────

describe("orphaned expired connections", () => {
  test("orphaned connections render via OrphanedConnectionRow, not ExpiredConnectionGroupCard", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes("OrphanedConnectionRow"),
      "component must define and use OrphanedConnectionRow for connections with no accounts",
    );
    assert.ok(
      src.includes("orphanedExpired.map"),
      "section must iterate orphanedExpired separately from grouped expired accounts",
    );
  });

  test("orphaned row is visually compact/muted (stone border, not amber)", () => {
    const src = read(SECTION_FILE);
    // OrphanedConnectionRow uses stone border, not amber/orange.
    const orphanedRowStart = src.indexOf("function OrphanedConnectionRow");
    const orphanedRowEnd = src.indexOf("\nfunction ", orphanedRowStart + 1);
    const orphanedSrc = src.slice(orphanedRowStart, orphanedRowEnd);
    assert.ok(
      orphanedSrc.includes("border-stone"),
      "orphaned row must use stone border (muted), not amber/orange",
    );
    assert.ok(
      !orphanedSrc.includes("border-amber") && !orphanedSrc.includes("border-orange"),
      "orphaned row must not use amber or orange borders",
    );
  });

  test("orphaned row says 'No accounts linked'", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes("No accounts linked"),
      "orphaned row must say 'No accounts linked'",
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

describe("connected account rows", () => {
  test("shows enforcement status for connected accounts", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes("Broker-side enforcement active"),
      "section must surface 'Broker-side enforcement active' for full-access live accounts",
    );
    assert.ok(
      src.includes("Monitoring only"),
      "section must surface 'Monitoring only' for read-only accounts",
    );
    assert.ok(
      src.includes("App-level only"),
      "section must surface 'App-level only' for live accounts without confirmed write access",
    );
  });

  test("read-only accounts show explanation copy, not expired styling", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes("Connected with read-only access"),
      "read-only copy must say 'Connected with read-only access'",
    );
    assert.ok(
      src.includes("cannot apply broker-side risk settings"),
      "read-only copy must mention the broker-side limitation",
    );
  });

  test("offers Reconnect with full access link for read-only accounts", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes("Reconnect with full access"),
      "read-only accounts must offer 'Reconnect with full access' upgrade link",
    );
  });

  test("status pills include Connected, Read-only, and Syncing states", () => {
    const src = read(SECTION_FILE);
    assert.ok(src.includes('"Connected"'), "must include Connected status pill");
    assert.ok(src.includes('"Read-only"'), "must include Read-only status pill");
    assert.ok(src.includes('"Syncing"'), "must include Syncing status pill");
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
  test("declares all three group headers", () => {
    const src = read(SECTION_FILE);
    assert.ok(src.includes("Needs attention"), "must have 'Needs attention' header");
    assert.ok(src.includes("Connected accounts"), "must have 'Connected accounts' header");
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
});

// ── Orphan + active coexistence ───────────────────────────────────────────────

describe("orphan expired connection alongside active connected account", () => {
  test("orphaned row copy says 'Old expired' not 'connection expired' to avoid confusion", () => {
    const src = read(SECTION_FILE);
    const orphanedFnStart = src.indexOf("function OrphanedConnectionRow");
    const orphanedFnEnd = src.indexOf("\nfunction ", orphanedFnStart + 1);
    const orphanedFn = src.slice(orphanedFnStart, orphanedFnEnd);
    assert.ok(
      orphanedFn.includes("Old expired"),
      "orphaned row must use 'Old expired' prefix so it is not confused with an active connection expiry",
    );
    assert.ok(
      !orphanedFn.includes("connection expired"),
      "orphaned row must not use 'connection expired' phrasing (reserved for grouped expired cards with accounts)",
    );
  });

  test("orphaned row action is 'Remove connection', not 'Reconnect'", () => {
    const src = read(SECTION_FILE);
    const orphanedFnStart = src.indexOf("function OrphanedConnectionRow");
    const orphanedFnEnd = src.indexOf("\nfunction ", orphanedFnStart + 1);
    const orphanedFn = src.slice(orphanedFnStart, orphanedFnEnd);
    assert.ok(
      orphanedFn.includes("RemoveBrokerConnectionButton"),
      "orphaned row must render RemoveBrokerConnectionButton as the action",
    );
    assert.ok(
      !orphanedFn.includes(">Reconnect<") && !orphanedFn.includes('"Reconnect"'),
      "orphaned row must not have a Reconnect link — that action makes no sense for an orphaned connection",
    );
  });

  test("connected accounts section appears before unused expired connections in JSX", () => {
    const src = read(SECTION_FILE);
    const connectedIdx = src.indexOf("Connected accounts");
    const unusedIdx = src.indexOf("Unused expired connections");
    assert.ok(connectedIdx > -1, "'Connected accounts' header must be present");
    assert.ok(unusedIdx > -1, "'Unused expired connections' header must be present");
    assert.ok(
      connectedIdx < unusedIdx,
      "Connected accounts section must appear before Unused expired connections — active accounts take visual priority",
    );
  });

  test("orphaned section does not appear inside 'Needs attention' block", () => {
    const src = read(SECTION_FILE);
    // The 'Needs attention' block closes (via {hasNeedsAttention && (...)} pattern)
    // before the 'Unused expired connections' label appears.
    const needsAttentionIdx = src.indexOf("Needs attention");
    const connectedIdx = src.indexOf("Connected accounts");
    const unusedIdx = src.indexOf("Unused expired connections");
    // Connected accounts must come after Needs attention
    assert.ok(connectedIdx > needsAttentionIdx);
    // Unused expired connections must come after Connected accounts
    assert.ok(unusedIdx > connectedIdx);
  });

  test("callback auto-cleans orphaned expired BrokerConnections for same env on reconnect", () => {
    const callbackSrc = readFileSync(
      resolve(import.meta.dirname, "../../api/auth/tradovate/callback/route.ts"),
      "utf8",
    );
    // Must find and delete other orphaned expired connections
    assert.ok(
      callbackSrc.includes("cleaned up orphaned expired connections"),
      "callback must log cleanup of orphaned expired connections",
    );
    assert.ok(
      callbackSrc.includes("brokerConnection.deleteMany"),
      "callback must call brokerConnection.deleteMany to remove orphaned rows",
    );
    // Safety check: only deletes those with no linked accounts
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
    // Either there are no <details> at all, or the explanation block comes
    // before any <details> element (i.e., it is not wrapped in one).
    assert.ok(
      detailsIndex === -1 || explanationIndex < detailsIndex,
      "explanation block must not be inside a <details> element",
    );
  });

  test("expired card shows 'Affects 1 account:' label for single linked account", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes("Affects 1 account:"),
      "single-account group subtitle must say 'Affects 1 account: <label>'",
    );
  });

  test("expired card shows 'Broker-side enforcement paused until reconnect'", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes("Broker-side enforcement paused until reconnect"),
      "expired group card must include enforcement-paused notice",
    );
  });

  test("reconnect button labels use '<env> connection' format", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes("connection`"),
      "reconnect button label must produce '<env> connection' or 'connection'",
    );
    // Must NOT fall back to platform-prefixed label like 'Reconnect Tradovate Demo'
    assert.ok(
      !src.includes("Reconnect {platform}"),
      "reconnect button must not use platform name in label",
    );
  });

  test("orphaned connections render under 'Unused expired connections', not Needs attention", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes("Unused expired connections"),
      "section must have 'Unused expired connections' subsection for orphaned tokens",
    );
    // orphanedExpired.map must appear after the Needs attention block ends
    const needsAttentionIndex = src.indexOf("Needs attention");
    const unusedSectionIndex = src.indexOf("Unused expired connections");
    const orphanedMapIndex = src.indexOf("orphanedExpired.map");
    assert.ok(
      orphanedMapIndex > unusedSectionIndex && unusedSectionIndex > needsAttentionIndex,
      "orphanedExpired.map must appear inside the 'Unused expired connections' section, after 'Needs attention'",
    );
  });
});
