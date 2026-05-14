/**
 * Source-scan tests for GET /api/debug/tradovate-listener/status.
 *
 * Confirms auth + secret guards, returned shape, and token safety without
 * spinning up an HTTP server.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTE_SRC = readFileSync(resolve(import.meta.dirname, "./route.ts"), "utf8");

describe("status: auth guard", () => {
  it("calls getCurrentUser before any DB query", () => {
    assert.ok(ROUTE_SRC.includes("getCurrentUser"));
    const authIdx = ROUTE_SRC.indexOf("getCurrentUser");
    const dbIdx = ROUTE_SRC.indexOf("prisma.");
    assert.ok(authIdx !== -1 && dbIdx !== -1);
    assert.ok(authIdx < dbIdx, "auth check must precede DB access");
  });

  it("returns 401 when unauthenticated", () => {
    assert.ok(ROUTE_SRC.includes("401"));
  });
});

describe("status: production secret guard", () => {
  it("checks NODE_ENV === production", () => {
    assert.ok(
      ROUTE_SRC.includes("NODE_ENV") && ROUTE_SRC.includes("production"),
    );
  });

  it("reads x-cron-secret and compares to CRON_SECRET", () => {
    assert.ok(ROUTE_SRC.includes("x-cron-secret"));
    assert.ok(ROUTE_SRC.includes("CRON_SECRET"));
    assert.ok(ROUTE_SRC.includes("403"));
  });
});

describe("status: scope isolation", () => {
  it("filters BrokerConnection by current user", () => {
    assert.ok(
      ROUTE_SRC.includes("userId: currentUser.id"),
      "must scope query to currentUser.id",
    );
  });

  it("only queries the tradovate platform", () => {
    assert.ok(
      ROUTE_SRC.includes('platform: "tradovate"'),
      "platform filter must be present",
    );
  });
});

describe("status: token safety", () => {
  const TOKEN_FIELDS = [
    "accessToken",
    "refreshToken",
    "accessTokenEncrypted",
    "refreshTokenEncrypted",
    "tokenEncrypted",
  ];

  it("never selects token fields and never references parseAndDecrypt", () => {
    assert.ok(
      !ROUTE_SRC.includes("parseAndDecrypt"),
      "status endpoint must not decrypt tokens",
    );
    for (const f of TOKEN_FIELDS) {
      assert.ok(
        !ROUTE_SRC.includes(`${f}: true`),
        `must not select ${f}`,
      );
    }
  });
});

describe("status: returns expected fields", () => {
  it("returns the planner-derived listenerEligibility", () => {
    assert.ok(ROUTE_SRC.includes("listenerEligibility"));
    assert.ok(ROUTE_SRC.includes("planListenerStartups"));
    assert.ok(ROUTE_SRC.includes("wouldStart"));
    assert.ok(ROUTE_SRC.includes("skipReason"));
  });

  it("returns the endpoint chain (tokenUrlHost, restBaseHost, wsHost)", () => {
    assert.ok(ROUTE_SRC.includes("tokenUrlHost"));
    assert.ok(ROUTE_SRC.includes("restBaseHost"));
    assert.ok(ROUTE_SRC.includes("wsHost"));
    assert.ok(ROUTE_SRC.includes("tokenAndRestSameHost"));
  });

  it("returns retry tracking fields", () => {
    assert.ok(ROUTE_SRC.includes("lastAuthFailureAt"));
    assert.ok(ROUTE_SRC.includes("nextRetryAt"));
    assert.ok(ROUTE_SRC.includes("retryCount"));
  });

  it("returns last auth status and last close code/reason", () => {
    assert.ok(ROUTE_SRC.includes("lastAuthStatus"));
    assert.ok(ROUTE_SRC.includes("lastCloseCode"));
    assert.ok(ROUTE_SRC.includes("lastCloseReason"));
  });

  it("returns worker env-var flags so operators can confirm settings", () => {
    assert.ok(ROUTE_SRC.includes("TRADOVATE_LISTENER_ENABLE_LIVE"));
    assert.ok(ROUTE_SRC.includes("TRADOVATE_LISTENER_DISABLED"));
    assert.ok(ROUTE_SRC.includes("TRADOVATE_LISTENER_CONNECTION_ID"));
  });
});
