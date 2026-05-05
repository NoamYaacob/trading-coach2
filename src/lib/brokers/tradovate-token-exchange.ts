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
