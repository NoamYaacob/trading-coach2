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
