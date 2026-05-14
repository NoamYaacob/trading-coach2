import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import WebSocket from "ws";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ensureTradovateAccessToken } from "@/lib/brokers/tradovate-ensure-token";
import { parseAndDecrypt } from "@/lib/security/token-crypto";
import { getTradovateConfig } from "@/lib/brokers/tradovate-env";
import {
  TRADOVATE_WS_URL,
  encodeAuthorizeMessage,
  parseSockJSFrame,
  parseTradovateMessage,
} from "@/lib/brokers/tradovate-websocket-protocol";

// Force Node runtime — ws is a Node-only package and Edge cannot open WebSockets.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/debug/tradovate-listener/probe
 *
 * One-shot, end-to-end probe of a single Tradovate connection:
 *
 *   1. Ensure-token (refresh if expiring) and decrypt to RAM.
 *   2. Log the endpoint chain (tokenUrlHost / restBaseHost / wsHost).
 *   3. Call `/account/list` on the env-specific REST base.
 *   4. Open the env-specific WebSocket.
 *   5. Wait for the SockJS "o" frame.
 *   6. Send the official authorize frame: `authorize\n<id>\n\n"<token>"`.
 *   7. Wait for the authorize response (timeout enforced).
 *   8. Close the WS and return sanitized results.
 *
 * The token value is never logged, persisted, or returned. Only response
 * status codes, close codes, error texts, and timing metadata leave this
 * endpoint.
 *
 * Body: { connectionId: string }
 *
 * Security:
 *   - Requires authenticated session (401 otherwise).
 *   - In production requires `x-cron-secret` header matching CRON_SECRET env var.
 *   - Only operates on connections owned by the current user.
 */

const SOCKJS_OPEN_TIMEOUT_MS = 10_000;
const AUTHORIZE_RESPONSE_TIMEOUT_MS = 10_000;

export async function POST(request: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (process.env.NODE_ENV === "production") {
    const secret = request.headers.get("x-cron-secret");
    const expected = process.env.CRON_SECRET;
    if (!expected || secret !== expected) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  let body: { connectionId?: unknown } = {};
  try {
    const parsed = (await request.json()) as unknown;
    if (parsed && typeof parsed === "object") {
      body = parsed as { connectionId?: unknown };
    }
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (typeof body.connectionId !== "string" || body.connectionId.length === 0) {
    return NextResponse.json({ error: "connectionId required" }, { status: 400 });
  }
  const connectionId = body.connectionId;

  const bc = await prisma.brokerConnection.findFirst({
    where: { id: connectionId, userId: currentUser.id, platform: "tradovate" },
    select: { id: true, env: true },
  });
  if (!bc) {
    return NextResponse.json(
      { error: "connection not found or not owned by current user" },
      { status: 404 },
    );
  }
  const env = bc.env === "live" || bc.env === "demo" ? bc.env : null;
  if (env === null) {
    return NextResponse.json(
      { error: `unsupported env: ${bc.env}` },
      { status: 400 },
    );
  }

  const cfg = getTradovateConfig();
  if (cfg.state !== "ready") {
    return NextResponse.json(
      { error: "tradovate config not ready", missing: cfg.missing },
      { status: 503 },
    );
  }

  const safeHost = (url: string): string => {
    try { return new URL(url).host; } catch { return url; }
  };
  const endpointChain = {
    env,
    tokenUrlHost: safeHost(cfg.config.tokenUrl[env]),
    restBaseHost: safeHost(cfg.config.apiBaseUrl[env]),
    wsHost: safeHost(TRADOVATE_WS_URL[env]),
    tokenAndRestSameHost:
      safeHost(cfg.config.tokenUrl[env]) ===
      safeHost(cfg.config.apiBaseUrl[env]),
  };

  // Step 1: ensure-token + decrypt
  let accessToken: string;
  try {
    await ensureTradovateAccessToken({
      brokerConnectionId: connectionId,
      userId: currentUser.id,
      forceRefresh: false,
    });
    const refreshed = await prisma.brokerConnection.findFirst({
      where: { id: connectionId, userId: currentUser.id },
      select: { accessTokenEncrypted: true },
    });
    if (!refreshed?.accessTokenEncrypted) {
      return NextResponse.json(
        { ok: false, endpointChain, step: "ensure_token", error: "no_access_token_stored" },
        { status: 500 },
      );
    }
    accessToken = parseAndDecrypt(refreshed.accessTokenEncrypted);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        endpointChain,
        step: "ensure_token",
        error: err instanceof Error ? err.message : "unknown",
      },
      { status: 500 },
    );
  }

  // Step 2: /account/list against env-specific REST base
  const accountListUrl = `${cfg.config.apiBaseUrl[env]}/account/list`;
  let accountListResult: {
    ok: boolean;
    status: number;
    accountCount: number | null;
    errorText: string | null;
  };
  try {
    const res = await fetch(accountListUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const data = (await res.json()) as unknown;
      accountListResult = {
        ok: true,
        status: res.status,
        accountCount: Array.isArray(data) ? data.length : null,
        errorText: null,
      };
    } else {
      const text = await res.text().catch(() => "");
      accountListResult = {
        ok: false,
        status: res.status,
        accountCount: null,
        errorText: sanitizeErrorText(text),
      };
    }
  } catch (err) {
    accountListResult = {
      ok: false,
      status: 0,
      accountCount: null,
      errorText: err instanceof Error ? err.message : "unknown",
    };
  }

  // Step 3–5: open WS, wait for "o", send authorize, wait for response
  const wsResult = await probeWebSocket(TRADOVATE_WS_URL[env], accessToken);

  return NextResponse.json({
    ok: wsResult.outcome === "auth_ok",
    connectionId,
    endpointChain,
    accountList: accountListResult,
    ws: wsResult,
  });
}

