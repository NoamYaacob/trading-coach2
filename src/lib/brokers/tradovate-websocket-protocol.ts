/**
 * Tradovate WebSocket protocol — pure types and functions.
 *
 * Covers the SockJS framing layer and the Tradovate message protocol used
 * by the user/syncrequest (user-data) WebSocket endpoint.
 *
 * References (Tradovate API docs + community SDK analysis):
 *   REST base:       https://live.tradovateapi.com/v1
 *   WS (live):       wss://live.tradovateapi.com/v1/websocket
 *   WS (demo):       wss://demo.tradovateapi.com/v1/websocket
 *   Authorize:       authorize\n<id>\n\n<accessToken>
 *   User sync:       user/syncrequest\n<id>\n\n{"users":[<userId>]}
 *   Props event:     {"e":"props","d":{"entityType":"...","entity":{...},"eventType":"..."}}
 *
 * No I/O. All functions are pure and synchronous. Safe to unit-test without
 * network access. The listener class (tradovate-user-sync-listener.ts) wraps
 * these with an actual WebSocket connection.
 *
 * Token safety: no function in this module reads, stores, or logs token values.
 * The caller passes only the minimum required (access token string for auth).
 */

// ── WebSocket URL constants ──────────────────────────────────────────────────

export const TRADOVATE_WS_URL = {
  live: "wss://live.tradovateapi.com/v1/websocket",
  demo: "wss://demo.tradovateapi.com/v1/websocket",
} as const satisfies Record<"live" | "demo", string>;

// ── SockJS frame types ───────────────────────────────────────────────────────

export type SockJSFrameType = "open" | "heartbeat" | "close" | "data";

export type SockJSFrame =
  | { type: "open" }
  | { type: "heartbeat" }
  | { type: "close"; code: number; reason: string }
  | { type: "data"; messages: string[] };

/**
 * Parse a raw SockJS frame string into a typed structure.
 *
 * SockJS frame syntax:
 *   "o"          → open
 *   "h"          → heartbeat (keep-alive)
 *   "c[code,msg]"→ close (server-initiated)
 *   "a[...]"     → data (JSON array of message strings)
 */
export function parseSockJSFrame(raw: string): SockJSFrame {
  if (raw === "o") return { type: "open" };
  if (raw === "h") return { type: "heartbeat" };
  if (raw.startsWith("c")) {
    try {
      const arr = JSON.parse(raw.slice(1)) as [number, string];
      return { type: "close", code: arr[0] ?? 0, reason: arr[1] ?? "" };
    } catch {
      return { type: "close", code: 0, reason: "parse_error" };
    }
  }
  if (raw.startsWith("a")) {
    try {
      const messages = JSON.parse(raw.slice(1)) as string[];
      return { type: "data", messages: Array.isArray(messages) ? messages : [] };
    } catch {
      return { type: "data", messages: [] };
    }
  }
  return { type: "data", messages: [] };
}

// ── Tradovate message encoding ───────────────────────────────────────────────

/**
 * Encode a Tradovate WebSocket request message.
 *
 * Wire format: "<endpoint>\n<id>\n<query>\n<body>"
 * - endpoint: e.g. "authorize", "user/syncrequest"
 * - id:       monotonically increasing request ID (correlates responses)
 * - query:    URL query string (empty string for most requests)
 * - body:     JSON string payload (empty string when no body)
 */
export function encodeTradovateMessage(params: {
  endpoint: string;
  id: number;
  query?: string;
  body?: string;
}): string {
  const query = params.query ?? "";
  const body = params.body ?? "";
  return `${params.endpoint}\n${params.id}\n${query}\n${body}`;
}

/** Encode an authorization request. Called immediately after "o" (open). */
export function encodeAuthorizeMessage(id: number, accessToken: string): string {
  return encodeTradovateMessage({ endpoint: "authorize", id, body: accessToken });
}

/** Encode a user/syncrequest. Called after successful authorization. */
export function encodeUserSyncRequest(id: number, tradovateUserId: number): string {
  return encodeTradovateMessage({
    endpoint: "user/syncrequest",
    id,
    body: JSON.stringify({ users: [tradovateUserId] }),
  });
}

// ── Tradovate response parsing ───────────────────────────────────────────────

