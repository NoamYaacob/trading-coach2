/**
 * Tradovate real-time listener worker — Railway long-running service.
 *
 * Phase 1: OBSERVE-ONLY.
 *   - Starts one TradovateUserSyncListener per healthy BrokerConnection.
 *   - Records heartbeat / event timestamps + listener state on
 *     BrokerConnection so the dashboard can show "Live · Xs ago".
 *   - Does NOT lock accounts (riskState=STOPPED), does NOT create
 *     RuleViolation rows, does NOT flatten positions.
 *
 * Token safety:
 *   - getAccessToken is a closure; the decrypted token value is returned to
 *     the listener once per (re)connect and never logged or persisted.
 *   - The closure uses the existing ensureTradovateAccessToken() helper so
 *     expired tokens get refreshed via the standard refresh path.
 *
 * To run locally (requires DATABASE_URL + ENCRYPTION_KEY + TRADOVATE_* env):
 *   node --experimental-strip-types scripts/tradovate-listener-worker.ts
 *
 * Railway service: railway-listener-worker-config/railway.json
 *   - persistent process (no cronSchedule)
 *   - single replica only (manager dedup is per-process)
 *   - startCommand: node --experimental-strip-types scripts/tradovate-listener-worker.ts
 *   - restartPolicyType: ON_FAILURE, maxRetries: 10
 *
 * See docs/TRADOVATE_REALTIME_DEPLOYMENT.md for the full deployment plan.
 */

import "dotenv/config";

import WebSocket from "ws";

import { prisma } from "../src/lib/db.ts";
import { parseAndDecrypt } from "../src/lib/security/token-crypto.ts";
import { ensureTradovateAccessToken } from "../src/lib/brokers/tradovate-ensure-token.ts";
import { getTradovateConfig } from "../src/lib/brokers/tradovate-env.ts";
import { TradovateListenerManager } from "../src/lib/brokers/tradovate-listener-manager.ts";
import type {
  WebSocketLike,
  WebSocketFactory,
  ListenerState,
} from "../src/lib/brokers/tradovate-user-sync-listener.ts";
import {
  planListenerStartups,
  listenerStateToDbStatus,
  computeRetryDelayMs,
  type BrokerConnectionRow,
} from "../src/lib/brokers/tradovate-listener-worker-logic.ts";
import { TRADOVATE_WS_URL } from "../src/lib/brokers/tradovate-websocket-protocol.ts";

// ── Tunables ─────────────────────────────────────────────────────────────────

const RESCAN_INTERVAL_MS = 60_000; // poll DB every 60 s for new/removed connections
const STARTUP_STAGGER_MS = 200; // gap between successive listener starts
const SHUTDOWN_GRACE_MS = 5_000; // max time to wait for Prisma to disconnect on SIGTERM

/**
 * Live connections are temporarily gated. Set TRADOVATE_LISTENER_ENABLE_LIVE=true
 * to allow live listeners. Default false until demo handshake is verified.
 */
const ENABLE_LIVE = process.env.TRADOVATE_LISTENER_ENABLE_LIVE === "true";

/**
 * Global kill-switch. When set to "true", the worker boots, logs that listeners
 * are disabled, runs reconcile (which skips every row with reason
 * "listener_globally_disabled"), and never opens a WebSocket. Use this to keep
 * the worker process alive on Railway while pausing all real-time activity.
 */
const LISTENER_DISABLED = process.env.TRADOVATE_LISTENER_DISABLED === "true";

/**
 * Debug filter. When set to a BrokerConnection id, only that connection is
 * considered by reconcile — every other row is skipped with reason
 * "single_connection_filter". Lets us isolate one broken connection without
 * stopping the rest.
 */
const SINGLE_CONNECTION_ID =
  process.env.TRADOVATE_LISTENER_CONNECTION_ID?.trim() || null;

// ── WebSocket adapter ────────────────────────────────────────────────────────

/**
 * Wrap a Node `ws.WebSocket` in our minimal `WebSocketLike` interface, ensuring
 * every message payload is converted to a string (SockJS frames are text).
 */
