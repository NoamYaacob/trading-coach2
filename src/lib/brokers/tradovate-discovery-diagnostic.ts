/**
 * Pure (DB-free) diagnostic helpers for Tradovate account discovery.
 *
 * Kept in a separate module so unit tests can import them without pulling in
 * Prisma or the token-crypto layer. The DB-touching callers live in
 * `tradovate-discovery.ts` and the debug route.
 */

import type { DiscoveredAccount } from "./discovery-decision.ts";
import {
  normalizeTokenResponse,
  type TvTokenResponse,
} from "./tradovate-client-helpers.ts";

type TvAccount = {
  id: number;
  name: string;
  accountType: string;
  active: boolean;
  nickname?: string;
};

export type AccountListDiagnostic = {
  accounts: DiscoveredAccount[] | null;
  httpStatus: number | null;
  /** First 500 chars of the response body. Never contains tokens we sent. */
  bodyPreview: string | null;
  errorMessage: string | null;
};

/**
 * Like `fetchTradovateAccountList` but captures HTTP status and body preview
 * on failure so the debug endpoint can report WHY the call failed.
 *
 * The bodyPreview is truncated to 500 chars and MUST only be used in the
 * debug endpoint, never surfaced to end users.
 */
export async function fetchTradovateAccountListWithDiagnostics(
  baseUrl: string,
  accessToken: string,
): Promise<AccountListDiagnostic> {
  const url = `${baseUrl}/account/list`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
  } catch (err) {
    return {
      accounts: null,
      httpStatus: null,
      bodyPreview: null,
      errorMessage: `Network error: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }

  // Read body once — needed for both error preview and JSON parsing.
  const bodyText = await res.text().catch(() => "");
  const bodyPreview = bodyText.slice(0, 500);

  if (!res.ok) {
    return {
      accounts: null,
      httpStatus: res.status,
      bodyPreview,
      errorMessage: `HTTP ${res.status}${res.statusText ? `: ${res.statusText}` : ""}`,
    };
  }

  let data: unknown;
  try {
    data = JSON.parse(bodyText);
  } catch {
    return {
      accounts: null,
      httpStatus: res.status,
      bodyPreview,
      errorMessage: "Response body is not valid JSON",
    };
  }

  if (!Array.isArray(data)) {
    return {
      accounts: null,
      httpStatus: res.status,
      bodyPreview,
      errorMessage: `Unexpected response shape: ${data === null ? "null" : typeof data}`,
    };
  }

  const rows = data as TvAccount[];
  const accounts = rows.map((a): DiscoveredAccount => ({
    externalAccountId: String(a.id),
    name: a.nickname ?? a.name ?? String(a.id),
    accountType: a.accountType ?? "unknown",
    active: Boolean(a.active),
  }));

  return { accounts, httpStatus: res.status, bodyPreview: null, errorMessage: null };
}

export type TokenRefreshResult =
  | { attempted: false; reason: "not_needed" }
  | {
      attempted: true;
      strategy: "renew_endpoint" | "oauth_grant" | "no_refresh_token";
      succeeded: boolean;
      /** New plaintext token — used only within the debug call; never serialised into the response. */
      newToken: string | null;
      newExpiresAt: Date | null;
      httpStatus: number | null;
      errorMessage: string | null;
    };

/**
 * Attempt to refresh an expired or soon-to-expire access token.
 *
 * Two-stage strategy:
 *  1. GET /auth/renewAccessToken using the current Bearer (lightweight).
 *  2. Fall back to POST to the OAuth token URL with grant_type=refresh_token.
 *
 * Pure HTTP — does NOT write to the DB. The caller persists a successful
 * `newToken`. Never logs or returns raw token values.
 */
export async function tryRefreshToken(input: {
  accessToken: string;
  refreshToken: string | null;
  renewUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
}): Promise<TokenRefreshResult> {
  const { accessToken, refreshToken, renewUrl, tokenUrl, clientId, clientSecret } = input;

  // Stage 1: renewAccessToken (GET, uses current Bearer — no secret needed).
  let renewHttpStatus: number | null = null;
  let renewError: string | null = null;
  try {
    const res = await fetch(renewUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    renewHttpStatus = res.status;
    if (res.ok) {
      let raw: TvTokenResponse | null = null;
      try {
        raw = (await res.json()) as TvTokenResponse;
      } catch {
        renewError = "renewAccessToken response is not valid JSON";
      }
      if (raw != null) {
        const tokens = normalizeTokenResponse(raw);
        if (tokens.accessToken) {
          return {
            attempted: true,
            strategy: "renew_endpoint",
            succeeded: true,
            newToken: tokens.accessToken,
            newExpiresAt: tokens.expiresAt,
            httpStatus: res.status,
            errorMessage: null,
          };
        }
        renewError = "renewAccessToken returned no access token in body";
      }
    } else {
      renewError = `renewAccessToken HTTP ${res.status}`;
    }
  } catch (err) {
    renewError = `Network error on renewAccessToken: ${err instanceof Error ? err.message : "unknown"}`;
  }

  // No stored refresh token — can't fall through to OAuth grant.
  if (!refreshToken) {
    return {
      attempted: true,
      strategy: "no_refresh_token",
      succeeded: false,
      newToken: null,
      newExpiresAt: null,
      httpStatus: renewHttpStatus,
      errorMessage: `${renewError ?? "renewAccessToken failed"}; no refresh_token stored for fallback`,
    };
  }

  // Stage 2: OAuth refresh_token grant (POST, requires client_id + client_secret).
  try {
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });
    if (!res.ok) {
      return {
        attempted: true,
        strategy: "oauth_grant",
        succeeded: false,
        newToken: null,
        newExpiresAt: null,
        httpStatus: res.status,
        errorMessage: `OAuth grant rejected: HTTP ${res.status}`,
      };
    }
    let raw: TvTokenResponse | null = null;
    try {
      raw = (await res.json()) as TvTokenResponse;
    } catch {
      return {
        attempted: true,
        strategy: "oauth_grant",
        succeeded: false,
        newToken: null,
        newExpiresAt: null,
        httpStatus: res.status,
        errorMessage: "OAuth grant response is not valid JSON",
      };
    }
    const tokens = normalizeTokenResponse(raw);
    if (!tokens.accessToken) {
      return {
        attempted: true,
        strategy: "oauth_grant",
        succeeded: false,
        newToken: null,
        newExpiresAt: null,
        httpStatus: res.status,
        errorMessage: "OAuth grant returned no access token in body",
      };
    }
    return {
      attempted: true,
      strategy: "oauth_grant",
      succeeded: true,
      newToken: tokens.accessToken,
      newExpiresAt: tokens.expiresAt,
      httpStatus: res.status,
      errorMessage: null,
    };
  } catch (err) {
    return {
      attempted: true,
      strategy: "oauth_grant",
      succeeded: false,
      newToken: null,
      newExpiresAt: null,
      httpStatus: null,
      errorMessage: `Network error on OAuth grant: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}