type WsProbeResult = {
  outcome: "auth_ok" | "auth_failed" | "open_timeout" | "auth_timeout" | "closed_before_authorize" | "error";
  authStatus: number | null;
  authErrorText: string | null;
  closeCode: number | null;
  closeReason: string | null;
  errorText: string | null;
  timing: {
    openMs: number | null;
    authorizeMs: number | null;
  };
};

async function probeWebSocket(url: string, accessToken: string): Promise<WsProbeResult> {
  return new Promise<WsProbeResult>((resolve) => {
    const start = Date.now();
    let openAt: number | null = null;
    let authorizeSentAt: number | null = null;
    let settled = false;
    const ws = new WebSocket(url);

    const settle = (result: WsProbeResult) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* ignore */ }
      resolve(result);
    };

    const openTimer = setTimeout(() => {
      settle({
        outcome: "open_timeout",
        authStatus: null,
        authErrorText: null,
        closeCode: null,
        closeReason: null,
        errorText: `no SockJS open frame within ${SOCKJS_OPEN_TIMEOUT_MS}ms`,
        timing: { openMs: null, authorizeMs: null },
      });
    }, SOCKJS_OPEN_TIMEOUT_MS);

    let authTimer: NodeJS.Timeout | null = null;

    ws.on("open", () => {
      openAt = Date.now();
    });

    ws.on("message", (data) => {
      const text = typeof data === "string" ? data : data.toString("utf8");
      const frame = parseSockJSFrame(text);

      if (frame.type === "open") {
        clearTimeout(openTimer);
        // Send authorize frame after SockJS "o"
        try {
          const frameStr = encodeAuthorizeMessage(1, accessToken);
          ws.send(frameStr);
          authorizeSentAt = Date.now();
          authTimer = setTimeout(() => {
            settle({
              outcome: "auth_timeout",
              authStatus: null,
              authErrorText: null,
              closeCode: null,
              closeReason: null,
              errorText: `no authorize response within ${AUTHORIZE_RESPONSE_TIMEOUT_MS}ms`,
              timing: {
                openMs: openAt !== null ? openAt - start : null,
                authorizeMs: null,
              },
            });
          }, AUTHORIZE_RESPONSE_TIMEOUT_MS);
        } catch (err) {
          settle({
            outcome: "error",
            authStatus: null,
            authErrorText: null,
            closeCode: null,
            closeReason: null,
            errorText: err instanceof Error ? err.message : "send_failed",
            timing: {
              openMs: openAt !== null ? openAt - start : null,
              authorizeMs: null,
            },
          });
        }
        return;
      }

      if (frame.type === "data") {
        for (const item of frame.messages) {
          const parsed = parseTradovateMessage(item);
          if (parsed.kind !== "response") continue;
          if (parsed.data.i !== 1) continue;
          if (authTimer) clearTimeout(authTimer);
          const status = parsed.data.s;
          const errorText =
            status === 200 ? null : sanitizeErrorText(JSON.stringify(parsed.data.p ?? null));
          settle({
            outcome: status === 200 ? "auth_ok" : "auth_failed",
            authStatus: status,
            authErrorText: errorText,
            closeCode: null,
            closeReason: null,
            errorText: null,
            timing: {
              openMs: openAt !== null ? openAt - start : null,
              authorizeMs: authorizeSentAt !== null ? Date.now() - authorizeSentAt : null,
            },
          });
          return;
        }
      }
    });

    ws.on("close", (code, reasonBuf) => {
      if (authTimer) clearTimeout(authTimer);
      clearTimeout(openTimer);
      const reason = typeof reasonBuf === "string"
        ? reasonBuf
        : reasonBuf?.toString("utf8") ?? "";
      settle({
        outcome: authorizeSentAt === null ? "closed_before_authorize" : "error",
        authStatus: null,
        authErrorText: null,
        closeCode: code,
        closeReason: sanitizeErrorText(reason),
        errorText: null,
        timing: {
          openMs: openAt !== null ? openAt - start : null,
          authorizeMs: null,
        },
      });
    });

    ws.on("error", (err) => {
      if (authTimer) clearTimeout(authTimer);
      clearTimeout(openTimer);
      settle({
        outcome: "error",
        authStatus: null,
        authErrorText: null,
        closeCode: null,
        closeReason: null,
        errorText: err instanceof Error ? err.message : "ws_error",
        timing: {
          openMs: openAt !== null ? openAt - start : null,
          authorizeMs: null,
        },
      });
    });
  });
}

/** Truncate and strip anything that looks like a Bearer-style token. */
function sanitizeErrorText(text: string | null): string | null {
  if (text === null) return null;
  // Strip bearer tokens defensively (we never deliberately log them, but
  // Tradovate responses occasionally echo the request body in errors).
  const stripped = text.replace(/eyJ[A-Za-z0-9_\-.]{20,}/g, "[REDACTED]");
  return stripped.slice(0, 500);
}