function makeWsFactory(): WebSocketFactory {
  return (url: string): WebSocketLike => {
    const ws = new WebSocket(url);

    const adapter: WebSocketLike = {
      get readyState() {
        return ws.readyState;
      },
      send: (data: string) => ws.send(data),
      close: () => ws.close(),
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
    };

    ws.on("open", () => adapter.onopen?.(null));
    ws.on("message", (data) => {
      const text = typeof data === "string" ? data : data.toString("utf8");
      adapter.onmessage?.({ data: text });
    });
    ws.on("error", (err) => adapter.onerror?.(err));
    ws.on("close", (code, reasonBuf) => {
      const reason = typeof reasonBuf === "string" ? reasonBuf : reasonBuf.toString("utf8");
      adapter.onclose?.({ code, reason });
    });

    return adapter;
  };
}

// ── DB helpers ───────────────────────────────────────────────────────────────

async function loadHealthyConnectionRows(): Promise<BrokerConnectionRow[]> {
  return prisma.brokerConnection.findMany({
    where: {
      platform: "tradovate",
      connectionStatus: { in: ["connected_readonly", "connected_live"] },
    },
    select: {
      id: true,
      userId: true,
      platform: true,
      env: true,
      brokerUserId: true,
      connectionStatus: true,
      permissionLevel: true,
      tokenExpiresAt: true,
      lastRenewError: true,
      listenerStatus: true,
      listenerNextRetryAt: true,
      listenerDisabledAt: true,
    },
  });
}

async function getAccessTokenForConnection(
  connectionId: string,
  userId: string,
  options: { forceRefresh?: boolean } = {},
): Promise<string> {
  // Refresh first if expiring (or unconditionally on forceRefresh) — same
  // code path used by cron sync.
  await ensureTradovateAccessToken({
    brokerConnectionId: connectionId,
    userId,
    forceRefresh: options.forceRefresh ?? false,
  });

  const bc = await prisma.brokerConnection.findFirst({
    where: { id: connectionId, userId },
    select: { accessTokenEncrypted: true },
  });
  if (!bc?.accessTokenEncrypted) {
    throw new Error("BrokerConnection has no stored access token after ensure.");
  }
  // parseAndDecrypt returns the cleartext token; it is returned directly to the
  // listener and never stored in a variable that is logged or serialised.
  return parseAndDecrypt(bc.accessTokenEncrypted);
}

/**
 * Decode public JWT claims from a token for diagnostic logging.
 * The token string itself is NEVER logged — only derived metadata.
 * Returns null if the token is not a JWT or cannot be parsed.
 */
function tryDecodeJwtPublicClaims(
  token: string,
): { exp: number | null; iat: number | null; env: string | null; scope: string | null } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString(),
    ) as Record<string, unknown>;
    return {
      exp: typeof payload.exp === "number" ? payload.exp : null,
      iat: typeof payload.iat === "number" ? payload.iat : null,
      env: typeof payload.env === "string" ? payload.env : null,
      scope: typeof payload.scope === "string" ? payload.scope : null,
    };
  } catch {
    return null;
  }
}

/**
 * Read non-secret token lifecycle fields for diagnostic logging. Returns ISO
 * timestamps, derived ages, and decoded JWT public claims (if the token is a
 * JWT). NEVER logs encrypted token blobs or cleartext token values.
 */