/** Wire shape of a response frame (id-correlated reply to a sent request). */
export type TradovateResponse = {
  i: number;   // request id echo
  s: number;   // HTTP status code (200 = OK)
  p: unknown;  // payload
};

/** Wire shape of an event frame (server-pushed, no request id). */
export type TradovateEvent = {
  e: string;   // event type, e.g. "props"
  d: unknown;  // event data
};

/** Parse one message string from the SockJS data frame. */
export function parseTradovateMessage(
  raw: string,
): { kind: "response"; data: TradovateResponse } | { kind: "event"; data: TradovateEvent } | { kind: "unknown" } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "unknown" };
  }
  if (typeof parsed !== "object" || parsed === null) return { kind: "unknown" };

  // Responses have numeric "i" (request id)
  if ("i" in parsed && typeof (parsed as Record<string, unknown>).i === "number") {
    return { kind: "response", data: parsed as TradovateResponse };
  }
  // Events have string "e" (event type)
  if ("e" in parsed && typeof (parsed as Record<string, unknown>).e === "string") {
    return { kind: "event", data: parsed as TradovateEvent };
  }
  return { kind: "unknown" };
}

/** True when a response indicates success (HTTP 200). */
export function isSuccessResponse(r: TradovateResponse): boolean {
  return r.s === 200;
}

// ── Props event types ────────────────────────────────────────────────────────

/** Entity types that can arrive in props events. */
export type TradovateEntityType =
  | "Position"
  | "Order"
  | "Fill"
  | "Account"
  | "AccountRiskStatus"
  | "Contract"
  | "ContractGroup"
  | "Currency"
  | "Exchange"
  | "Product"
  | "OrderStrategy"
  | "OrderStrategyLink"
  | "UserAccountAutoLiq"
  | "UserAccountPositionLimit"
  | string; // extensible — Tradovate may add entity types

export type TradovateEventType = "Created" | "Updated" | "Deleted" | string;

/** Shape of the "props" event data payload. */
export type TradovatePropsEventData = {
  entityType: TradovateEntityType;
  entity: Record<string, unknown>;
  eventType: TradovateEventType;
};

/** True when a TradovateEvent is a "props" event. */
export function isPropsEvent(event: TradovateEvent): event is TradovateEvent & { d: TradovatePropsEventData } {
  if (event.e !== "props") return false;
  const d = event.d as Record<string, unknown> | null;
  return (
    d !== null &&
    typeof d === "object" &&
    typeof d.entityType === "string" &&
    typeof d.eventType === "string" &&
    typeof d.entity === "object" &&
    d.entity !== null
  );
}

/** Extract a typed props event payload, or null if the frame isn't a valid props event. */
export function parsePropsEvent(event: TradovateEvent): TradovatePropsEventData | null {
  if (!isPropsEvent(event)) return null;
  return event.d as TradovatePropsEventData;
}

// ── Position entity helpers ──────────────────────────────────────────────────

/** Minimal shape of a Position entity from Tradovate. */
export type TradovatePositionEntity = {
  id: number;
  accountId: number;
  contractId: number;
  netPos: number;
  netPrice?: number;
  timestamp?: string;
  tradeDate?: { year: number; month: number; day: number };
  contractsTraded?: number;
  initialDailyRealizedPnl?: number;
  realizedPnl?: number;
  openPnl?: number;
};

/** Cast a generic entity to a PositionEntity if it has the minimum required fields. */
export function castPositionEntity(entity: Record<string, unknown>): TradovatePositionEntity | null {
  if (
    typeof entity.id === "number" &&
    typeof entity.accountId === "number" &&
    typeof entity.contractId === "number" &&
    typeof entity.netPos === "number"
  ) {
    return entity as unknown as TradovatePositionEntity;
  }
  return null;
}

// ── Entity types that trigger max-position-size re-evaluation ───────────────

/** Entity types whose events should trigger a max-position-size check. */
export const POSITION_ENFORCEMENT_TRIGGER_ENTITY_TYPES: ReadonlySet<TradovateEntityType> = new Set([
  "Position",
  "Fill",
  "Order",
]);

/** True when a props event should trigger a max-position-size re-evaluation. */
export function isPositionEnforcementTrigger(props: TradovatePropsEventData): boolean {
  return POSITION_ENFORCEMENT_TRIGGER_ENTITY_TYPES.has(props.entityType);
}
