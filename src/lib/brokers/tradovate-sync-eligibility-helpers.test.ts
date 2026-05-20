/**
 * Tests for tradovate-sync-eligibility-helpers.ts and the eligibility route.
 *
 * Pure-logic tests on deriveAccountEligibility + deriveConnectionEligibility
 * (no Prisma, no network). Source-scan guards verify the route never performs
 * DB writes or triggers a sync.
 *
 * Run: npm run test:unit
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  deriveAccountEligibility,
  deriveConnectionEligibility,
  CRON_FRESHNESS_THRESHOLD_MS,
  PARTIAL_SYNC_SUSPECT_MARGIN_MS,
  type AccountEligibilityInput,
  type AccountEligibilitySummary,
} from "./tradovate-sync-eligibility-helpers.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROUTE_SRC = readFileSync(
  resolve(__dirname, "../../app/api/debug/tradovate-sync/eligibility/route.ts"),
  "utf8",
);
const HELPERS_SRC = readFileSync(
  join(__dirname, "tradovate-sync-eligibility-helpers.ts"),
  "utf8",
);

// ── Source-scan: route must be read-only ──────────────────────────────────────

describe("source-scan: route has no DB writes", () => {
  it("never calls prisma create", () => {
    assert.ok(!ROUTE_SRC.includes(".create("), "route must not call .create()");
  });

  it("never calls prisma upsert", () => {
    assert.ok(!ROUTE_SRC.includes(".upsert("), "route must not call .upsert()");
  });

  it("never calls prisma update", () => {
    assert.ok(!ROUTE_SRC.includes(".update("), "route must not call .update()");
  });

  it("never calls prisma delete", () => {
    assert.ok(!ROUTE_SRC.includes(".delete("), "route must not call .delete()");
  });

  it("never calls syncTradovateAccount or syncTradovateConnection", () => {
    assert.ok(
      !ROUTE_SRC.includes("syncTradovateAccount"),
      "route must not trigger account sync",
    );
    assert.ok(
      !ROUTE_SRC.includes("syncTradovateConnection"),
      "route must not trigger connection sync",
    );
  });

  it("response includes the read-only diagnostic note", () => {
    assert.ok(
      ROUTE_SRC.includes("Read-only sync eligibility diagnostic — no sync was triggered"),
      "route response must carry the safety note",
    );
  });

  it("requires x-cron-secret (forbidden path present)", () => {
    assert.ok(
      ROUTE_SRC.includes("x-cron-secret"),
      "route must check x-cron-secret header",
    );
    assert.ok(
      ROUTE_SRC.includes("forbidden"),
      "route must return 403 on missing/wrong secret",
    );
  });
});

describe("source-scan: helpers have no DB writes or side effects", () => {
  it("never imports from @/lib/db or prisma client", () => {
    assert.ok(!HELPERS_SRC.includes("@/lib/db"), "helpers must not import Prisma");
    assert.ok(!HELPERS_SRC.includes("@prisma/client"), "helpers must not import Prisma client");
  });

  it("never imports from next/server", () => {
    assert.ok(!HELPERS_SRC.includes("next/server"), "helpers must not import Next.js");
  });
});

// ── Test fixture ──────────────────────────────────────────────────────────────

const now = new Date("2026-05-15T10:00:00Z");

function makeInput(overrides: Partial<AccountEligibilityInput> = {}): AccountEligibilityInput {
  return {
    accountId: "acct_test",
    label: "DEMO7433035",
    externalAccountId: "47669364",
    isActive: true,
    protectionStatus: "protected",
    errorMessage: null,
    lastSyncAt: null,
    missingFromBrokerSince: null,
    sessionUpdatedAt: null,
    connectionStatusEligible: true,
    now,
    freshnessThresholdMs: CRON_FRESHNESS_THRESHOLD_MS,
    ...overrides,
  };
}

// ── lastSyncAt freshness ──────────────────────────────────────────────────────

describe("lastSyncAt freshness", () => {
  it("wouldSync=true and skipReason=never_synced when lastSyncAt is null", () => {
    const result = deriveAccountEligibility(makeInput({ lastSyncAt: null }));
    assert.equal(result.wouldSync, true);
    assert.equal(result.skipReason, "never_synced");
    assert.equal(result.lastSyncAgeMs, null);
  });

  it("wouldSync=false and skipReason=last_sync_too_recent when synced within threshold", () => {
    const recentSyncAt = new Date(now.getTime() - 2 * 60 * 1000); // 2 min ago
    const result = deriveAccountEligibility(makeInput({ lastSyncAt: recentSyncAt }));
    assert.equal(result.wouldSync, false);
    assert.equal(result.skipReason, "last_sync_too_recent");
    assert.ok(result.lastSyncAgeMs !== null && result.lastSyncAgeMs <= CRON_FRESHNESS_THRESHOLD_MS);
  });

  it("wouldSync=true when lastSyncAt is older than threshold", () => {
    const staleSyncAt = new Date(now.getTime() - 10 * 60 * 1000); // 10 min ago
    const result = deriveAccountEligibility(makeInput({ lastSyncAt: staleSyncAt }));
    assert.equal(result.wouldSync, true);
    assert.equal(result.skipReason, null);
    assert.ok(result.lastSyncAgeMs !== null && result.lastSyncAgeMs > CRON_FRESHNESS_THRESHOLD_MS);
  });

  it("wouldSync=false when synced exactly at threshold boundary", () => {
    const exactSyncAt = new Date(now.getTime() - CRON_FRESHNESS_THRESHOLD_MS);
    const result = deriveAccountEligibility(makeInput({ lastSyncAt: exactSyncAt }));
    // age == threshold means NOT stale (needsSync uses strict >)
    assert.equal(result.wouldSync, false);
    assert.equal(result.skipReason, "last_sync_too_recent");
  });

  it("wouldSync=true when synced just past threshold", () => {
    const justPastSyncAt = new Date(now.getTime() - CRON_FRESHNESS_THRESHOLD_MS - 1);
    const result = deriveAccountEligibility(makeInput({ lastSyncAt: justPastSyncAt }));
    assert.equal(result.wouldSync, true);
  });
});

// ── Account status gates ──────────────────────────────────────────────────────

describe("inactive account", () => {
  it("wouldSync=false and skipReason=inactive_account when isActive=false", () => {
    const result = deriveAccountEligibility(makeInput({ isActive: false }));
    assert.equal(result.wouldSync, false);
    assert.equal(result.skipReason, "inactive_account");
  });
});

describe("unprotected account", () => {
  it("wouldSync=false and skipReason=unprotected_account for pending_decision", () => {
    const result = deriveAccountEligibility(makeInput({ protectionStatus: "pending_decision" }));
    assert.equal(result.wouldSync, false);
    assert.equal(result.skipReason, "unprotected_account");
  });

  it("wouldSync=false for ignored protectionStatus", () => {
    const result = deriveAccountEligibility(makeInput({ protectionStatus: "ignored" }));
    assert.equal(result.wouldSync, false);
    assert.equal(result.skipReason, "unprotected_account");
  });

  it("wouldSync=true for monitor_only (cron-eligible)", () => {
    const result = deriveAccountEligibility(
      makeInput({ protectionStatus: "monitor_only", lastSyncAt: null }),
    );
    assert.equal(result.wouldSync, true);
  });
});

describe("missing from broker", () => {
  it("wouldSync=false and skipReason=missing_from_broker when missingFromBrokerSince is set", () => {
    const result = deriveAccountEligibility(
      makeInput({ missingFromBrokerSince: new Date() }),
    );
    assert.equal(result.wouldSync, false);
    assert.equal(result.skipReason, "missing_from_broker");
  });
});

describe("connection_status_excluded", () => {
  it("wouldSync=false and skipReason=connection_status_excluded when connection is ineligible", () => {
    const result = deriveAccountEligibility(makeInput({ connectionStatusEligible: false }));
    assert.equal(result.wouldSync, false);
    assert.equal(result.skipReason, "connection_status_excluded");
  });

  it("takes priority over account-level gates", () => {
    // Even a never-synced, protected, active account is excluded when conn status is wrong.
    const result = deriveAccountEligibility(
      makeInput({ connectionStatusEligible: false, lastSyncAt: null }),
    );
    assert.equal(result.skipReason, "connection_status_excluded");
  });
});

// ── Gate priority order ───────────────────────────────────────────────────────

describe("gate priority", () => {
  it("connection_status_excluded before inactive_account", () => {
    const result = deriveAccountEligibility(
      makeInput({ connectionStatusEligible: false, isActive: false }),
    );
    assert.equal(result.skipReason, "connection_status_excluded");
  });

  it("inactive_account before missing_from_broker", () => {
    const result = deriveAccountEligibility(
      makeInput({ isActive: false, missingFromBrokerSince: new Date() }),
    );
    assert.equal(result.skipReason, "inactive_account");
  });

  it("missing_from_broker before unprotected_account", () => {
    const result = deriveAccountEligibility(
      makeInput({ missingFromBrokerSince: new Date(), protectionStatus: "pending_decision" }),
    );
    assert.equal(result.skipReason, "missing_from_broker");
  });

  it("unprotected_account before last_sync_too_recent", () => {
    const recentSyncAt = new Date(now.getTime() - 60_000);
    const result = deriveAccountEligibility(
      makeInput({ protectionStatus: "pending_decision", lastSyncAt: recentSyncAt }),
    );
    assert.equal(result.skipReason, "unprotected_account");
  });
});

// ── partialSyncSuspected ──────────────────────────────────────────────────────

describe("partialSyncSuspected", () => {
  it("false when lastSyncAt is null", () => {
    const result = deriveAccountEligibility(makeInput({ lastSyncAt: null }));
    assert.equal(result.partialSyncSuspected, false);
  });

  it("true when errorMessage is set alongside a recent lastSyncAt", () => {
    const recentSyncAt = new Date(now.getTime() - 60_000);
    const result = deriveAccountEligibility(
      makeInput({ lastSyncAt: recentSyncAt, errorMessage: "Sync failed (SYNC_FAILED)." }),
    );
    assert.equal(result.partialSyncSuspected, true);
  });

  it("true when lastSyncAt is newer than sessionUpdatedAt by more than the margin", () => {
    const sessionUpdatedAt = new Date(now.getTime() - 10 * 60 * 1000); // 10 min ago
    const lastSyncAt = new Date(now.getTime() - 60_000); // 1 min ago, well after session
    const result = deriveAccountEligibility(
      makeInput({ lastSyncAt, sessionUpdatedAt }),
    );
    // diff = 9 min > 30s margin
    assert.equal(result.partialSyncSuspected, true);
  });

  it("false when lastSyncAt and sessionUpdatedAt are close together", () => {
    const base = now.getTime() - 60_000;
    const lastSyncAt = new Date(base);
    const sessionUpdatedAt = new Date(base + 5_000); // 5s after — normal sync lag
    const result = deriveAccountEligibility(
      makeInput({ lastSyncAt, sessionUpdatedAt }),
    );
    // diff = -5s (session is newer) — not suspected
    assert.equal(result.partialSyncSuspected, false);
  });

  it("false when lastSyncAt is slightly newer than sessionUpdatedAt within margin", () => {
    const sessionUpdatedAt = new Date(now.getTime() - 60_000);
    const lastSyncAt = new Date(now.getTime() - 60_000 + 10_000); // 10s newer, within 30s margin
    const result = deriveAccountEligibility(
      makeInput({ lastSyncAt, sessionUpdatedAt }),
    );
    assert.equal(result.partialSyncSuspected, false);
  });

  it("true at exactly the margin boundary (>)", () => {
    const sessionUpdatedAt = new Date(now.getTime() - 60_000);
    const lastSyncAt = new Date(now.getTime() - 60_000 + PARTIAL_SYNC_SUSPECT_MARGIN_MS + 1);
    const result = deriveAccountEligibility(makeInput({ lastSyncAt, sessionUpdatedAt }));
    assert.equal(result.partialSyncSuspected, true);
  });

  it("false at exactly the margin boundary (not >)", () => {
    const sessionUpdatedAt = new Date(now.getTime() - 60_000);
    const lastSyncAt = new Date(now.getTime() - 60_000 + PARTIAL_SYNC_SUSPECT_MARGIN_MS);
    const result = deriveAccountEligibility(makeInput({ lastSyncAt, sessionUpdatedAt }));
    assert.equal(result.partialSyncSuspected, false);
  });
});

// ── deriveConnectionEligibility ───────────────────────────────────────────────

function acct(wouldSync: boolean, skipReason: AccountEligibilitySummary["skipReason"]): AccountEligibilitySummary {
  return { wouldSync, skipReason };
}

describe("deriveConnectionEligibility: connection_status_excluded", () => {
  it("matchesCronFilter=false when connectionStatus not eligible", () => {
    const result = deriveConnectionEligibility({
      connectionStatus: "disconnected",
      accountResults: [acct(true, null)],
    });
    assert.equal(result.matchesCronFilter, false);
    assert.equal(result.connectionSkipReason, "connection_status_excluded");
    assert.equal(result.wouldSync, false);
  });
});

describe("deriveConnectionEligibility: no_eligible_accounts", () => {
  it("matchesCronFilter=false when all accounts are inactive/unprotected", () => {
    const result = deriveConnectionEligibility({
      connectionStatus: "connected_readonly",
      accountResults: [acct(false, "inactive_account"), acct(false, "unprotected_account")],
    });
    assert.equal(result.matchesCronFilter, false);
    assert.equal(result.connectionSkipReason, "no_eligible_accounts");
    assert.equal(result.eligibleAccountCount, 0);
  });
});

describe("deriveConnectionEligibility: stale accounts", () => {
  it("wouldSync=true when connection is eligible and has stale accounts", () => {
    const result = deriveConnectionEligibility({
      connectionStatus: "connected_readonly",
      accountResults: [acct(true, "never_synced"), acct(false, "last_sync_too_recent")],
    });
    assert.equal(result.matchesCronFilter, true);
    assert.equal(result.connectionSkipReason, null);
    assert.equal(result.eligibleAccountCount, 2);
    assert.equal(result.staleAccountCount, 1);
    assert.equal(result.wouldSync, true);
  });

  it("wouldSync=false when all eligible accounts are fresh", () => {
    const result = deriveConnectionEligibility({
      connectionStatus: "connected_live",
      accountResults: [acct(false, "last_sync_too_recent"), acct(false, "last_sync_too_recent")],
    });
    assert.equal(result.matchesCronFilter, true);
    assert.equal(result.wouldSync, false);
    assert.equal(result.staleAccountCount, 0);
  });
});

describe("deriveConnectionEligibility: mixed account statuses", () => {
  it("inactive/missing accounts do not count toward eligibleAccountCount", () => {
    const result = deriveConnectionEligibility({
      connectionStatus: "connected_readonly",
      accountResults: [
        acct(false, "inactive_account"),
        acct(false, "missing_from_broker"),
        acct(false, "last_sync_too_recent"), // eligible but fresh
      ],
    });
    assert.equal(result.matchesCronFilter, true); // third account is eligible
    assert.equal(result.eligibleAccountCount, 1);
    assert.equal(result.staleAccountCount, 0);
  });
});

// ── lastSyncAgeMs ─────────────────────────────────────────────────────────────

describe("lastSyncAgeMs", () => {
  it("is null when lastSyncAt is null", () => {
    const result = deriveAccountEligibility(makeInput({ lastSyncAt: null }));
    assert.equal(result.lastSyncAgeMs, null);
  });

  it("is computed correctly when lastSyncAt is set", () => {
    const lastSyncAt = new Date(now.getTime() - 90_000); // 90 seconds ago
    const result = deriveAccountEligibility(makeInput({ lastSyncAt }));
    assert.equal(result.lastSyncAgeMs, 90_000);
  });
});