async function loadAuthDiagnostics(connectionId: string): Promise<{
  tokenExpiresAt: string | null;
  minutesUntilExpiry: number | null;
  lastRenewedAt: string | null;
  minutesSinceRenewal: number | null;
  tokenJwtClaims: { exp: number | null; iat: number | null; env: string | null; scope: string | null } | null;
}> {
  const bc = await prisma.brokerConnection.findUnique({
    where: { id: connectionId },
    select: { tokenExpiresAt: true, lastRenewedAt: true, accessTokenEncrypted: true },
  });
  const now = Date.now();
  const tokenExpiresAt = bc?.tokenExpiresAt ?? null;
  const lastRenewedAt = bc?.lastRenewedAt ?? null;

  let tokenJwtClaims = null;
  if (bc?.accessTokenEncrypted) {
    try {
      const token = parseAndDecrypt(bc.accessTokenEncrypted);
      tokenJwtClaims = tryDecodeJwtPublicClaims(token);
    } catch {
      // Decryption failed — skip JWT claims
    }
  }

  return {
    tokenExpiresAt: tokenExpiresAt?.toISOString() ?? null,
    minutesUntilExpiry:
      tokenExpiresAt != null ? Math.round((tokenExpiresAt.getTime() - now) / 60_000) : null,
    lastRenewedAt: lastRenewedAt?.toISOString() ?? null,
    minutesSinceRenewal:
      lastRenewedAt != null ? Math.round((now - lastRenewedAt.getTime()) / 60_000) : null,
    tokenJwtClaims,
  };
}

async function writeListenerStatus(
  connectionId: string,
  state: ListenerState,
): Promise<void> {
  const dbStatus = listenerStateToDbStatus(state);
  try {
    await prisma.brokerConnection.update({
      where: { id: connectionId },
      data: {
        listenerStatus: dbStatus,
        // Stamp listenerConnectedAt on first transition to "connected" and
        // reset the retry tracker — we made it past authorize.
        ...(dbStatus === "connected"
          ? {
              listenerConnectedAt: new Date(),
              listenerErrorMessage: null,
              listenerNextRetryAt: null,
              listenerRetryCount: 0,
              listenerLastAuthFailureAt: null,
            }
          : {}),
        ...(dbStatus === "closed"
          ? { listenerErrorMessage: null }
          : {}),
      },
    });
  } catch (err) {
    console.error("[listener-worker] failed to persist listener status", {
      connectionId,
      dbStatus,
      error: errMessage(err),
    });
  }
}

async function writeListenerEventTimestamp(connectionId: string): Promise<void> {
  try {
    await prisma.brokerConnection.update({
      where: { id: connectionId },
      data: { listenerLastEventAt: new Date() },
    });
  } catch (err) {
    console.error("[listener-worker] failed to persist event timestamp", {
      connectionId,
      error: errMessage(err),
    });
  }
}

async function writeListenerHeartbeat(connectionId: string, at: Date): Promise<void> {
  try {
    await prisma.brokerConnection.update({
      where: { id: connectionId },
      data: { listenerLastHeartbeatAt: at, listenerStatus: "connected" },
    });
  } catch (err) {
    console.error("[listener-worker] failed to persist heartbeat", {
      connectionId,
      error: errMessage(err),
    });
  }
}

async function writeListenerTerminalError(connectionId: string, reason: string): Promise<void> {
  // Soft-retry tracking: when the listener gives up, schedule the next retry
  // using an exponential backoff instead of marking the connection dead.
  // The planner skips with "listener_retry_cooldown" until nextRetryAt passes.
  try {
    const current = await prisma.brokerConnection.findUnique({
      where: { id: connectionId },
      select: { listenerRetryCount: true },
    });
    const retryCount = current?.listenerRetryCount ?? 0;
    const delayMs = computeRetryDelayMs(retryCount);
    const now = new Date();
    const nextRetryAt = new Date(now.getTime() + delayMs);
    await prisma.brokerConnection.update({
      where: { id: connectionId },
      data: {
        listenerStatus: "error",
        listenerErrorMessage: reason,
        listenerLastAuthFailureAt: now,
        listenerNextRetryAt: nextRetryAt,
        listenerRetryCount: retryCount + 1,
      },
    });
    console.warn("[listener-worker] terminal error — scheduled retry", {
      connectionId,
      retryCount: retryCount + 1,
      nextRetryAt: nextRetryAt.toISOString(),
      delayMs,
    });
  } catch (err) {
    console.error("[listener-worker] failed to persist terminal error", {
      connectionId,
      error: errMessage(err),
    });
  }
}

