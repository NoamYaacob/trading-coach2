/**
 * Tradovate OAuth state helpers.
 *
 * `state` is round-tripped through Tradovate's authorize endpoint. It
 * encodes a CSRF nonce (matched against an httpOnly cookie set on
 * /connect) plus enough context to resume the flow on /callback. The
 * payload is base64url-encoded JSON, NOT signed — both endpoints must
 * still verify the active session against `payload.userId` to bind
 * tokens to the originating account.
 */

import { randomBytes } from "node:crypto";

export type TradovateOAuthEnv = "live" | "demo";

export type TradovateOAuthState = {
  nonce: string;
  userId: string;
  env: TradovateOAuthEnv;
  /** Links back to the PendingBrokerSetup record created in the setup form. */
  setupId?: string;
};

export function generateOAuthNonce(): string {
  return randomBytes(16).toString("hex");
}

export function encodeOAuthState(state: TradovateOAuthState): string {
  return Buffer.from(JSON.stringify(state)).toString("base64url");
}

export type DecodeResult =
  | { ok: true; state: TradovateOAuthState }
  | { ok: false; reason: "invalid_state" };

export function decodeOAuthState(raw: string): DecodeResult {
  try {
    const json = Buffer.from(raw, "base64url").toString();
    const parsed = JSON.parse(json) as Partial<TradovateOAuthState>;
    if (
      typeof parsed.nonce !== "string" ||
      parsed.nonce.length === 0 ||
      typeof parsed.userId !== "string" ||
      parsed.userId.length === 0 ||
      (parsed.env !== "live" && parsed.env !== "demo")
    ) {
      return { ok: false, reason: "invalid_state" };
    }
    return {
      ok: true,
      state: {
        nonce: parsed.nonce,
        userId: parsed.userId,
        env: parsed.env,
        setupId: typeof parsed.setupId === "string" && parsed.setupId.length > 0
          ? parsed.setupId
          : undefined,
      },
    };
  } catch {
    return { ok: false, reason: "invalid_state" };
  }
}

export type ValidateResult =
  | { ok: true }
  | {
      ok: false;
      reason: "invalid_state" | "csrf_mismatch" | "session_mismatch";
    };

/**
 * Apply every check the callback needs in one place so the rules are
 * trivially testable. Caller still loads the cookie nonce and the
 * authenticated user; this function is pure.
 */
export function validateOAuthState(params: {
  rawState: string;
  cookieNonce: string | null | undefined;
  sessionUserId: string;
}): ValidateResult & { state?: TradovateOAuthState } {
  const decoded = decodeOAuthState(params.rawState);
  if (!decoded.ok) return { ok: false, reason: "invalid_state" };
  if (!params.cookieNonce || params.cookieNonce !== decoded.state.nonce) {
    return { ok: false, reason: "csrf_mismatch" };
  }
  if (decoded.state.userId !== params.sessionUserId) {
    return { ok: false, reason: "session_mismatch" };
  }
  return { ok: true, state: decoded.state };
}
