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
 * One-shot, end-to-end probe of a single Tradovate connection that tests four
 * authorize frame formats against the same access token:
 *
 *   A. JSON-stringified body:                    authorize\n1\n\n"<token>"
 *   B. Raw body (CONFIRMED WORKING — production): authorize\n1\n\n<token>
 *   C. Bearer body:                              authorize\n1\n\n"Bearer <token>"
 *   D. SockJS array-wrapped:                     ["authorize\n1\n\n\"<token>\""]
 *
 * Each variant opens a fresh WebSocket, waits for the SockJS "o" open frame,
 * sends its payload, and waits up to 10 seconds for a response. Results are
 * returned in the `variants` array.
 *
 * The access token value is never logged, persisted, or returned. Only
 * payloadLength (byte count) is reported per variant.
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

type VariantProbeResult = {
  variantName: string;
  confirmedWorkingFormat: boolean;
  sentAfterSockJsOpen: boolean;
  authStatus: number | null;
  authOk: boolean;
  errorText: string | null;
  closeCode: number | null;
  closeReason: string | null;
  timing: { openMs: number | null; authorizeMs: number | null };
  payloadLength: number | null;
};

/**
 * Four authorize payload formats to probe. A fresh WS connection is opened for
 * each variant. The token is passed to buildPayload at call time — never stored
 * in the array or returned in any response field.
 *
 * `B_raw` is the confirmed-working production format (probe run 2026-05-14:
 * A=401, B=200, C=401, D=closed/Bye). `encodeAuthorizeMessage` now emits this
 * format. The other variants are kept for ongoing diagnostics — if Tradovate
 * changes their handshake, this probe will flag it.
 */
const PROBE_VARIANTS: Array<{
  name: string;
  confirmedWorkingFormat: boolean;
  buildPayload: (t: string) => string;
}> = [
  {
    name: "A_json_stringified",
    confirmedWorkingFormat: false,
    // Inline JSON.stringify — must NOT call encodeAuthorizeMessage, which now
    // produces the raw (B_raw) format.
    buildPayload: (t) => `authorize\n1\n\n${JSON.stringify(t)}`,
  },
  {
    name: "B_raw",
    confirmedWorkingFormat: true,
    // Production format. Equivalent to encodeAuthorizeMessage(1, t).
    buildPayload: (t) => encodeAuthorizeMessage(1, t),
  },
  {
    name: "C_bearer",
    confirmedWorkingFormat: false,
    buildPayload: (t) => `authorize\n1\n\n${JSON.stringify(`Bearer ${t}`)}`,
  },
  {
    name: "D_sockjs_array",
    confirmedWorkingFormat: false,
    buildPayload: (t) => JSON.stringify([`authorize\n1\n\n${JSON.stringify(t)}`]),
  },
];

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

  // Step 3: probe each authorize variant with a fresh connection per variant
  const wsUrl = TRADOVATE_WS_URL[env];
  const variants: VariantProbeResult[] = [];
  for (const variant of PROBE_VARIANTS) {
    const result = await probeWebSocketVariant(
      wsUrl,
      variant.name,
      variant.confirmedWorkingFormat,
      variant.buildPayload,
      accessToken,
    );
    variants.push(result);
  }

  return NextResponse.json({
    ok: variants.some((v) => v.authOk),
    connectionId,
    endpointChain,
    accountList: accountListResult,
    variants,
  });
}

async function probeWebSocketVariant(
  url: string,
  variantName: string,
  confirmedWorkingFormat: boolean,
  buildPayload: (token: string) => string,
  accessToken: string,
): Promise<VariantProbeResult> {
  return new Promise<VariantProbeResult>((resolve) => {
    const start = Date.now();
    let openAt: number | null = null;
    let authorizeSentAt: number | null = null;
    let payloadLength: number | null = null;
    let sentAfterSockJsOpen = false;
    let settled = false;
    const ws = new WebSocket(url);

    const settle = (
      partial: Omit<
        VariantProbeResult,
        "variantName" | "confirmedWorkingFormat" | "sentAfterSockJsOpen" | "payloadLength"
      >,
    ) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* ignore */ }
      resolve({
        variantName,
        confirmedWorkingFormat,
        sentAfterSockJsOpen,
        payloadLength,
        ...partial,
      });
    };

    const openTimer = setTimeout(() => {
      settle({
        authStatus: null,
        authOk: false,
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
        try {
          const payload = buildPayload(accessToken);
          payloadLength = Buffer.byteLength(payload, "utf8");
          ws.send(payload);
          sentAfterSockJsOpen = true;
          authorizeSentAt = Date.now();
          authTimer = setTimeout(() => {
            settle({
              authStatus: null,
              authOk: false,
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
            authStatus: null,
            authOk: false,
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
          settle({
            authStatus: status,
            authOk: status === 200,
            closeCode: null,
            closeReason: null,
            errorText: sanitizeErrorText(
              status === 200 ? null : JSON.stringify(parsed.data.p ?? null),
            ),
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
        authStatus: null,
        authOk: false,
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
        authStatus: null,
        authOk: false,
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
