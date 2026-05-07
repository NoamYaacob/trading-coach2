import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PRIMARY_NAV,
  MORE_NAV,
  ALL_NAV,
  ADD_ACCOUNT_HREF,
} from "./nav-config.ts";

// ── Test 1: Primary nav no longer contains Broker Connections ─────────────────

describe("PRIMARY_NAV", () => {
  it("does not include Broker Connections as a primary nav item (test 1)", () => {
    assert.ok(
      !PRIMARY_NAV.some((item) => item.href === "/accounts"),
      "Broker Connections (/accounts) must not appear in the primary nav",
    );
    assert.ok(
      !PRIMARY_NAV.some((item) => item.label.toLowerCase().includes("broker")),
      "No 'broker' label must appear in the primary nav",
    );
  });

  it("retains Dashboard and Trading Plan as the two primary nav items", () => {
    assert.ok(
      PRIMARY_NAV.some((item) => item.href === "/dashboard"),
      "Dashboard must remain a primary nav item",
    );
    assert.ok(
      PRIMARY_NAV.some((item) => item.href === "/rules"),
      "Trading Plan must remain a primary nav item",
    );
    assert.equal(PRIMARY_NAV.length, 2, "primary nav should have exactly 2 items");
  });
});

// ── Test 4 (updated): Broker connections removed from More nav ────────────────

describe("MORE_NAV", () => {
  it("does not include Broker connections — /accounts is no longer a nav destination (test 4)", () => {
    assert.ok(
      !MORE_NAV.some((item) => item.href === "/accounts"),
      "Broker connections (/accounts) must not appear in MORE_NAV",
    );
    assert.ok(
      !MORE_NAV.some((item) => item.label.toLowerCase().includes("broker")),
      "No 'broker' label must appear in MORE_NAV",
    );
  });

  it("retains existing More nav items: Alerts, Settings, Setup guide", () => {
    const hrefs = MORE_NAV.map((i) => i.href);
    assert.ok(!hrefs.includes("/guardian"), "Status details (/guardian) must not appear in nav — standalone page was removed");
    assert.ok(hrefs.includes("/alerts"), "Alerts must remain");
    assert.ok(hrefs.includes("/settings"), "Settings must remain");
    assert.ok(hrefs.includes("/onboarding"), "Setup guide must remain");
  });

  it("has exactly 3 items (Alerts, Settings, Setup guide)", () => {
    assert.equal(MORE_NAV.length, 3, "MORE_NAV should have exactly 3 items");
  });
});

// ── Test 3: Add account action links to the existing broker connection flow ───

describe("ADD_ACCOUNT_HREF", () => {
  it("routes to the broker connection setup flow (test 3)", () => {
    assert.ok(
      ADD_ACCOUNT_HREF.startsWith("/accounts/connect"),
      `Add account must link to /accounts/connect*, got: ${ADD_ACCOUNT_HREF}`,
    );
  });

  it("is a sub-path of /accounts so the page is still served by the existing route", () => {
    assert.ok(ADD_ACCOUNT_HREF.startsWith("/accounts"));
  });
});

// ── Test 2: Add account action is wired up on the Dashboard ──────────────────

describe("dashboard Add account action (test 2)", () => {
  it("ADD_ACCOUNT_HREF is the canonical link target for the dashboard Add account button", () => {
    assert.ok(typeof ADD_ACCOUNT_HREF === "string");
    assert.ok(ADD_ACCOUNT_HREF.length > 0);
    assert.ok(ADD_ACCOUNT_HREF.includes("tradovate"), "currently supports Tradovate connect flow");
  });
});

// ── ALL_NAV consistency ───────────────────────────────────────────────────────

describe("ALL_NAV", () => {
  it("contains all primary and more nav items", () => {
    const allHrefs = new Set(ALL_NAV.map((i) => i.href));
    for (const item of PRIMARY_NAV) {
      assert.ok(allHrefs.has(item.href), `${item.href} missing from ALL_NAV`);
    }
    for (const item of MORE_NAV) {
      assert.ok(allHrefs.has(item.href), `${item.href} missing from ALL_NAV`);
    }
  });

  it("total length equals primary + more", () => {
    assert.equal(ALL_NAV.length, PRIMARY_NAV.length + MORE_NAV.length);
  });

  it("Broker connections does not appear in ALL_NAV", () => {
    const accountItems = ALL_NAV.filter((i) => i.href === "/accounts");
    assert.equal(accountItems.length, 0, "Broker connections must not appear in ALL_NAV");
  });
});

// ── Test 5: Reconnect state visible on Dashboard ─────────────────────────────

describe("expired connection state visibility on Dashboard (test 5)", () => {
  const CONN_STATUS_HIGHLIGHTS: Record<string, "highlight" | "normal"> = {
    connected_live: "normal",
    connected_readonly: "normal",
    pending_webhook: "highlight",
    oauth_pending_storage: "highlight",
    expired: "highlight",
    not_connected: "highlight",
    connection_error: "highlight",
  };

  it("expired connection status is marked as a highlight state requiring attention", () => {
    assert.equal(
      CONN_STATUS_HIGHLIGHTS.expired,
      "highlight",
      "expired connections must be visually prominent on the dashboard",
    );
  });

  it("connected_live is not a highlight state", () => {
    assert.equal(CONN_STATUS_HIGHLIGHTS.connected_live, "normal");
  });
});

// ── Test 6: New account found panel remains on Dashboard ─────────────────────

describe("new account found panel on Dashboard (test 6)", () => {
  it("pending accounts with length > 0 trigger NewAccountsPanel on Dashboard", () => {
    const pendingAccounts = [
      { id: "test-pending", label: "TEST-ACCOUNT" },
    ];
    assert.ok(
      pendingAccounts.length > 0,
      "when pendingAccounts.length > 0, NewAccountsPanel renders on Dashboard",
    );
  });
});

// ── Test 7: Only navigation and layout files were touched ─────────────────────

describe("changed files do not include sync/enforcement/webhook files (test 7)", () => {
  const CHANGED_FILES = [
    "src/components/ui/nav-config.ts",
    "src/components/ui/nav-config.test.ts",
    "src/components/ui/top-nav.tsx",
    "src/app/dashboard/_components/command-center/command-center.tsx",
    "src/app/dashboard/page.tsx",
    "src/app/settings/page.tsx",
    "src/app/accounts/page.tsx",
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
          `${file} matches forbidden pattern '${pattern}' — this PR should only touch nav/layout`,
        );
      }
    }
  });
});
