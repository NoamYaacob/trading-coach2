/**
 * Pure helpers for the Tradovate OAuth token-exchange step.
 *
 * Extracted from the callback route handler so they can be unit-tested
 * without spinning up a full Next.js server.
 */

/**
 * Map a Tradovate OAuth error code (from the token endpoint response body)
 * to a Guardrail error code surfaced on the connect page.
 *
 * Tradovate uses standard OAuth2 error codes:
 *   invalid_grant         – code expired, already used, or redirect_uri differs
 *   invalid_client        – client_id / client_secret rejected
 *   redirect_uri_mismatch – redirect_uri in token exchange ≠ authorization request
 */
export function mapTvTokenError(tvError: string): string {
  switch (tvError) {
    case "invalid_grant":
      return "oauth_code_expired_or_reused";
    case "invalid_client":
      return "oauth_invalid_client";
    case "redirect_uri_mismatch":
      return "oauth_redirect_uri_mismatch";
    default:
      return "token_exchange_failed";
  }
}

/**
 * Attempt to parse a Tradovate token-endpoint error body.
 * Returns empty strings if the body is not valid JSON or the expected fields
 * are absent — never throws.
 */
export function parseTvTokenErrorBody(body: string): {
  tvError: string;
  tvErrorDesc: string;
} {
  try {
    const parsed = JSON.parse(body) as { error?: unknown; error_description?: unknown };
    return {
      tvError: typeof parsed.error === "string" ? parsed.error : "",
      tvErrorDesc:
        typeof parsed.error_description === "string"
          ? parsed.error_description.slice(0, 300)
          : "",
    };
  } catch {
    return { tvError: "", tvErrorDesc: "" };
  }
}

/** Normalized token fields extracted from a Tradovate OAuth token response. */
export type TvParsedToken = {
  accessToken: string;
  refreshToken: string | null;
  accountId: string | null;
  expiresIn: number | null;
};

export type TvTokenParseResult =
  | { ok: true; token: TvParsedToken; responseKeys: string[] }
  | { ok: false; tvError: string | null; tvErrorDesc: string | null; responseKeys: string[] };

function pickString(primary: unknown, fallback: unknown): string | null {
  if (typeof primary === "string" && primary.length > 0) return primary;
  if (typeof fallback === "string" && fallback.length > 0) return fallback;
  return null;
}

function pickPositiveNumber(primary: unknown, fallback: unknown): number | null {
  if (typeof primary === "number" && Number.isFinite(primary) && primary > 0) return primary;
  if (typeof fallback === "number" && Number.isFinite(fallback) && fallback > 0) return fallback;
  return null;
}

/**
 * Parse a Tradovate OAuth token response, normalising both snake_case
 * (access_token) and camelCase (accessToken) field names. Tradovate REST
 * APIs use camelCase; the OAuth token endpoint response shape is not
 * officially documented and may differ — both conventions are supported.
 *
 * Tradovate returns OAuth errors as HTTP 200 with { error, error_description }
 * body. When no access token is found, tvError/tvErrorDesc are populated so
 * the caller can map to a specific error code via mapTvTokenError().
 */
export function parseTvTokenResponse(rawJson: unknown): TvTokenParseResult {
  if (rawJson === null || typeof rawJson !== "object" || Array.isArray(rawJson)) {
    return { ok: false, tvError: null, tvErrorDesc: null, responseKeys: [] };
  }
  const obj = rawJson as Record<string, unknown>;
  const responseKeys = Object.keys(obj);

  // Extract safe OAuth error fields — these are diagnostic strings, not secrets.
  const tvError =
    typeof obj.error === "string" && obj.error.length > 0 ? obj.error : null;
  const tvErrorDesc =
    typeof obj.error_description === "string"
      ? obj.error_description.slice(0, 300)
      : null;

  const accessToken = pickString(obj.access_token, obj.accessToken);
  if (!accessToken) {
    return { ok: false, tvError, tvErrorDesc, responseKeys };
  }

  const rawId = obj.account_id ?? obj.accountId;
  const accountId = rawId != null ? String(rawId) : null;

  return {
    ok: true,
    responseKeys,
    token: {
      accessToken,
      refreshToken: pickString(obj.refresh_token, obj.refreshToken),
      accountId,
      expiresIn: pickPositiveNumber(obj.expires_in, obj.expiresIn),
    },
  };
}

// ── Token-exchange request builder ────────────────────────────────────────────

export type TvTokenRequest = {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
};

export type TvTokenRequestShape = {
  tokenUrl: string;
  method: "POST";
  contentType: string;
  hasCode: boolean;
  hasRedirectUri: boolean;
  hasClientId: boolean;
  hasClientSecretInBody: boolean;
  hasAuthorizationHeader: boolean;
  grantType: string | null;
};

/**
 * Build the Tradovate OAuth token-exchange request.
 *
 * Uses the standard OAuth 2.0 (RFC 6749 §4.1.3) token request format:
 *   POST <tokenUrl>
 *   Content-Type: application/x-www-form-urlencoded
 *   Body: grant_type=authorization_code&code=...&redirect_uri=...
 *         &client_id=...&client_secret=...
 *
 * Client credentials go in the body (not Basic Auth) because Tradovate's
 * sample OAuth flow accepts them there. If invalid_client is returned with
 * this format, the cause is value mismatch (wrong CID, secret, or redirect_uri),
 * not format mismatch — invalid_request would surface format issues instead.
 */
export function buildTradovateOAuthTokenRequest(params: {
  tokenUrl: string;
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): TvTokenRequest {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    client_secret: params.clientSecret,
  });
  return {
    url: params.tokenUrl,
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  };
}

/**
 * Sanitized shape of a token request — booleans only for the sensitive fields
 * (code, client_secret), the value for non-sensitive ones (grant_type, content-type).
 * Safe to log in production.
 */
export function describeTokenRequestShape(req: TvTokenRequest): TvTokenRequestShape {
  const params = new URLSearchParams(req.body);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k.toLowerCase()] = v;
  }
  return {
    tokenUrl: req.url,
    method: req.method,
    contentType: headers["content-type"] ?? "",
    hasCode: params.has("code"),
    hasRedirectUri: params.has("redirect_uri"),
    hasClientId: params.has("client_id"),
    hasClientSecretInBody: params.has("client_secret"),
    hasAuthorizationHeader: "authorization" in headers,
    grantType: params.get("grant_type"),
  };
}
