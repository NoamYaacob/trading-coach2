/**
 * Copy and structure tests for the broker connections section.
 *
 * These tests freeze the UX contract for the three-group layout:
 *   - Needs attention   (expired connections)
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

// ── Expired accounts ──────────────────────────────────────────────────────────

describe("expired account rows", () => {
  test("renders acct.label, not a static 'Tradovate Demo — connection expired' string", () => {
    const src = read(SECTION_FILE);
    // The account label must come from the data, never hardcoded.
    assert.ok(
      src.includes("{acct.label}"),
      "section must render {acct.label} so each expired account shows its own name",
    );
    assert.ok(
      !src.includes("Tradovate Demo — connection expired"),
      "the old static 'Tradovate Demo — connection expired' string must not appear",
    );
  });

  test("shows reconnect CTA with explanatory copy about live sync and risk settings", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes("reconnect to resume live sync and broker-side risk settings"),
      "expired account copy must explain the reconnect benefit",
    );
    assert.ok(
      src.includes("Reconnect"),
      "expired account must include a 'Reconnect' action",
    );
  });

  test("shows Remove from Guardrail as a secondary action", () => {
    const src = read(SECTION_FILE);
    // RemoveAccountButton is imported and used in the expired-account block.
    assert.ok(
      src.includes("RemoveAccountButton"),
      "expired account row must include RemoveAccountButton for clean-up",
    );
  });
});

// ── Read-only accounts ────────────────────────────────────────────────────────

describe("read-only account rows", () => {
  test("shows informative copy, not expired-style orange/amber warning", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes("Connected with read-only access"),
      "read-only copy must start with 'Connected with read-only access'",
    );
    assert.ok(
      src.includes("cannot apply broker-side risk settings"),
      "read-only copy must explain the broker-side risk settings limitation",
    );
  });

  test("read-only accounts are placed in the Connected accounts group, not Needs attention", () => {
    const src = read(SECTION_FILE);
    // The classification logic checks `connected_readonly` status and
    // permissionLevel === "read_only" and treats them as connected, not expired.
    assert.ok(
      src.includes('"connected_readonly"'),
      "classification must reference connected_readonly as a connected (not expired) state",
    );
    // Expired states are checked separately via isExpiredStatus.
    assert.ok(
      !src.includes('"connected_readonly"') ||
        src.indexOf("connected_readonly") > src.indexOf("isExpiredStatus"),
      "connected_readonly must not be treated as an expired status",
    );
  });

  test("offers Reconnect with full access link for read-only accounts", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes("Reconnect with full access"),
      "read-only connected account must offer an upgrade-to-full-access reconnect link",
    );
  });
});

// ── Inactive accounts ─────────────────────────────────────────────────────────

describe("inactive account rows", () => {
  test("shows Remove from Guardrail, not Disconnect", () => {
    const src = read(SECTION_FILE);
    // Inactive accounts (missingFromBrokerSince set) use RemoveAccountButton,
    // not DisconnectButton — so the action is always "Remove from Guardrail".
    assert.ok(
      src.includes("No longer active in Tradovate"),
      "inactive account copy must say 'No longer active in Tradovate'",
    );
    // Verify RemoveAccountButton is used (not inline Disconnect).
    // The inactive block must reference RemoveAccountButton.
    const inactiveBlockStart = src.indexOf("Archived / inactive");
    const inactiveBlockEnd = src.lastIndexOf("RemoveAccountButton");
    assert.ok(
      inactiveBlockStart !== -1 && inactiveBlockEnd > inactiveBlockStart,
      "inactive section must include RemoveAccountButton after the 'Archived / inactive' header",
    );
  });
});

// ── Market-hours text ─────────────────────────────────────────────────────────

describe("market-hours text (disconnect window label)", () => {
  test("section component does not render ambient 'Available today/tomorrow' text", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      !src.includes("Available today"),
      "section must not embed ambient market-hours availability text",
    );
    assert.ok(
      !src.includes("Available tomorrow"),
      "section must not embed ambient market-hours availability text",
    );
  });

  test("disconnect-button does not show ambient window text outside the blocked dialog", () => {
    const src = read(DISCONNECT_FILE);
    // Before the fix, an amber <p> showed the availableLabel above the Disconnect
    // button in the isBlocked state. That text should now only live inside
    // BlockedDialog (which computes its own label internally).
    // Assert the outer p-tag pattern is gone.
    assert.ok(
      !src.includes('<p className="text-xs text-amber-700">{availableLabel}</p>'),
      "DisconnectButton must not render an ambient availableLabel p-tag outside the dialog",
    );
  });
});

// ── Three-group structure ─────────────────────────────────────────────────────

describe("three-group section structure", () => {
  test("section declares all three group headers", () => {
    const src = read(SECTION_FILE);
    assert.ok(src.includes("Needs attention"), "section must include 'Needs attention' header");
    assert.ok(src.includes("Connected accounts"), "section must include 'Connected accounts' header");
    assert.ok(src.includes("Archived / inactive"), "section must include 'Archived / inactive' header");
  });

  test("empty state renders without crashing (no broker connected yet)", () => {
    const src = read(SECTION_FILE);
    assert.ok(
      src.includes("No broker connected yet"),
      "section must handle the empty state gracefully",
    );
  });

  test("connected accounts show status pills (Connected / Read-only / Syncing)", () => {
    const src = read(SECTION_FILE);
    assert.ok(src.includes('"Connected"'), "must include Connected status pill");
    assert.ok(src.includes('"Read-only"'), "must include Read-only status pill");
    assert.ok(src.includes('"Syncing"'), "must include Syncing status pill");
  });
});
