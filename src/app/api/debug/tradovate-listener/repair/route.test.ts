/**
 * Source-scan tests for POST /api/debug/tradovate-listener/repair.
 *
 * Verifies action whitelist, ownership scope, token safety, and the
 * action-to-field mapping without booting a server.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTE_SRC = readFileSync(resolve(import.meta.dirname, "./route.ts"), "utf8");

describe("repair: auth + secret guards", () => {
  it("calls getCurrentUser before any DB write", () => {
    const authIdx = ROUTE_SRC.indexOf("getCurrentUser");
    const dbIdx = ROUTE_SRC.indexOf("prisma.");
    assert.ok(authIdx !== -1 && dbIdx !== -1);
    assert.ok(authIdx < dbIdx);
  });

  it("returns 401 when unauthenticated and 403 on bad secret", () => {
    assert.ok(ROUTE_SRC.includes("401"));
    assert.ok(ROUTE_SRC.includes("403"));
    assert.ok(ROUTE_SRC.includes("x-cron-secret"));
    assert.ok(ROUTE_SRC.includes("CRON_SECRET"));
  });
});

describe("repair: action whitelist", () => {
  it("accepts the three documented actions only", () => {
    assert.ok(ROUTE_SRC.includes('"clear_error"'));
    assert.ok(ROUTE_SRC.includes('"clear_error_and_retry"'));
    assert.ok(ROUTE_SRC.includes('"disable_connection_listener"'));
  });

  it("rejects unknown actions with 400 + validActions list", () => {
    assert.ok(ROUTE_SRC.includes("invalid action"));
    assert.ok(ROUTE_SRC.includes("400"));
    assert.ok(ROUTE_SRC.includes("validActions"));
  });

  it("rejects missing connectionId with 400", () => {
    assert.ok(ROUTE_SRC.includes("connectionId required"));
  });
});

describe("repair: ownership scope", () => {
  it("loads connection scoped to current user before writing", () => {
    assert.ok(
      ROUTE_SRC.includes("userId: currentUser.id"),
      "must scope lookup to currentUser.id",
    );
    assert.ok(ROUTE_SRC.includes("findFirst"));
  });

  it("returns 404 when the connection is not found / not owned", () => {
    assert.ok(ROUTE_SRC.includes("404"));
    assert.ok(ROUTE_SRC.includes("not owned by current user"));
  });
});

describe("repair: action -> field mapping", () => {
  it("clear_error clears retry tracking and disabled flag", () => {
    // clear_error must set listenerStatus=null, listenerNextRetryAt=null,
    // listenerRetryCount=0, listenerLastAuthFailureAt=null, listenerDisabledAt=null
    assert.ok(ROUTE_SRC.includes("listenerStatus: null"));
    assert.ok(ROUTE_SRC.includes("listenerNextRetryAt: null"));
    assert.ok(ROUTE_SRC.includes("listenerRetryCount: 0"));
    assert.ok(ROUTE_SRC.includes("listenerLastAuthFailureAt: null"));
    assert.ok(ROUTE_SRC.includes("listenerDisabledAt: null"));
  });

  it("clear_error_and_retry schedules listenerNextRetryAt = now", () => {
    assert.ok(
      ROUTE_SRC.includes("listenerNextRetryAt: now"),
      "clear_error_and_retry must set nextRetryAt to now",
    );
  });

  it("disable_connection_listener sets listenerDisabledAt = now", () => {
    assert.ok(
      ROUTE_SRC.includes("listenerDisabledAt: now"),
      "disable_connection_listener must stamp listenerDisabledAt",
    );
  });
});

describe("repair: token safety", () => {
  const TOKEN_FIELDS = [
    "accessToken",
    "refreshToken",
    "accessTokenEncrypted",
    "refreshTokenEncrypted",
    "tokenEncrypted",
  ];

  it("never selects, reads, or returns token fields", () => {
    for (const f of TOKEN_FIELDS) {
      assert.ok(!ROUTE_SRC.includes(`${f}: true`), `must not select ${f}`);
      assert.ok(!ROUTE_SRC.includes(`${f}:`), `must not write ${f}`);
    }
    assert.ok(
      !ROUTE_SRC.includes("parseAndDecrypt"),
      "repair endpoint must not decrypt tokens",
    );
  });
});
