/**
 * Source-scan tests for POST /api/debug/tradovate-listener/probe.
 *
 * Probe is a high-blast-radius endpoint: it opens a WebSocket, sends an
 * authorize frame, and waits for a response. The tests here lock down auth,
 * ownership, timeouts, and absolute non-logging / non-return of the token.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTE_SRC = readFileSync(resolve(import.meta.dirname, "./route.ts"), "utf8");

describe("probe: runtime + auth + secret guards", () => {
  it("uses the nodejs runtime (ws is not Edge-compatible)", () => {
    assert.ok(
      ROUTE_SRC.includes('runtime = "nodejs"'),
      "probe route must export runtime = 'nodejs'",
    );
  });

  it("calls getCurrentUser and returns 401 unauthenticated", () => {
    assert.ok(ROUTE_SRC.includes("getCurrentUser"));
    assert.ok(ROUTE_SRC.includes("401"));
  });

  it("checks x-cron-secret/CRON_SECRET in production and returns 403 on mismatch", () => {
    assert.ok(ROUTE_SRC.includes("NODE_ENV"));
    assert.ok(ROUTE_SRC.includes("production"));
    assert.ok(ROUTE_SRC.includes("x-cron-secret"));
    assert.ok(ROUTE_SRC.includes("CRON_SECRET"));
    assert.ok(ROUTE_SRC.includes("403"));
  });
});

describe("probe: ownership + env validation", () => {
  it("loads BC scoped to current user and platform=tradovate", () => {
    assert.ok(ROUTE_SRC.includes("userId: currentUser.id"));
    assert.ok(ROUTE_SRC.includes('platform: "tradovate"'));
    assert.ok(ROUTE_SRC.includes("404"));
  });

  it("rejects unsupported env values (anything not live/demo)", () => {
    assert.ok(ROUTE_SRC.includes('"live"'));
    assert.ok(ROUTE_SRC.includes('"demo"'));
    assert.ok(ROUTE_SRC.includes("unsupported env"));
  });
});

describe("probe: endpoint chain reporting", () => {
  it("reports the host triple used for this env", () => {
    assert.ok(ROUTE_SRC.includes("tokenUrlHost"));
    assert.ok(ROUTE_SRC.includes("restBaseHost"));
    assert.ok(ROUTE_SRC.includes("wsHost"));
    assert.ok(ROUTE_SRC.includes("tokenAndRestSameHost"));
  });

  it("calls /account/list against the env-specific REST base", () => {
    assert.ok(ROUTE_SRC.includes("/account/list"));
    assert.ok(ROUTE_SRC.includes("apiBaseUrl[env]"));
  });

  it("opens the env-specific WS via TRADOVATE_WS_URL[env]", () => {
    assert.ok(ROUTE_SRC.includes("TRADOVATE_WS_URL[env]"));
  });
});

describe("probe: WebSocket handshake sequence", () => {
  it("waits for SockJS open frame before sending authorize", () => {
    // The handler must dispatch on frame.type === "open" before calling
    // encodeAuthorizeMessage / ws.send. Compare against the call site, which
    // is the second occurrence of encodeAuthorizeMessage (first is the import).
    const openHandlerIdx = ROUTE_SRC.indexOf('frame.type === "open"');
    const firstImportIdx = ROUTE_SRC.indexOf("encodeAuthorizeMessage");
    const callSiteIdx = ROUTE_SRC.indexOf("encodeAuthorizeMessage", firstImportIdx + 1);
    assert.ok(openHandlerIdx !== -1 && callSiteIdx !== -1);
    assert.ok(
      openHandlerIdx < callSiteIdx,
      "authorize must be sent inside the 'open' branch (after frame.type === 'open' check)",
    );
  });

  it("encodes authorize via the shared protocol helper (not hand-rolled)", () => {
    assert.ok(ROUTE_SRC.includes("encodeAuthorizeMessage"));
  });

  it("enforces an open-frame timeout and an authorize-response timeout", () => {
    assert.ok(ROUTE_SRC.includes("SOCKJS_OPEN_TIMEOUT_MS"));
    assert.ok(ROUTE_SRC.includes("AUTHORIZE_RESPONSE_TIMEOUT_MS"));
    assert.ok(ROUTE_SRC.includes('"open_timeout"'));
    assert.ok(ROUTE_SRC.includes('"auth_timeout"'));
  });

  it("reports auth_ok on status 200 and auth_failed otherwise", () => {
    assert.ok(ROUTE_SRC.includes('"auth_ok"'));
    assert.ok(ROUTE_SRC.includes('"auth_failed"'));
  });
});

describe("probe: token safety (absolute)", () => {
  it("never logs the access token", () => {
    // Look for any console.* call that references accessToken.
    const logCalls = ROUTE_SRC.match(/console\.(log|warn|info|error|debug)\([\s\S]*?\)/g) ?? [];
    for (const call of logCalls) {
      assert.ok(
        !call.includes("accessToken"),
        `log call must not include accessToken: ${call.slice(0, 80)}`,
      );
    }
  });

  it("never returns the token in the response", () => {
    // NextResponse.json blocks must not include accessToken
    const jsonCalls = ROUTE_SRC.match(/NextResponse\.json\([\s\S]*?\)/g) ?? [];
    for (const call of jsonCalls) {
      assert.ok(
        !call.includes("accessToken"),
        `NextResponse.json must not include accessToken: ${call.slice(0, 80)}`,
      );
    }
  });

  it("sanitizes outbound error text (strips bearer-style strings)", () => {
    assert.ok(ROUTE_SRC.includes("sanitizeErrorText"));
    assert.ok(
      ROUTE_SRC.includes("REDACTED") || ROUTE_SRC.includes("[REDACTED]"),
      "sanitizer must redact bearer-token-shaped strings",
    );
  });
});