/** Persist the close code and reason from the most recent unexpected close. */
async function writeListenerClose(
  connectionId: string,
  code: number,
  reason: string,
): Promise<void> {
  try {
    await prisma.brokerConnection.update({
      where: { id: connectionId },
      data: {
        listenerLastCloseCode: code,
        listenerLastCloseReason: reason || null,
      },
    });
  } catch (err) {
    console.error("[listener-worker] failed to persist close info", {
      connectionId,
      error: errMessage(err),
    });
  }
}

/** Persist the most recent authorize-response status for diagnostics. */
async function writeListenerAuthStatus(
  connectionId: string,
  status: number,
): Promise<void> {
  try {
    await prisma.brokerConnection.update({
      where: { id: connectionId },
      data: { listenerLastAuthStatus: status },
    });
  } catch (err) {
    console.error("[listener-worker] failed to persist auth status", {
      connectionId,
      error: errMessage(err),
    });
  }
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "unknown";
}

function safeUrlHost(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

/**
 * Build a safe per-connection endpoint chain object for diagnostic logging.
 * Shows which token URL, REST base, and WS host will be used for this env —
 * a token issued by the wrong host will be rejected by the WS with 401.
 */
function buildEndpointChainDiag(env: "live" | "demo") {
  const cfg = getTradovateConfig();
  if (cfg.state !== "ready") return { env, configReady: false };
  return {
    env,
    configReady: true,
    tokenUrlHost: safeUrlHost(cfg.config.tokenUrl[env]),
    restBaseHost: safeUrlHost(cfg.config.apiBaseUrl[env]),
    wsHost: safeUrlHost(TRADOVATE_WS_URL[env]),
    tokenAndRestSameHost:
      safeUrlHost(cfg.config.tokenUrl[env]) === safeUrlHost(cfg.config.apiBaseUrl[env]),
  };
}

function parsePositiveInt(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Resolve the Tradovate-side userId required for `user/syncrequest`.
 *
 * 1. If the BrokerConnection already stored a valid numeric brokerUserId, use it.
 * 2. Otherwise, call /account/list with the connection's access token. Each
 *    TvAccount carries the Tradovate userId; persist the first one we see back
 *    to BrokerConnection.brokerUserId so subsequent reconciles read it directly.
 *
 * Throws if no accounts are returned or the API call fails — the caller logs
 * and continues to the next connection (no crash, no flatten).
 */
async function resolveTradovateUserId(
  connectionId: string,
  userId: string,
  env: "live" | "demo",
  brokerUserIdHint: string | null,
): Promise<number> {
  const cached = parsePositiveInt(brokerUserIdHint);
  if (cached !== null) return cached;

  const cfg = getTradovateConfig();
  if (cfg.state !== "ready") {
    throw new Error(`Tradovate config not ready: missing ${cfg.missing.join(", ")}`);
  }
  const apiBase = cfg.config.apiBaseUrl[env];

  const accessToken = await getAccessTokenForConnection(connectionId, userId);
  const accountListUrl = `${apiBase}/account/list`;
  console.info("[listener-worker] probing /account/list for userId", {
    connectionId,
    env,
    restBaseHost: safeUrlHost(apiBase),
  });
  const res = await fetch(accountListUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`account/list returned ${res.status} from ${safeUrlHost(apiBase)}`);
  }
  const accounts = (await res.json()) as Array<{ userId?: unknown }>;
  const first = accounts.find((a) => typeof a.userId === "number" && Number.isFinite(a.userId) && a.userId > 0);
  const resolved = first?.userId as number | undefined;
  if (!resolved) {
    throw new Error(`account/list returned no accounts with a usable userId (from ${safeUrlHost(apiBase)})`);
  }

  await prisma.brokerConnection.update({
    where: { id: connectionId },
    data: { brokerUserId: String(resolved) },
  });
  console.info("[listener-worker] backfilled brokerUserId from /account/list", {
    connectionId,
    env,
    restBaseHost: safeUrlHost(apiBase),
  });
  return resolved;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Boot / reconcile ─────────────────────────────────────────────────────────

const manager = new TradovateListenerManager(makeWsFactory());

async function reconcileListeners(): Promise<void> {
  const rows = await loadHealthyConnectionRows();
  const { start: plans, skipped } = planListenerStartups(rows, {
    enableLive: ENABLE_LIVE,
    globallyDisabled: LISTENER_DISABLED,
    singleConnectionId: SINGLE_CONNECTION_ID,
  });

  // Before starting any listener, clear `listenerStatus = "error"` for rows
  // whose cooldown has elapsed so the next reconcile loop sees a fresh slate.
  // (The planner already lets these rows through; this update keeps the DB
  // status accurate for the dashboard and the /status endpoint.)
  const now = new Date();
  const cooldownExpired = rows.filter(
    (r) =>
      r.listenerStatus === "error" &&
      r.listenerNextRetryAt !== null &&
      r.listenerNextRetryAt <= now,
  );
  for (const r of cooldownExpired) {
    try {
      await prisma.brokerConnection.update({
        where: { id: r.id },
        data: { listenerStatus: null, listenerErrorMessage: null },
      });
      console.info("[listener-worker] retry cooldown expired — clearing error", {
        connectionId: r.id,
      });
    } catch (err) {
      console.error("[listener-worker] failed to clear expired cooldown", {
        connectionId: r.id,
        error: errMessage(err),
      });
    }
  }

  for (const skip of skipped) {
    console.info("[listener-worker] skipping connection", skip);
  }

  // Stop any managed listeners whose connection is no longer healthy.
  const healthyIds = new Set(plans.map((p) => p.connectionId));
  for (const status of manager.allListenerStatuses()) {
    if (!healthyIds.has(status.connectionId)) {
      console.info("[listener-worker] stopping listener — connection no longer healthy", {
        connectionId: status.connectionId,
      });
      manager.stopListener(status.connectionId);
      // Clear DB status so dashboard falls back to lastSyncAt.
      await writeListenerStatus(status.connectionId, "closed");
    }
  }

  let started = 0;
  let dedup = 0;
  let resolveFailed = 0;
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i]!;
    if (manager.hasListener(plan.connectionId)) {
      dedup++;
      continue;
    }
    // Stagger to avoid a thundering-herd of socket opens on startup.
    if (i > 0) await sleep(STARTUP_STAGGER_MS);

    let tradovateUserId: number;
    try {
      tradovateUserId = await resolveTradovateUserId(
        plan.connectionId,
        plan.userId,
        plan.env,
        plan.brokerUserIdHint,
      );
    } catch (err) {
      console.error("[listener-worker] failed to resolve tradovateUserId", {
        connectionId: plan.connectionId,
        env: plan.env,
        hadHint: plan.brokerUserIdHint !== null,
        error: errMessage(err),
      });
      resolveFailed++;
      continue;
    }

    // Log the full env→endpoint chain so any host mismatch is visible before
    // the first authorize attempt. A token issued by the wrong host will cause
    // a 401 on the WS even with a valid, unexpired token.
    console.info("[listener-worker] connection endpoint chain", {
      connectionId: plan.connectionId,
      ...buildEndpointChainDiag(plan.env),
    });

    // Mark "connecting" before the socket opens so the dashboard reflects
    // intent immediately.
    await writeListenerStatus(plan.connectionId, "connecting");

    const wasStarted = await manager.startListener({
      connectionId: plan.connectionId,
      tradovateUserId,
      env: plan.env,
      permissionLevel: plan.permissionLevel,
      getAccessToken: (opts) =>
        getAccessTokenForConnection(plan.connectionId, plan.userId, opts ?? {}),
      // Phase 1: observe-only. Do NOT run enforcement, do NOT flatten,
      // do NOT lock the account. We only record that an event arrived.
      onPropsEvent: (connectionId) => {
        void writeListenerEventTimestamp(connectionId);
      },
      onHeartbeat: (connectionId, at) => {
        void writeListenerHeartbeat(connectionId, at);
      },

      onStateChange: (connectionId, state) => {
        void writeListenerStatus(connectionId, state);
      },
      onTerminalError: (connectionId, reason) => {
        console.warn("[listener-worker] listener gave up — will not reconnect until repaired", {
          connectionId,
        });
        void writeListenerTerminalError(connectionId, reason);
      },
      onAuthFailed: (connectionId, info) => {
        void (async () => {
          await writeListenerAuthStatus(connectionId, info.status);
          const diag = await loadAuthDiagnostics(connectionId).catch(() => null);
          console.warn("[listener-worker] authorize rejected", {
            connectionId,
            status: info.status,
            errorText: info.errorText,
            willRetryWithForcedRefresh: info.willRetryWithForcedRefresh,
            tokenExpiresAt: diag?.tokenExpiresAt ?? null,
            minutesUntilExpiry: diag?.minutesUntilExpiry ?? null,
            lastRenewedAt: diag?.lastRenewedAt ?? null,
            minutesSinceRenewal: diag?.minutesSinceRenewal ?? null,
            tokenJwtClaims: diag?.tokenJwtClaims ?? null,
            ...buildEndpointChainDiag(plan.env),
          });
        })();
      },
      onClose: (connectionId, info) => {
        // Persist close code/reason for the debug endpoint and alert surface.
        // Code 1006 = abnormal closure (TCP drop without WS close frame).
        void writeListenerClose(connectionId, info.code, info.reason);
        console.info("[listener-worker] listener WebSocket closed", {
          connectionId,
          code: info.code,
          reason: info.reason || null,
          stateAtClose: info.stateAtClose,
          msSinceReady: info.msSinceReady,
          lastFrameType: info.lastFrameType,
          lastFrameAt: info.lastFrameAt?.toISOString() ?? null,
          phase: "ws_closed",
        });
      },
    });

    if (wasStarted) started++;
    else dedup++;
  }

  console.info("[listener-worker] reconcile complete", {
    scanned: rows.length,
    started,
    dedup,
    skipped: skipped.length,
    resolveFailed,
    active: manager.listenerCount,
  });
}

