/**
 * Tests for the Tradovate WebSocket protocol pure module.
 *
 * Pure functions only — no network, no DB, no tokens.
 * Run: npm run test:unit
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseSockJSFrame,
  encodeTradovateMessage,
  encodeAuthorizeMessage,
  encodeUserSyncRequest,
  parseTradovateMessage,
  isSuccessResponse,
  isPropsEvent,
  parsePropsEvent,
  castPositionEntity,
  isPositionEnforcementTrigger,
  TRADOVATE_WS_URL,
} from "./tradovate-websocket-protocol.ts";

// ── SockJS frame parsing ─────────────────────────────────────────────────────

describe("parseSockJSFrame: open frame", () => {
  it("'o' → type open", () => {
    assert.deepEqual(parseSockJSFrame("o"), { type: "open" });
  });
});

describe("parseSockJSFrame: heartbeat frame", () => {
  it("'h' → type heartbeat", () => {
    assert.deepEqual(parseSockJSFrame("h"), { type: "heartbeat" });
  });
});

describe("parseSockJSFrame: close frame", () => {
  it("parses close code and reason", () => {
    const frame = parseSockJSFrame('c[3000,"connection closed"]');
    assert.equal(frame.type, "close");
    if (frame.type !== "close") throw new Error("wrong type");
    assert.equal(frame.code, 3000);
    assert.equal(frame.reason, "connection closed");
  });

  it("handles malformed close frame gracefully", () => {
    const frame = parseSockJSFrame("c{bad json}");
    assert.equal(frame.type, "close");
    if (frame.type !== "close") throw new Error("wrong type");
    assert.equal(frame.code, 0);
    assert.equal(frame.reason, "parse_error");
  });
});

describe("parseSockJSFrame: data frame", () => {
  it("extracts array of message strings", () => {
    const msg = JSON.stringify({ i: 1, s: 200, p: { token: "tok" } });
    const frame = parseSockJSFrame(`a[${JSON.stringify(msg)}]`);
    assert.equal(frame.type, "data");
    if (frame.type !== "data") throw new Error("wrong type");
    assert.equal(frame.messages.length, 1);
    assert.ok(frame.messages[0]?.includes('"s":200'));
  });

  it("returns empty messages on malformed data frame", () => {
    const frame = parseSockJSFrame("a{bad}");
    assert.equal(frame.type, "data");
    if (frame.type !== "data") throw new Error("wrong type");
    assert.deepEqual(frame.messages, []);
  });

  it("handles multiple messages in one data frame", () => {
    const m1 = JSON.stringify({ i: 1, s: 200, p: null });
    const m2 = JSON.stringify({ e: "props", d: {} });
    const raw = `a[${JSON.stringify(m1)},${JSON.stringify(m2)}]`;
    const frame = parseSockJSFrame(raw);
    assert.equal(frame.type, "data");
    if (frame.type !== "data") throw new Error("wrong type");
    assert.equal(frame.messages.length, 2);
  });
});

// ── Message encoding ─────────────────────────────────────────────────────────

describe("encodeTradovateMessage", () => {
  it("produces endpoint\\nid\\nquery\\nbody format", () => {
    const msg = encodeTradovateMessage({ endpoint: "user/syncrequest", id: 2, body: '{"users":[1]}' });
    const parts = msg.split("\n");
    assert.equal(parts[0], "user/syncrequest");
    assert.equal(parts[1], "2");
    assert.equal(parts[2], "");  // empty query
    assert.equal(parts[3], '{"users":[1]}');
  });

  it("defaults query to empty string", () => {
    const msg = encodeTradovateMessage({ endpoint: "authorize", id: 1, body: "tok" });
    const parts = msg.split("\n");
    assert.equal(parts[2], "");
  });
});

describe("encodeAuthorizeMessage", () => {
  it("uses 'authorize' endpoint with the token as body", () => {
    const msg = encodeAuthorizeMessage(1, "my_access_token");
    const parts = msg.split("\n");
    assert.equal(parts[0], "authorize");
    assert.equal(parts[1], "1");
    assert.equal(parts[3], "my_access_token");
  });

  it("does not include 'Bearer' prefix (token is sent raw)", () => {
    const msg = encodeAuthorizeMessage(1, "secret_token");
    assert.ok(!msg.includes("Bearer"), "token must be sent raw, not as Bearer header");
  });
});

describe("encodeUserSyncRequest", () => {
  it("uses 'user/syncrequest' endpoint with userId in body", () => {
    const msg = encodeUserSyncRequest(2, 42);
    const parts = msg.split("\n");
    assert.equal(parts[0], "user/syncrequest");
    assert.equal(parts[1], "2");
    const body = JSON.parse(parts[3]!) as { users: number[] };
    assert.deepEqual(body.users, [42]);
  });
});

// ── Response / event parsing ─────────────────────────────────────────────────

describe("parseTradovateMessage: response", () => {
  it("identifies message with numeric 'i' as response", () => {
    const result = parseTradovateMessage(JSON.stringify({ i: 1, s: 200, p: { token: "tok" } }));
    assert.equal(result.kind, "response");
    if (result.kind !== "response") throw new Error("wrong kind");
    assert.equal(result.data.i, 1);
    assert.equal(result.data.s, 200);
  });

  it("200 response is success", () => {
    const result = parseTradovateMessage(JSON.stringify({ i: 1, s: 200, p: {} }));
    assert.equal(result.kind, "response");
    if (result.kind !== "response") throw new Error();
    assert.ok(isSuccessResponse(result.data));
  });

  it("non-200 response is not success", () => {
    const result = parseTradovateMessage(JSON.stringify({ i: 1, s: 401, p: {} }));
    assert.equal(result.kind, "response");
    if (result.kind !== "response") throw new Error();
    assert.ok(!isSuccessResponse(result.data));
  });
});

describe("parseTradovateMessage: event", () => {
  it("identifies message with string 'e' as event", () => {
    const result = parseTradovateMessage(JSON.stringify({ e: "props", d: {} }));
    assert.equal(result.kind, "event");
    if (result.kind !== "event") throw new Error("wrong kind");
    assert.equal(result.data.e, "props");
  });
});

describe("parseTradovateMessage: unknown", () => {
  it("returns unknown for malformed JSON", () => {
    assert.equal(parseTradovateMessage("{bad}").kind, "unknown");
  });

  it("returns unknown for non-object JSON", () => {
    assert.equal(parseTradovateMessage('"just a string"').kind, "unknown");
    assert.equal(parseTradovateMessage("42").kind, "unknown");
  });
});

// ── Props event parsing ──────────────────────────────────────────────────────

describe("isPropsEvent", () => {
  it("true for a valid props event", () => {
    const event = {
      e: "props",
      d: {
        entityType: "Position",
        entity: { id: 1, accountId: 2, contractId: 3, netPos: 1 },
        eventType: "Updated",
      },
    };
    assert.ok(isPropsEvent(event));
  });

  it("false for non-props event type", () => {
    assert.ok(!isPropsEvent({ e: "market", d: {} }));
  });

  it("false when entity is missing", () => {
    const bad = { e: "props", d: { entityType: "Position", eventType: "Updated" } };
    assert.ok(!isPropsEvent(bad as Parameters<typeof isPropsEvent>[0]));
  });
});

describe("parsePropsEvent", () => {
  it("returns TradovatePropsEventData for valid props event", () => {
    const event = {
      e: "props",
      d: {
        entityType: "Position",
        entity: { id: 1, accountId: 2, contractId: 3, netPos: 1 },
        eventType: "Updated",
      },
    };
    const result = parsePropsEvent(event);
    assert.ok(result !== null);
    assert.equal(result!.entityType, "Position");
    assert.equal(result!.eventType, "Updated");
  });

  it("returns null for non-props event", () => {
    assert.equal(parsePropsEvent({ e: "market", d: {} }), null);
  });
});

// ── Position entity casting ──────────────────────────────────────────────────

describe("castPositionEntity", () => {
  it("returns typed entity when all required fields are present", () => {
    const entity = { id: 1, accountId: 2, contractId: 3, netPos: 2 };
    const result = castPositionEntity(entity);
    assert.ok(result !== null);
    assert.equal(result!.netPos, 2);
  });

  it("returns null when a required field is missing", () => {
    assert.equal(castPositionEntity({ id: 1, accountId: 2, contractId: 3 }), null);
    assert.equal(castPositionEntity({ accountId: 2, contractId: 3, netPos: 1 }), null);
  });

  it("returns null when a required field has the wrong type", () => {
    assert.equal(castPositionEntity({ id: "1", accountId: 2, contractId: 3, netPos: 1 }), null);
  });
});

// ── Enforcement trigger classification ───────────────────────────────────────

describe("isPositionEnforcementTrigger", () => {
  it("true for Position entity type", () => {
    assert.ok(isPositionEnforcementTrigger({ entityType: "Position", entity: {}, eventType: "Updated" }));
  });

  it("true for Fill entity type", () => {
    assert.ok(isPositionEnforcementTrigger({ entityType: "Fill", entity: {}, eventType: "Created" }));
  });

  it("true for Order entity type", () => {
    assert.ok(isPositionEnforcementTrigger({ entityType: "Order", entity: {}, eventType: "Updated" }));
  });

  it("false for Account entity type (balance-only update, no position impact)", () => {
    assert.ok(!isPositionEnforcementTrigger({ entityType: "Account", entity: {}, eventType: "Updated" }));
  });

  it("false for Contract entity type", () => {
    assert.ok(!isPositionEnforcementTrigger({ entityType: "Contract", entity: {}, eventType: "Updated" }));
  });
});

// ── URL constants sanity check ───────────────────────────────────────────────

describe("TRADOVATE_WS_URL", () => {
  it("live URL uses wss:// scheme", () => {
    assert.ok(TRADOVATE_WS_URL.live.startsWith("wss://"), "live URL must use wss://");
  });
  it("demo URL uses wss:// scheme", () => {
    assert.ok(TRADOVATE_WS_URL.demo.startsWith("wss://"), "demo URL must use wss://");
  });
  it("live URL references live.tradovateapi.com", () => {
    assert.ok(TRADOVATE_WS_URL.live.includes("live.tradovateapi.com"));
  });
  it("demo URL references demo.tradovateapi.com", () => {
    assert.ok(TRADOVATE_WS_URL.demo.includes("demo.tradovateapi.com"));
  });
});
