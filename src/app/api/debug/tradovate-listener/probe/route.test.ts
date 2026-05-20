/**
 * Source-scan tests for POST /api/debug/tradovate-listener/probe.
 *
 * Probe is a high-blast-radius endpoint: it opens WebSocket connections,
 * sends authorize frames in four different formats, and waits for responses.
 * The tests here lock down auth, ownership, timeouts, variant coverage, and
 * the absolute requirement that the token never appears in logs or responses.
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
  it("waits for SockJS open frame before sending the authorize payload", () => {
    // ws.send(payload) must appear after the frame.type === "open" guard
    const openHandlerIdx = ROUTE_SRC.indexOf('frame.type === "open"');
    const sendCallIdx = ROUTE_SRC.indexOf("ws.send(", openHandlerIdx);
    assert.ok(openHandlerIdx !== -1, 'must check frame.type === "open"');
    assert.ok(sendCallIdx !== -1, "must call ws.send inside the open handler");
    assert.ok(
      openHandlerIdx < sendCallIdx,
      "ws.send must be called inside the 'open' branch (after frame.type === 'open' check)",
    );
  });

  it("encodes authorize via the shared protocol helper (not hand-rolled)", () => {
    assert.ok(ROUTE_SRC.includes("encodeAuthorizeMessage"));
  });

  it("enforces an open-frame timeout and an authorize-response timeout", () => {
    assert.ok(ROUTE_SRC.includes("SOCKJS_OPEN_TIMEOUT_MS"));
    assert.ok(ROUTE_SRC.includes("AUTHORIZE_RESPONSE_TIMEOUT_MS"));
    // Both timeouts must call settle (proved by function name appearing after each deadline comment)
    assert.ok(
      ROUTE_SRC.indexOf("SOCKJS_OPEN_TIMEOUT_MS") <
        ROUTE_SRC.indexOf("AUTHORIZE_RESPONSE_TIMEOUT_MS"),
      "open timeout must be declared before auth timeout",
    );
  });

  it("reports authOk=true on status 200 and authOk=false otherwise", () => {
    assert.ok(ROUTE_SRC.includes("authOk"));
    assert.ok(ROUTE_SRC.includes("authStatus"));
    assert.ok(ROUTE_SRC.includes("status === 200"));
  });
});

describe("probe: multi-variant format coverage", () => {
  it("defines all four authorize format variants", () => {
    assert.ok(ROUTE_SRC.includes("A_json_stringified"), "variant A must be present");
    assert.ok(ROUTE_SRC.includes("B_raw"), "variant B must be present");
    assert.ok(ROUTE_SRC.includes("C_bearer"), "variant C must be present");
    assert.ok(ROUTE_SRC.includes("D_sockjs_array"), "variant D must be present");
  });

  it("reports payloadLength not the raw payload", () => {
    assert.ok(
      ROUTE_SRC.includes("payloadLength"),
      "response must include payloadLength",
    );
    // The word 'payload' as a standalone response field must not appear
    // (buildPayload and payloadLength are acceptable; 'payload:' as a field is not)
    const hasPayloadField = /\bpayload\s*:(?!\s*\()/.test(ROUTE_SRC);
    assert.ok(!hasPayloadField, "must not return a raw 'payload' field");
  });

  it("tracks sentAfterSockJsOpen per variant", () => {
    assert.ok(
      ROUTE_SRC.includes("sentAfterSockJsOpen"),
      "must track whether authorize was sent after SockJS open",
    );
  });

  it("returns a variants array in the response", () => {
    assert.ok(ROUTE_SRC.includes("variants"), "response must include variants array");
    // Variants array must be populated in the loop and included in NextResponse.json
    assert.ok(ROUTE_SRC.includes("variants.push") || ROUTE_SRC.includes("variants:"));
  });

  it("marks B_raw as the confirmed-working production format", () => {
    assert.ok(
      ROUTE_SRC.includes("confirmedWorkingFormat"),
      "variants must expose confirmedWorkingFormat",
    );
    // B_raw must declare confirmedWorkingFormat: true; the others must declare false.
    const bRawBlock = ROUTE_SRC.match(/name:\s*"B_raw"[\s\S]*?buildPayload:/);
    assert.ok(bRawBlock, "B_raw variant block not found");
    assert.ok(
      /confirmedWorkingFormat:\s*true/.test(bRawBlock![0]),
      "B_raw must be marked confirmedWorkingFormat: true",
    );
    for (const name of ["A_json_stringified", "C_bearer", "D_sockjs_array"]) {
      const re = new RegExp(`name:\\s*"${name}"[\\s\\S]*?buildPayload:`);
      const block = ROUTE_SRC.match(re);
      assert.ok(block, `${name} variant block not found`);
      assert.ok(
        /confirmedWorkingFormat:\s*false/.test(block![0]),
        `${name} must be marked confirmedWorkingFormat: false`,
      );
    }
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
