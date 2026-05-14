import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { deriveSyncAllStatus, formatSyncAllStatus } from "./sync-all-button-helpers.ts";

// ── deriveSyncAllStatus (response → state) ───────────────────────────────────

describe("deriveSyncAllStatus", () => {
  it("200 OK with all accounts synced → success", () => {
    const status = deriveSyncAllStatus({
      httpOk: true,
      status: 200,
      body: { ok: true, syncedAccounts: 3, failedAccounts: 0 },
    });
    assert.equal(status.kind, "success");
    if (status.kind === "success") {
      assert.equal(status.syncedAccounts, 3);
      assert.equal(status.failedAccounts, 0);
    }
  });

  it("200 OK with partial failures → success with failed count", () => {
    const status = deriveSyncAllStatus({
      httpOk: true,
      status: 200,
      body: { ok: false, syncedAccounts: 2, failedAccounts: 1 },
    });
    assert.equal(status.kind, "success");
    if (status.kind === "success") {
      assert.equal(status.syncedAccounts, 2);
      assert.equal(status.failedAccounts, 1);
    }
  });

  it("200 OK with no accounts to sync → success with zeros", () => {
    const status = deriveSyncAllStatus({
      httpOk: true,
      status: 200,
      body: { ok: true, syncedAccounts: 0, failedAccounts: 0 },
    });
    assert.equal(status.kind, "success");
  });

  it("429 with retryAfterSeconds → error mentioning retry seconds", () => {
    const status = deriveSyncAllStatus({
      httpOk: false,
      status: 429,
      body: { error: "too_many_requests", retryAfterSeconds: 42 },
    });
    assert.equal(status.kind, "error");
    if (status.kind === "error") {
      assert.ok(status.message.includes("42"), `expected '42' in message, got: ${status.message}`);
    }
  });

  it("429 without retryAfterSeconds → generic too-many-requests error", () => {
    const status = deriveSyncAllStatus({
      httpOk: false,
      status: 429,
      body: { error: "too_many_requests" },
    });
    assert.equal(status.kind, "error");
    if (status.kind === "error") {
      assert.ok(status.message.toLowerCase().includes("too many"));
    }
  });

  it("401 unauthorized → error using server error string", () => {
    const status = deriveSyncAllStatus({
      httpOk: false,
      status: 401,
      body: { error: "unauthorized" },
    });
    assert.equal(status.kind, "error");
    if (status.kind === "error") {
      assert.equal(status.message, "unauthorized");
    }
  });

  it("500 with no body → generic error", () => {
    const status = deriveSyncAllStatus({ httpOk: false, status: 500, body: {} });
    assert.equal(status.kind, "error");
    if (status.kind === "error") {
      assert.ok(status.message.toLowerCase().includes("failed"));
    }
  });
});

// ── formatSyncAllStatus (state → user-facing string) ──────────────────────────

describe("formatSyncAllStatus", () => {
  it("idle → null (no message)", () => {
    assert.equal(formatSyncAllStatus({ kind: "idle" }), null);
  });

  it("syncing → 'Refreshing…' (matches the 'Refresh all accounts' button label)", () => {
    assert.equal(formatSyncAllStatus({ kind: "syncing" }), "Refreshing…");
  });

  it("success with no failures → 'Refreshed N.'", () => {
    assert.equal(
      formatSyncAllStatus({ kind: "success", syncedAccounts: 3, failedAccounts: 0 }),
      "Refreshed 3.",
    );
  });

  it("success with failures → 'Refreshed X · Y failed.'", () => {
    assert.equal(
      formatSyncAllStatus({ kind: "success", syncedAccounts: 2, failedAccounts: 1 }),
      "Refreshed 2 · 1 failed.",
    );
  });

  it("success with zero accounts → 'Nothing to refresh.'", () => {
    assert.equal(
      formatSyncAllStatus({ kind: "success", syncedAccounts: 0, failedAccounts: 0 }),
      "Nothing to refresh.",
    );
  });

  it("error → returns the error message verbatim", () => {
    assert.equal(
      formatSyncAllStatus({ kind: "error", message: "Network error. Please try again." }),
      "Network error. Please try again.",
    );
  });
});

// ── Button label refresh wording (regression) ─────────────────────────────────

describe("formatSyncAllStatus — refresh wording (no 'sync all' / 'synced' user-facing)", () => {
  it("syncing message uses 'Refreshing' not 'Syncing'", () => {
    const m = formatSyncAllStatus({ kind: "syncing" });
    assert.ok(m && !m.toLowerCase().includes("syncing"));
    assert.ok(m && m.toLowerCase().includes("refresh"));
  });

  it("success message uses 'Refreshed' not 'Synced'", () => {
    const m = formatSyncAllStatus({ kind: "success", syncedAccounts: 2, failedAccounts: 0 });
    assert.ok(m && !m.toLowerCase().includes("synced"));
    assert.ok(m && m.toLowerCase().includes("refreshed"));
  });

  it("empty success uses 'Nothing to refresh' not 'Nothing to sync'", () => {
    const m = formatSyncAllStatus({ kind: "success", syncedAccounts: 0, failedAccounts: 0 });
    assert.ok(m && !m.toLowerCase().includes("sync"));
    assert.ok(m && m.toLowerCase().includes("refresh"));
  });
});
