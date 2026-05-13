/**
 * Tests for POST /api/debug/accounts/[accountId]/reset-session-state
 *
 * These are source-audit tests — the endpoint requires DB and auth which are not
 * available in unit tests. All behavioral properties are verified by reading the
 * route source and asserting on structural patterns.
 *
 * Run: npm run test:unit
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTE_SRC = readFileSync(resolve(import.meta.dirname, "./route.ts"), "utf8");

const DEBUG_ENDPOINT_SRC = readFileSync(
  resolve(
    import.meta.dirname,
    "../../../tradovate-position-limit/route.ts",
  ),
  "utf8",
);

// ── Authorization guard ────────────────────────────────────────────────────────

describe("reset-session-state: production guard returns 403", () => {
  it("route checks NODE_ENV === 'production' and returns 403", () => {
    assert.ok(
      ROUTE_SRC.includes('process.env.NODE_ENV === "production"') ||
        ROUTE_SRC.includes("NODE_ENV === 'production'"),
      "route must check NODE_ENV for production guard",
    );
    assert.ok(
      ROUTE_SRC.includes("status: 403"),
      "route must return HTTP 403 when production guard fires",
    );
  });

  it("route checks x-cron-secret header against CRON_SECRET env var", () => {
    assert.ok(
      ROUTE_SRC.includes('request.headers.get("x-cron-secret")'),
      "route must read the x-cron-secret header",
    );
    assert.ok(
      ROUTE_SRC.includes("CRON_SECRET"),
      "route must compare against CRON_SECRET env var",
    );
  });

  it("production without valid secret returns 403 (not 401)", () => {
    // 403 is chosen over 401 so the caller gets a clear authorization error.
    // The endpoint is explicitly forbidden in production without CRON_SECRET.
    // (The route also returns 404 for account-not-found, which is legitimate.)
    assert.ok(ROUTE_SRC.includes("status: 403"), "production block must use status 403");
    assert.ok(
      !ROUTE_SRC.includes("error: \"unauthorized\"") || ROUTE_SRC.includes("status: 401"),
      "route must distinguish 403 (production guard) from 401 (no user session)",
    );
  });

  it("route requires authenticated user via getCurrentUser()", () => {
    assert.ok(
      ROUTE_SRC.includes("getCurrentUser"),
      "route must call getCurrentUser() for user authentication",
    );
    assert.ok(
      ROUTE_SRC.includes("status: 401"),
      "route must return 401 when user is not authenticated",
    );
  });

  it("route verifies account ownership (account must belong to the authenticated user)", () => {
    assert.ok(
      ROUTE_SRC.includes("userId: currentUser.id"),
      "ownership check must filter by userId to prevent cross-account access",
    );
  });
});

// ── Reset behavior ─────────────────────────────────────────────────────────────

describe("reset-session-state: resets STOPPED → NORMAL correctly", () => {
  it("reset sets riskState to NORMAL", () => {
    assert.ok(
      ROUTE_SRC.includes('riskState: "NORMAL"'),
      "reset must write riskState: NORMAL to liveSessionState",
    );
  });

  it("reset clears pendingSessionEndLock", () => {
    assert.ok(
      ROUTE_SRC.includes("pendingSessionEndLock: false"),
      "reset must clear pendingSessionEndLock",
    );
  });

  it("reset clears cooldownActive and cooldownUntil", () => {
    assert.ok(
      ROUTE_SRC.includes("cooldownActive: false"),
      "reset must clear cooldownActive",
    );
    assert.ok(
      ROUTE_SRC.includes("cooldownUntil: null"),
      "reset must clear cooldownUntil",
    );
  });

  it("response includes previousRiskState and newRiskState", () => {
    assert.ok(
      ROUTE_SRC.includes("previousRiskState"),
      "response must include previousRiskState so caller knows what it was before",
    );
    assert.ok(
      ROUTE_SRC.includes('newRiskState: "NORMAL"'),
      "response must confirm newRiskState is NORMAL",
    );
  });

  it("response includes changed flag (false when already NORMAL)", () => {
    assert.ok(
      ROUTE_SRC.includes("changed: previousRiskState !== \"NORMAL\""),
      "changed flag must be false when riskState was already NORMAL",
    );
  });

  it("handles missing LiveSessionState gracefully (returns changed: false)", () => {
    assert.ok(
      ROUTE_SRC.includes("changed: false") && ROUTE_SRC.includes("No LiveSessionState"),
      "route must handle the case where no liveSessionState row exists",
    );
  });
});

// ── Does NOT touch rules or broker connection ──────────────────────────────────

describe("reset-session-state: safe isolation — does not touch rules or tokens", () => {
  it("route does NOT update riskRules or accountRiskRules", () => {
    assert.ok(
      !ROUTE_SRC.includes("riskRules.update"),
      "reset must not modify default risk rules",
    );
    assert.ok(
      !ROUTE_SRC.includes("accountRiskRules.update"),
      "reset must not modify account risk rules",
    );
  });

  it("route does NOT update brokerConnection", () => {
    assert.ok(
      !ROUTE_SRC.includes("brokerConnection.update"),
      "reset must not touch broker connection record",
    );
  });

  it("route does NOT delete NormalizedTradeEvent rows", () => {
    assert.ok(
      !ROUTE_SRC.includes("normalizedTradeEvent.delete"),
      "reset must not delete trade history",
    );
  });

  it("route does NOT delete GuardianIntervention rows", () => {
    assert.ok(
      !ROUTE_SRC.includes("guardianIntervention.delete"),
      "reset must not delete violation history",
    );
  });

  it("route does NOT touch maxContracts or any risk rule field", () => {
    // Check for prisma writes to risk rule tables or fields — not just the string
    // "maxContracts" which may appear in comments documenting what we skip.
    assert.ok(
      !ROUTE_SRC.includes("riskRules.update") && !ROUTE_SRC.includes("accountRiskRules.update"),
      "reset must not write to riskRules or accountRiskRules tables",
    );
    assert.ok(
      !ROUTE_SRC.includes("maxContracts:"),
      "reset must not assign to a maxContracts field",
    );
  });
});

// ── No token fields logged ─────────────────────────────────────────────────────

describe("reset-session-state: no token fields in logs", () => {
  const FORBIDDEN = [
    "accessToken",
    "refreshToken",
    "tokenEncrypted",
    "accessTokenEncrypted",
    "refreshTokenEncrypted",
  ];

  for (const field of FORBIDDEN) {
    it(`route must not reference token field '${field}' in logs`, () => {
      assert.ok(
        !ROUTE_SRC.includes(field),
        `reset-session-state route must not log token field: ${field}`,
      );
    });
  }
});

// ── Debug endpoint exposes resetSessionEndpoint only in non-production ─────────

describe("tradovate-position-limit debug endpoint: resetSessionEndpoint visibility", () => {
  it("resetSessionEndpoint is included in the debug response", () => {
    assert.ok(
      DEBUG_ENDPOINT_SRC.includes("resetSessionEndpoint"),
      "debug endpoint must include resetSessionEndpoint in the response",
    );
  });

  it("resetSessionEndpoint is null in production (NODE_ENV check)", () => {
    // The debug endpoint checks NODE_ENV !== 'production' before including the URL.
    // This prevents advertising the QA endpoint path in production JSON responses.
    assert.ok(
      DEBUG_ENDPOINT_SRC.includes("NODE_ENV") &&
        (DEBUG_ENDPOINT_SRC.includes('!== "production"') ||
          DEBUG_ENDPOINT_SRC.includes("isNonProduction")),
      "resetSessionEndpoint must be guarded by a NODE_ENV production check",
    );
  });

  it("alreadyStoppedNow field is derived from currentRiskState", () => {
    assert.ok(
      DEBUG_ENDPOINT_SRC.includes("alreadyStoppedNow"),
      "debug endpoint must expose alreadyStoppedNow field (renamed from alreadyStopped)",
    );
    assert.ok(
      DEBUG_ENDPOINT_SRC.includes('currentRiskState === "STOPPED"'),
      "alreadyStoppedNow must be derived from currentRiskState === 'STOPPED'",
    );
  });

  it("resetSessionEndpoint path includes the accountId", () => {
    assert.ok(
      DEBUG_ENDPOINT_SRC.includes("reset-session-state"),
      "resetSessionEndpoint URL must point to reset-session-state",
    );
    assert.ok(
      DEBUG_ENDPOINT_SRC.includes("accountId") &&
        DEBUG_ENDPOINT_SRC.includes("reset-session-state"),
      "resetSessionEndpoint must be scoped to the specific accountId",
    );
  });
});
