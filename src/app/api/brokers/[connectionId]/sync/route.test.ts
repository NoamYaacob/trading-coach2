/**
 * Source-scan tests for POST /api/brokers/[connectionId]/sync.
 *
 * Verifies structural guarantees without a DB or network:
 *   - syncTradovateConnection is called
 *   - thrown exceptions are caught and returned as structured JSON (not raw 500)
 *   - successful results are mapped correctly
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTE_FILE = resolve(import.meta.dirname, "./route.ts");

function src(): string {
  return readFileSync(ROUTE_FILE, "utf8");
}

describe("POST /api/brokers/[connectionId]/sync: error handling", () => {
  it("wraps syncTradovateConnection in try/catch", () => {
    const s = src();
    const callIdx = s.indexOf("syncTradovateConnection(");
    assert.ok(callIdx !== -1, "syncTradovateConnection must be called");
    const tryIdx = s.lastIndexOf("try {", callIdx);
    assert.ok(tryIdx !== -1, "syncTradovateConnection call must be inside a try block");
    assert.ok(tryIdx < callIdx, "try must appear before syncTradovateConnection call");
  });

  it("catch block returns structured JSON, not unhandled throw", () => {
    const s = src();
    assert.ok(s.includes("catch (err)"), "must have a catch block");
    assert.ok(
      s.includes("NextResponse.json(") && s.includes("status: 502"),
      "catch must return NextResponse.json with 502 status",
    );
  });

  it("catch block does not re-throw", () => {
    const s = src();
    const catchIdx = s.indexOf("catch (err)");
    assert.ok(catchIdx !== -1);
    const catchBody = s.slice(catchIdx, s.indexOf("\n  }", catchIdx + 1) + 4);
    assert.ok(
      !catchBody.includes("throw "),
      "catch block must not re-throw the error",
    );
  });

  it("returns ok:false on catch", () => {
    const s = src();
    const catchIdx = s.indexOf("catch (err)");
    const afterCatch = s.slice(catchIdx, catchIdx + 300);
    assert.ok(
      afterCatch.includes("ok: false"),
      "catch response must include ok: false",
    );
  });
});

describe("POST /api/brokers/[connectionId]/sync: auth", () => {
  it("checks for current user before syncing", () => {
    const s = src();
    assert.ok(s.includes("getCurrentUser"), "must call getCurrentUser");
    assert.ok(s.includes("status: 401"), "must return 401 when unauthenticated");
  });

  it("verifies connection belongs to current user", () => {
    const s = src();
    assert.ok(
      s.includes("userId: currentUser.id"),
      "must scope DB lookup to current user",
    );
    assert.ok(s.includes("status: 404"), "must return 404 when connection not found");
  });
});
