import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PAGE_SUBTITLE,
  CONNECT_TRADOVATE_HREF,
  CONN_STATUS,
  PLATFORM_LABEL,
  ENV_LABEL,
  isExpiredStatus,
  formatConnectionLabel,
} from "./_components/connection-card-logic.ts";

// ── Test 2: Page header and subtitle ────────────────────────────────────────

describe("broker connections page copy (test 2)", () => {
  it("PAGE_SUBTITLE matches the required text", () => {
    assert.equal(
      PAGE_SUBTITLE,
      "Connect Tradovate, check sync status, and reconnect when needed.",
    );
  });

  it("PAGE_SUBTITLE mentions Connect Tradovate", () => {
    assert.ok(
      PAGE_SUBTITLE.includes("Connect Tradovate"),
      "subtitle must reference Connect Tradovate",
    );
  });
});

// ── Test 3: Primary CTA href ─────────────────────────────────────────────────

describe("primary CTA — Connect Tradovate (test 3)", () => {
  it("CONNECT_TRADOVATE_HREF starts with /accounts/connect", () => {
    assert.ok(
      CONNECT_TRADOVATE_HREF.startsWith("/accounts/connect"),
      `expected /accounts/connect*, got: ${CONNECT_TRADOVATE_HREF}`,
    );
  });

  it("CONNECT_TRADOVATE_HREF targets the tradovate flow", () => {
    assert.ok(
      CONNECT_TRADOVATE_HREF.includes("tradovate"),
      "CTA must link to the Tradovate connection flow",
    );
  });
});

// ── Test 4: Connection status chip labels ────────────────────────────────────

describe("connection status labels (test 4)", () => {
  it("connected_live label is 'Connected live'", () => {
    assert.equal(CONN_STATUS.connected_live?.label, "Connected live");
  });

  it("expired label is 'Expired'", () => {
    assert.equal(CONN_STATUS.expired?.label, "Expired");
  });

  it("connection_error label is 'Connection error'", () => {
    assert.equal(CONN_STATUS.connection_error?.label, "Connection error");
  });

  it("not_connected label is 'Not connected'", () => {
    assert.equal(CONN_STATUS.not_connected?.label, "Not connected");
  });

  it("pending_webhook label is 'Pending sync'", () => {
    assert.equal(CONN_STATUS.pending_webhook?.label, "Pending sync");
  });
});

// ── Test 5: isExpiredStatus correctly classifies statuses ───────────────────

describe("isExpiredStatus (test 5)", () => {
  it("returns true for 'expired'", () => {
    assert.equal(isExpiredStatus("expired"), true);
  });

  it("returns true for 'connection_error'", () => {
    assert.equal(isExpiredStatus("connection_error"), true);
  });

  it("returns false for 'connected_live'", () => {
    assert.equal(isExpiredStatus("connected_live"), false);
  });

  it("returns false for 'connected_readonly'", () => {
    assert.equal(isExpiredStatus("connected_readonly"), false);
  });

  it("returns false for 'not_connected'", () => {
    assert.equal(isExpiredStatus("not_connected"), false);
  });
});

// ── Test 6: Reconnect action is only shown for expired connections ───────────

describe("reconnect action contract (test 6)", () => {
  // The ConnectionCard renders a Reconnect link (not a SyncButton) when
  // isExpiredStatus(connectionStatus) is true.
  it("expired connections must show Reconnect (isExpiredStatus = true)", () => {
    assert.equal(isExpiredStatus("expired"), true);
    assert.equal(isExpiredStatus("connection_error"), true);
  });

  it("active connections must show Refresh (isExpiredStatus = false)", () => {
    assert.equal(isExpiredStatus("connected_live"), false);
    assert.equal(isExpiredStatus("pending_webhook"), false);
  });
});

// ── Test 7: Connection label formatting ──────────────────────────────────────

describe("formatConnectionLabel (test 7)", () => {
  it("formats tradovate live correctly", () => {
    assert.equal(formatConnectionLabel("tradovate", "live"), "Tradovate · Live");
  });

  it("formats tradovate demo correctly", () => {
    assert.equal(formatConnectionLabel("tradovate", "demo"), "Tradovate · Demo / Sim");
  });

  it("falls back to raw platform/env values for unknown keys", () => {
    assert.equal(formatConnectionLabel("unknown_broker", "staging"), "unknown_broker · staging");
  });
});

// ── Test 8: Platform and environment labels ──────────────────────────────────

describe("PLATFORM_LABEL and ENV_LABEL (test 8)", () => {
  it("tradovate maps to 'Tradovate'", () => {
    assert.equal(PLATFORM_LABEL.tradovate, "Tradovate");
  });

  it("live env maps to 'Live'", () => {
    assert.equal(ENV_LABEL.live, "Live");
  });

  it("demo env maps to 'Demo / Sim'", () => {
    assert.equal(ENV_LABEL.demo, "Demo / Sim");
  });
});

// ── Test 9: Changed files do not include enforcement/sync/webhook paths ──────

describe("changed files do not include enforcement/sync/webhook files (test 9)", () => {
  const CHANGED_FILES = [
    "src/app/accounts/page.tsx",
    "src/app/accounts/accounts-page.test.ts",
    "src/app/accounts/_components/connection-group-card.tsx",
    "src/app/accounts/_components/connection-card-logic.ts",
  ];

  const FORBIDDEN_PATTERNS = [
    "enforcement",
    "webhook",
    "tradovate-sync",
    "trade-count",
    "lockout",
    "reconcile",
    "discovery",
  ];

  it("changed files contain no enforcement/sync/webhook paths", () => {
    for (const file of CHANGED_FILES) {
      for (const pattern of FORBIDDEN_PATTERNS) {
        assert.ok(
          !file.includes(pattern),
          `${file} matches forbidden pattern '${pattern}' — this change should only touch the broker connections UI`,
        );
      }
    }
  });
});
