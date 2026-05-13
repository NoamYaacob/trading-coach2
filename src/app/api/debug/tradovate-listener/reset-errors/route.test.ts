/**
 * Source-scan tests for POST /api/debug/tradovate-listener/reset-errors.
 *
 * Verifies security properties, scope constraints, and token safety by
 * inspecting the route source directly — no HTTP server required.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTE_SRC = readFileSync(resolve(import.meta.dirname, "./route.ts"), "utf8");

// ── Auth guard ───────────────────────────────────────────────────────────────

describe("reset-errors: auth guard", () => {
  it("calls getCurrentUser", () => {
    assert.ok(
      ROUTE_SRC.includes("getCurrentUser"),
      "route must call getCurrentUser to authenticate the request",
    );
  });

  it("returns 401 when user is not authenticated", () => {
    assert.ok(
      ROUTE_SRC.includes("401"),
      "route must return 401 for unauthenticated requests",
    );
  });

  it("returns 401 before any DB access when unauthenticated", () => {
    const authIdx = ROUTE_SRC.indexOf("401");
    const dbIdx = ROUTE_SRC.indexOf("prisma.");
    assert.ok(authIdx !== -1 && dbIdx !== -1, "both auth guard and prisma call must exist");
    assert.ok(
      authIdx < dbIdx,
      "401 response must appear before any prisma call (auth before DB)",
    );
  });
});

// ── Production secret guard ──────────────────────────────────────────────────

describe("reset-errors: production secret guard", () => {
  it("checks NODE_ENV for production gate", () => {
    assert.ok(
      ROUTE_SRC.includes("NODE_ENV") && ROUTE_SRC.includes("production"),
      "route must gate on NODE_ENV === 'production'",
    );
  });

  it("reads x-cron-secret header", () => {
    assert.ok(
      ROUTE_SRC.includes("x-cron-secret"),
      "route must read the x-cron-secret header in production",
    );
  });

  it("compares against CRON_SECRET env var", () => {
    assert.ok(
      ROUTE_SRC.includes("CRON_SECRET"),
      "route must compare x-cron-secret against process.env.CRON_SECRET",
    );
  });

  it("returns 403 when secret does not match", () => {
    assert.ok(
      ROUTE_SRC.includes("403"),
      "route must return 403 when the secret header does not match",
    );
  });
});

// ── Scope: only current user's rows ─────────────────────────────────────────

describe("reset-errors: scope isolation", () => {
  it("where clause includes userId filter", () => {
    assert.ok(
      ROUTE_SRC.includes("userId: currentUser.id"),
      "update must be scoped to currentUser.id to prevent clearing other users' rows",
    );
  });

  it("where clause filters on listenerStatus error", () => {
    assert.ok(
      ROUTE_SRC.includes('listenerStatus: "error"'),
      "update must only target rows where listenerStatus is 'error'",
    );
  });

  it("uses updateMany (not update) for batch clear", () => {
    assert.ok(
      ROUTE_SRC.includes("updateMany"),
      "route must use updateMany for batch-clearing error rows",
    );
  });
});

// ── Fields cleared vs. kept ──────────────────────────────────────────────────

describe("reset-errors: cleared fields", () => {
  it("clears listenerStatus", () => {
    assert.ok(
      ROUTE_SRC.includes("listenerStatus: null"),
      "update data must set listenerStatus to null",
    );
  });

  it("clears listenerErrorMessage", () => {
    assert.ok(
      ROUTE_SRC.includes("listenerErrorMessage: null"),
      "update data must set listenerErrorMessage to null",
    );
  });

  it("clears listenerLastHeartbeatAt", () => {
    assert.ok(
      ROUTE_SRC.includes("listenerLastHeartbeatAt: null"),
      "update data must set listenerLastHeartbeatAt to null",
    );
  });
});

describe("reset-errors: preserved fields", () => {
  it("does not touch listenerConnectedAt", () => {
    const updateIdx = ROUTE_SRC.indexOf("updateMany");
    assert.ok(updateIdx !== -1);
    // The data block must not reference listenerConnectedAt
    const dataBlock = ROUTE_SRC.slice(updateIdx, updateIdx + 400);
    assert.ok(
      !dataBlock.includes("listenerConnectedAt"),
      "update data must not touch listenerConnectedAt",
    );
  });

  it("does not touch listenerLastEventAt", () => {
    const updateIdx = ROUTE_SRC.indexOf("updateMany");
    assert.ok(updateIdx !== -1);
    const dataBlock = ROUTE_SRC.slice(updateIdx, updateIdx + 400);
    assert.ok(
      !dataBlock.includes("listenerLastEventAt"),
      "update data must not touch listenerLastEventAt",
    );
  });

  it("does not touch connectionStatus", () => {
    const updateIdx = ROUTE_SRC.indexOf("updateMany");
    assert.ok(updateIdx !== -1);
    const dataBlock = ROUTE_SRC.slice(updateIdx, updateIdx + 400);
    assert.ok(
      !dataBlock.includes("connectionStatus"),
      "update data must not touch connectionStatus (do not expire healthy connections)",
    );
  });
});

// ── Token safety ─────────────────────────────────────────────────────────────

describe("reset-errors: token safety", () => {
  const TOKEN_FIELDS = [
    "accessToken",
    "refreshToken",
    "tokenEncrypted",
    "accessTokenEncrypted",
    "refreshTokenEncrypted",
  ];

  it("does not select any token fields", () => {
    for (const field of TOKEN_FIELDS) {
      assert.ok(
        !ROUTE_SRC.includes(`select: { ${field}`) && !ROUTE_SRC.includes(`${field}: true`),
        `route must not select token field: ${field}`,
      );
    }
  });

  it("does not include token fields in response", () => {
    for (const field of TOKEN_FIELDS) {
      assert.ok(
        !ROUTE_SRC.includes(field),
        `route must not reference token field anywhere: ${field}`,
      );
    }
  });

  it("does not log token fields", () => {
    const logCalls = ROUTE_SRC.match(/console\.(log|warn|info|error)\([\s\S]*?\)/g) ?? [];
    for (const logCall of logCalls) {
      for (const field of TOKEN_FIELDS) {
        assert.ok(
          !logCall.includes(field),
          `log call must not include token field "${field}": ${logCall.slice(0, 80)}`,
        );
      }
    }
  });
});

// ── Response shape ───────────────────────────────────────────────────────────

describe("reset-errors: response shape", () => {
  it("returns ok: true on success", () => {
    assert.ok(ROUTE_SRC.includes("ok: true"), "success response must include ok: true");
  });

  it("returns cleared count", () => {
    assert.ok(ROUTE_SRC.includes("cleared:"), "response must include cleared count");
  });

  it("returns connectionIds array", () => {
    assert.ok(ROUTE_SRC.includes("connectionIds"), "response must include connectionIds");
  });

  it("handles no-op case (zero rows in error state) without throwing", () => {
    assert.ok(
      ROUTE_SRC.includes("cleared: 0"),
      "route must return cleared: 0 when no rows are in error state",
    );
  });
});

// ── Filter support: connectionId / env ──────────────────────────────────────

describe("reset-errors: optional filter body", () => {
  it("reads optional connectionId from body", () => {
    assert.ok(
      ROUTE_SRC.includes("connectionId"),
      "route must accept an optional connectionId filter",
    );
  });

  it("reads optional env from body", () => {
    assert.ok(
      ROUTE_SRC.includes('body.env === "live"') ||
        ROUTE_SRC.includes('body.env === "demo"'),
      "route must accept an optional env filter limited to live/demo",
    );
  });

  it("env filter only accepts 'live' or 'demo'", () => {
    // Reject other env strings — must validate
    const block = ROUTE_SRC.slice(ROUTE_SRC.indexOf("body.env"));
    assert.ok(
      block.includes('"live"') && block.includes('"demo"'),
      "env validation must whitelist live/demo only",
    );
  });

  it("returns filter context in the response", () => {
    assert.ok(
      ROUTE_SRC.includes("filter:"),
      "response must echo the filter that was applied for operator clarity",
    );
  });

  it("applies filters in the prisma where clause (not in JS post-filter)", () => {
    // Spread the optional filter into where, not into data
    assert.ok(
      /where\s*=\s*\{[\s\S]*connectionIdFilter[\s\S]*envFilter/.test(ROUTE_SRC) ||
        ROUTE_SRC.includes("...(connectionIdFilter"),
      "filters must be applied in the prisma where clause so DB does the filtering",
    );
  });
});
