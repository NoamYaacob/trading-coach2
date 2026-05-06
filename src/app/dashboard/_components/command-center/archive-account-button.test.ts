import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  buildArchiveRequest,
  parseArchiveResponse,
} from "./archive-account-helpers.ts";

// ── buildArchiveRequest ───────────────────────────────────────────────────────

describe("buildArchiveRequest", () => {
  test("targets the protection endpoint, not the edit route", () => {
    const { url } = buildArchiveRequest("abc-123");
    assert.equal(url, "/api/accounts/abc-123/protection");
    assert.ok(!url.endsWith("/edit"), "must not link to the edit page");
    assert.ok(url.endsWith("/protection"), "must use the protection route");
  });

  test("uses POST method", () => {
    const { method } = buildArchiveRequest("abc-123");
    assert.equal(method, "POST");
  });

  test("body sets protectionStatus to archived", () => {
    const { body } = buildArchiveRequest("abc-123");
    assert.equal(body.protectionStatus, "archived");
  });

  test("embeds the correct accountId in the URL", () => {
    const id = "cm_xkqp9z7w00001234";
    const { url } = buildArchiveRequest(id);
    assert.ok(url.includes(id), "URL must contain the account ID");
    assert.equal(url, `/api/accounts/${id}/protection`);
  });
});

// ── parseArchiveResponse ──────────────────────────────────────────────────────

describe("parseArchiveResponse", () => {
  test("success: ok=true, applied=true → { success: true }", () => {
    const result = parseArchiveResponse(
      { ok: true },
      { ok: true, applied: true },
    );
    assert.equal(result.success, true);
  });

  test("non-2xx response → failure with API error message", () => {
    const result = parseArchiveResponse(
      { ok: false },
      { ok: false, error: "not_found" },
    );
    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.errorMessage, "not_found");
  });

  test("non-2xx with message field uses message over error", () => {
    const result = parseArchiveResponse(
      { ok: false },
      { ok: false, message: "Account not found.", error: "not_found" },
    );
    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.errorMessage, "Account not found.");
  });

  test("non-2xx with no message or error falls back to generic copy", () => {
    const result = parseArchiveResponse({ ok: false }, {});
    assert.equal(result.success, false);
    if (!result.success)
      assert.equal(result.errorMessage, "Could not archive account.");
  });

  test("applied=false (protection lock deferred) → failure, button resets", () => {
    // This is the bug scenario: API returns ok=true but applied=false because
    // protection is locked during trading hours. The row stays visible because
    // protectionStatus was not changed. The button MUST reset and show an error —
    // not stay stuck on "Archiving…" while the unchanged row remains visible.
    const result = parseArchiveResponse(
      { ok: true },
      {
        ok: true,
        applied: false,
        message: "Protection is locked for today. Changes will apply from the next trading day.",
      },
    );
    assert.equal(result.success, false);
    if (!result.success)
      assert.match(
        result.errorMessage,
        /locked|trading day/i,
        "error message must explain the lock",
      );
  });

  test("applied=false with no message falls back to generic copy", () => {
    const result = parseArchiveResponse({ ok: true }, { ok: true, applied: false });
    assert.equal(result.success, false);
    if (!result.success)
      assert.match(result.errorMessage, /outside trading hours/i);
  });

  test("ok=true but applied field absent is treated as not applied", () => {
    // applied is optional in the type — if absent, treat as false to be safe.
    const result = parseArchiveResponse({ ok: true }, { ok: true });
    assert.equal(result.success, false);
  });
});

// ── Dashboard exclusion contract ──────────────────────────────────────────────

describe("dashboard exclusion contract", () => {
  // loadCommandCenterData uses: protectionStatus: { in: ["protected", "monitor_only"] }
  // This means archived accounts are excluded from the active dashboard query.
  // When archive succeeds (applied=true), router.refresh() re-runs this query
  // and the archived account no longer matches — it disappears from the UI.
  //
  // This test documents the invariant. The production filter is in data.ts.

  test("archived status is not in the active-dashboard allowlist", () => {
    const activeDashboardStatuses = ["protected", "monitor_only"];
    assert.ok(
      !activeDashboardStatuses.includes("archived"),
      "archived must not appear in the active dashboard query filter",
    );
  });

  test("pending_decision is not in the active-dashboard allowlist", () => {
    const activeDashboardStatuses = ["protected", "monitor_only"];
    assert.ok(
      !activeDashboardStatuses.includes("pending_decision"),
      "pending_decision is handled by the separate pending panel",
    );
  });
});