// ── Graceful shutdown ────────────────────────────────────────────────────────

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info("[listener-worker] shutting down", { signal });

  // Persist "closed" status for all listeners before tearing them down so the
  // dashboard immediately falls back to lastSyncAt.
  const statuses = manager.allListenerStatuses();
  manager.closeAll();
  await Promise.allSettled(
    statuses.map((s) => writeListenerStatus(s.connectionId, "closed")),
  );

  await Promise.race([
    prisma.$disconnect(),
    sleep(SHUTDOWN_GRACE_MS),
  ]);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// ── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.info("[listener-worker] starting", {
    rescanIntervalMs: RESCAN_INTERVAL_MS,
    staggerMs: STARTUP_STAGGER_MS,
    mode: "observe-only",
    enableLive: ENABLE_LIVE,
    listenerDisabled: LISTENER_DISABLED,
    singleConnectionId: SINGLE_CONNECTION_ID,
  });
  if (LISTENER_DISABLED) {
    console.warn(
      "[listener-worker] TRADOVATE_LISTENER_DISABLED=true — no WebSockets will be opened",
    );
  }
  if (SINGLE_CONNECTION_ID) {
    console.warn(
      "[listener-worker] TRADOVATE_LISTENER_CONNECTION_ID is set — scoping reconcile to a single connection",
      { connectionId: SINGLE_CONNECTION_ID },
    );
  }

  await reconcileListeners();

  setInterval(() => {
    reconcileListeners().catch((err) => {
      console.error("[listener-worker] reconcile failed", { error: errMessage(err) });
    });
  }, RESCAN_INTERVAL_MS);
}

main().catch((err) => {
  console.error("[listener-worker] fatal startup error", { error: errMessage(err) });
  process.exit(1);
});
