/**
 * Tradovate REST API client — server-only.
 *
 * Instantiate with a ConnectedAccount `id` and the owning user's `id`.
 * Call `initialize()` once before any read method; it loads stored tokens
 * and refreshes them if they are about to expire.
 *
 * ⚠ ENDPOINT WARNING: All Tradovate API paths in this module are based on
 * Tradovate's publicly documented REST API v1 but have NOT been verified
 * against a real account. Do not flip capabilities to "available" in
 * TradovateAdapter until each method is tested end-to-end with real
 * credentials. See docs/broker-integration-plan.md for the checklist.
 *
 * Security rules:
 *  - Token values are NEVER logged. Error messages reference codes only.
 *  - All token values are loaded via getTradovateTokensForAccount which
 *    enforces ownership. Never read token columns directly here.
 *  - New tokens after refresh are always encrypted before DB writes.
 */

import { prisma } from "@/lib/db";
import {
  getTradovateTokensForAccount,
  TradovateTokenError,
} from "./tradovate-tokens";
import { getTradovateConfig } from "./tradovate-env";
import { encryptAndSerialize } from "@/lib/security/token-crypto";
import type {
  BrokerAccountSnapshot,
  BrokerPosition,
  BrokerOrder,
  BrokerExecution,
  BrokerConnectionStatus,
} from "./types";
import {
  TradovateClientError,
  REFRESH_BUFFER_MS,
  normalizeTokenResponse,
  mapOrderStatus,
  mapOrderType,
  mapSide,
  parseSnapshotItems,
  computeSnapshotBalance,
  extractFillTimestamp,
  fillMatchesAccount,
  fillCarriesAccountId,
  isAccountScopingSuspect,
  shouldRenewToken,
  classifyRenewalError,
  type RenewalErrorClass,
  type TvTokenResponse,
} from "./tradovate-client-helpers";

export type { TradovateClientErrorCode } from "./tradovate-client-helpers";
import { isAutoLiqConfirmed, buildLiquidatePositionsPayload, isFlattenConfirmed } from "./enforcement-helpers";
import type { FlattenStatus, BrokerFlattenResult } from "./enforcement-helpers";
import { formatDateMMDDYYYY, nextCalendarDay } from "./tradovate-report-date";
export { TradovateClientError, mapOrderStatus, mapOrderType, mapSide };

// ── Raw Tradovate API shapes ──────────────────────────────────────────────────
// UNVERIFIED — shapes based on publicly documented Tradovate REST API v1.
// Field names and optionality must be confirmed with a real account.

type TvAccount = {
  id: number;
  name: string;
  userId: number;
  accountType: string;
  active: boolean;
  // Optional fields Tradovate may include — not guaranteed by the API spec.
  status?: string;    // e.g. "Active", "Inactive", "Closed"
  archived?: boolean;
  nickname?: string;
};

type TvCashBalanceSnapshot = {
  id: number;
  accountId: number;
  timestamp: string;
  // Tradovate may return any combination of these balance fields.
  // Use computeSnapshotBalance() to extract balance and P&L in one pass.
  amount: number | null;
  /** Tradovate API canonical field name — uppercase L. */
  realizedPnL?: number | null;
  /** Lowercase fallback — kept defensively in case some responses differ. */
  realizedPnl?: number | null;
  cashBalance?: number | null;
  netLiq?: number | null;
  totalCashValue?: number | null;
  accountBalance?: number | null;
  openPl?: number | null;
};

type TvPosition = {
  id: number;
  accountId: number;
  contractId: number;
  timestamp: string;
  tradePrice: number | null;
  openPl: number | null;
  netPos: number | null;
};

type TvOrder = {
  id: number;
  accountId: number;
  contractId: number;
  timestamp: string;
  action: "Buy" | "Sell";
  ordStatus: string;
  ordType: string;
  price: number | null;
  stopPrice: number | null;
  qty: number;
};

type TvFill = {
  id: number;
  orderId: number;
  contractId: number;
  // Account identification — accountId may be absent; accountSpec is the string alternative
  accountId?: number;
  accountSpec?: string;
  // Multiple possible timestamp field names across Tradovate API versions
  timestamp?: string;
  tradeDate?: { year: number; month: number; day: number } | string;
  time?: string;
  tradeTime?: string;
  // Side — either field name may appear
  action?: "Buy" | "Sell";
  side?: "Buy" | "Sell";
  // Quantity
  qty?: number;
  size?: number;
  // Price
  price?: number;
  // P&L — multiple possible field names
  profit?: number | null;
  pnl?: number | null;
  realizedPnL?: number | null;
  realizedPnl?: number | null;
  commission?: number | null;
};

type TvContract = {
  id: number;
  name: string;
};

// Field names verified against docs/tradovate-openapi.json (May 2026).
type TvUserAccountAutoLiq = {
  id?: number;
  changesLocked?: boolean | null;
  dailyLossAlert?: number | null;
  dailyLossLiqOnly?: number | null;
  dailyLossAutoLiq?: number | null;
  weeklyLossAutoLiq?: number | null;
  dailyProfitAutoLiq?: number | null;
  weeklyProfitAutoLiq?: number | null;
  flattenTimestamp?: string | null;
  trailingMaxDrawdown?: number | null;
  trailingMaxDrawdownLimit?: number | null;
  /**
   * When true, Tradovate does not auto-unlock after liquidation conditions are
   * met. We never set this field — omitting it preserves the default
   * (auto-unlock at next session open) so accounts are not permanently trapped.
   */
  doNotUnlock?: boolean | null;
};

export type AutoLiqLockResult = {
  endpoint: string;
  payload: Record<string, unknown>;
  response: unknown;
  /** True only when the response body (or a read-back GET) echoed back the
   *  auto-liq field we sent, confirming Tradovate stored the value. */
  confirmed: boolean;
  /** The auto-liq field value returned by the API (response or read-back). */
  readbackValue: number | null;
};

/** How the most recent getFills() response was scoped to one account. */
export type FillsScopingVerdict =
  | "field_scoped"
  | "unscoped_suspect"
  | "not_loaded";

// ── Client ────────────────────────────────────────────────────────────────────

/**
 * Read-only client for the Tradovate REST API (v1).
 *
 * Usage:
 *   const client = new TradovateClient(accountId, userId);
 *   await client.initialize();
 *   const accounts = await client.getAccounts();
 */
export class TradovateClient {
  readonly #accountId: string;
  readonly #userId: string;

  #accessToken: string | null = null;
  #refreshToken: string | null = null;
  #tokenExpiresAt: Date | null = null;
  /** Tradovate's integer account ID — resolved from externalAccountId or /account/list. */
  #tvAccountId: number | null = null;
  /** Set when this account's tokens live on a BrokerConnection row. */
  #brokerConnectionId: string | null = null;
  #baseUrl: string | null = null;
  /** Reporting API base URL — different host (rpt-{env}.tradovateapi.com). */
  #reportsBaseUrl: string | null = null;
  #tokenUrl: string | null = null;
  /** Auth-server renew URL — same host as #tokenUrl, different path. */
  #renewUrl: string | null = null;
  #clientId: string | null = null;
  #clientSecret: string | null = null;
  /**
   * Set by getFills() to record how the most recent fill/list response was scoped:
   *   field_scoped     — response carried per-row accountId/accountSpec
   *   unscoped_suspect — no per-row account IDs (multi-account OAuth tokens;
   *                      fills may belong to other accounts on the same token)
   *   not_loaded       — getFills() has not yet run on this client instance
   * Read via getLastFillsScopingVerdict() to gate trade-limit enforcement.
   */
  #lastFillsScopingVerdict: FillsScopingVerdict = "not_loaded";

  constructor(accountId: string, userId: string) {
    this.#accountId = accountId;
    this.#userId = userId;
  }

  /**
   * Load tokens and resolve configuration. Must be called once before any
   * read method. Idempotent — safe to call multiple times.
   */
  async initialize(): Promise<void> {
    const cfgStatus = getTradovateConfig();
    if (cfgStatus.state !== "ready") {
      throw new TradovateClientError(
        "CONFIG_MISSING",
        "Tradovate is not configured on this server.",
      );
    }
    const { config } = cfgStatus;

    const account = await prisma.connectedAccount.findUnique({
      where: { id: this.#accountId },
      select: { accountType: true, externalAccountId: true, brokerConnectionId: true },
    });
    if (!account) {
      throw new TradovateClientError("NO_TOKENS", "ConnectedAccount not found.");
    }

    // Determine env: prefer BrokerConnection.env (set during OAuth) over
    // accountType heuristic, which is unreliable for prop-firm evaluation/
    // funded accounts that actually live on the Tradovate demo environment.
    let env: "demo" | "live";
    if (account.brokerConnectionId) {
      this.#brokerConnectionId = account.brokerConnectionId;
      const bc = await prisma.brokerConnection.findUnique({
        where: { id: account.brokerConnectionId },
        select: { env: true },
      });
      env = (bc?.env as "demo" | "live") ?? (account.accountType === "demo" ? "demo" : "live");
    } else {
      env = account.accountType === "demo" ? "demo" : "live";
    }
    this.#baseUrl = config.apiBaseUrl[env];
    this.#reportsBaseUrl = config.reportsBaseUrl[env];
    this.#tokenUrl = config.tokenUrl[env];
    // Derive the renew URL from the token URL: same auth-server host, different path.
    // tokenUrl example: https://live-api.tradovate.com/auth/oauthtoken
    // renewUrl result:  https://live-api.tradovate.com/auth/renewAccessToken
    try {
      this.#renewUrl = new URL(config.tokenUrl[env]).origin + "/auth/renewAccessToken";
    } catch {
      this.#renewUrl = config.tokenUrl[env].replace(/\/[^/]+$/, "/renewAccessToken");
    }
    this.#clientId = config.clientId;
    this.#clientSecret = config.clientSecret;

    if (account.externalAccountId) {
      const parsed = parseInt(account.externalAccountId, 10);
      if (!Number.isNaN(parsed)) this.#tvAccountId = parsed;
    }

    let tokens;
    try {
      tokens = await getTradovateTokensForAccount(this.#accountId, this.#userId);
    } catch (err) {
      const msg =
        err instanceof TradovateTokenError ? err.code : "unknown";
      throw new TradovateClientError(
        "TOKEN_LOAD_FAILED",
        `Token load failed (${msg}).`,
      );
    }

    this.#accessToken = tokens.accessToken;
    this.#refreshToken = tokens.refreshToken;
    this.#tokenExpiresAt = tokens.tokenExpiresAt;
    // Override the brokerConnectionId from tokens in case initialize() loaded
    // it from ConnectedAccount.brokerConnectionId above already — they agree.
    if (tokens.brokerConnectionId) {
      this.#brokerConnectionId = tokens.brokerConnectionId;
    }

    await this.#refreshIfExpired();
  }

  /**
   * Mark the connection as expired in the DB. Used only when we have a
   * confirmed auth_invalid response from Tradovate. Transient errors
   * must NOT call this — they leave the connection in its current state
   * so the next sync can retry.
   */
  async #markConnectionExpired(reason: string): Promise<void> {
    const data = { connectionStatus: "expired", errorMessage: reason };
    if (this.#brokerConnectionId) {
      await prisma.brokerConnection.update({
        where: { id: this.#brokerConnectionId },
        data,
      });
    } else {
      await prisma.connectedAccount.update({
        where: { id: this.#accountId },
        data,
      });
    }
    console.warn("[tradovate/auth] connection marked expired", {
      accountId: this.#accountId,
      brokerConnectionId: this.#brokerConnectionId,
      reason,
    });
  }

  /**
   * Classify a token-renewal failure into auth_invalid / transient / unknown.
   * Used by the renewal flow to decide whether to mark the connection expired
   * (auth_invalid) or surface the error and let the caller retry (transient).
   */
  #classifyError(err: unknown): RenewalErrorClass {
    if (err instanceof TradovateClientError) {
      return classifyRenewalError({
        code: err.code,
        httpStatus: err.statusCode ?? null,
      });
    }
    // Treat unknown thrown values as transient by default — we don't want to
    // expire a working connection because of an unexpected internal error.
    return "transient";
  }

  /**
   * Attempt to renew the access token using the lightweight renewAccessToken
   * endpoint first, then falling back to the OAuth refresh_token grant.
   * NEVER marks the connection expired — the caller decides based on the
   * classified error class. Throws the most informative TradovateClientError
   * encountered along the way.
   */
  async #renewTokenNow(): Promise<void> {
    let firstError: unknown = null;

    try {
      await this.#renewViaApiEndpoint();
      return;
    } catch (renewErr) {
      firstError = renewErr;
      const cls = this.#classifyError(renewErr);
      console.info("[tradovate/auth] renewAccessToken failed", {
        accountId: this.#accountId,
        class: cls,
        code: renewErr instanceof TradovateClientError ? renewErr.code : "unknown",
        status: renewErr instanceof TradovateClientError ? renewErr.statusCode : undefined,
      });
      // Transient renewAccessToken errors: don't burn the refresh token by
      // attempting an OAuth grant — surface the transient failure so the
      // next sync retries.
      if (cls === "transient") throw renewErr;
      // auth_invalid or unknown → fall through to OAuth grant (the access
      // token may simply be stale; the refresh_token may still be valid).
    }

    if (!this.#refreshToken) {
      throw firstError ?? new TradovateClientError(
        "TOKEN_EXPIRED_NO_REFRESH",
        "Access token cannot be renewed and no refresh token is available.",
      );
    }

    await this.#refreshViaOAuthGrant();
  }

  async #refreshIfExpired(): Promise<void> {
    const decision = shouldRenewToken({
      expiresAt: this.#tokenExpiresAt,
      now: new Date(),
      bufferMs: REFRESH_BUFFER_MS,
    });
    console.info("[tradovate/auth] renewal decision", {
      accountId: this.#accountId,
      brokerConnectionId: this.#brokerConnectionId,
      expiresAt: this.#tokenExpiresAt?.toISOString() ?? null,
      now: new Date().toISOString(),
      bufferMs: REFRESH_BUFFER_MS,
      shouldRenew: decision.shouldRenew,
      reason: decision.reason,
      msUntilExpiry: decision.msUntilExpiry,
    });
    if (!decision.shouldRenew) return;

    try {
      await this.#renewTokenNow();
      console.info("[tradovate/auth] token renewal succeeded", {
        accountId: this.#accountId,
        newExpiresAt: this.#tokenExpiresAt?.toISOString() ?? null,
      });
    } catch (err) {
      const cls = this.#classifyError(err);
      console.warn("[tradovate/auth] token renewal failed", {
        accountId: this.#accountId,
        class: cls,
        code: err instanceof TradovateClientError ? err.code : "unknown",
        status: err instanceof TradovateClientError ? err.statusCode : undefined,
        willMarkExpired: cls === "auth_invalid",
      });
      if (cls === "auth_invalid") {
        await this.#markConnectionExpired(
          "Access token renewal was rejected by Tradovate. Re-authorize to reconnect.",
        );
        throw new TradovateClientError(
          "TOKEN_EXPIRED_NO_REFRESH",
          "Access token renewal was rejected by Tradovate.",
        );
      }
      // Transient or unknown — propagate without marking expired so the next
      // sync can retry. The sync layer's catch block records the error but
      // leaves connectionStatus untouched.
      throw err;
    }
  }

  /**
   * Lightweight renewal via GET /auth/renewAccessToken on the auth server.
   * Uses the current Bearer token — no client_secret sent.
   * Tradovate returns: { accessToken, mdAccessToken?, expirationTime? }
   *
   * NOTE: This must NOT use this.#request() — that method routes through
   * this.#baseUrl (the REST API base, e.g. live.tradovateapi.com/v1).
   * The renew endpoint lives on the auth server (live-api.tradovate.com),
   * stored in this.#renewUrl and derived from this.#tokenUrl.
   */
  async #renewViaApiEndpoint(): Promise<void> {
    const renewUrl = this.#renewUrl!;
    console.info("[tradovate/client] renewing token via renewAccessToken", {
      endpoint: renewUrl,
      method: "GET",
    });

    let res: Response;
    try {
      res = await fetch(renewUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.#accessToken}`,
          Accept: "application/json",
        },
      });
    } catch {
      throw new TradovateClientError("NETWORK_ERROR", "Network error during token renewal.");
    }

    const contentType = res.headers.get("content-type") ?? "unknown";
    console.info("[tradovate/client] renewAccessToken HTTP", {
      status: res.status,
      contentType,
    });

    if (!res.ok) {
      throw new TradovateClientError(
        "REFRESH_FAILED",
        `renewAccessToken returned HTTP ${res.status}.`,
        res.status,
      );
    }

    let raw: TvTokenResponse;
    try {
      raw = (await res.json()) as TvTokenResponse;
    } catch {
      console.warn("[tradovate/client] renewAccessToken response is not valid JSON", {
        status: res.status,
        contentType,
      });
      throw new TradovateClientError(
        "PARSE_ERROR",
        "Could not parse renewAccessToken response.",
      );
    }

    const rawKeys = Object.keys(raw as object);
    console.info("[tradovate/client] renewAccessToken response shape", {
      keys: rawKeys,
      hasAccessToken: "accessToken" in (raw as object),
      has_access_token: "access_token" in (raw as object),
      hasToken: "token" in (raw as object),
      hasMdAccessToken: "mdAccessToken" in (raw as object),
      has_md_access_token: "md_access_token" in (raw as object),
      hasExpirationTime: "expirationTime" in (raw as object),
      hasExpiresIn: "expiresIn" in (raw as object) || "expires_in" in (raw as object),
      hasErrorField: "error" in (raw as object) || "errorText" in (raw as object) || "errorCode" in (raw as object),
    });

    const tokens = normalizeTokenResponse(raw);
    if (!tokens.accessToken) {
      throw new TradovateClientError(
        "REFRESH_NO_ACCESS_TOKEN",
        "Tradovate did not return a renewed access token. Please re-authorize the connection.",
      );
    }
    await this.#storeRefreshedTokens(tokens, /* preserveRefreshToken */ true);
  }

  /**
   * Full OAuth refresh_token grant via POST to the token URL.
   * Handles both standard OAuth snake_case and Tradovate camelCase responses.
   */
  async #refreshViaOAuthGrant(): Promise<void> {
    console.info("[tradovate/client] refreshing via OAuth grant", {
      tokenEndpoint: this.#tokenUrl,
    });

    let refreshRes: Response;
    try {
      refreshRes = await fetch(this.#tokenUrl!, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: this.#refreshToken!,
          client_id: this.#clientId!,
          client_secret: this.#clientSecret!,
        }).toString(),
      });
    } catch {
      throw new TradovateClientError(
        "REFRESH_FAILED",
        "Network error during token refresh.",
      );
    }

    if (!refreshRes.ok) {
      // Do NOT mark connection expired here — the caller (#refreshIfExpired)
      // classifies the error and marks expired only when it's auth_invalid.
      // Status 5xx/429 must not burn the connection.
      throw new TradovateClientError(
        "REFRESH_FAILED",
        `Token refresh rejected (HTTP ${refreshRes.status}).`,
        refreshRes.status,
      );
    }

    const contentType = refreshRes.headers.get("content-type") ?? "unknown";
    console.info("[tradovate/client] OAuth refresh HTTP", {
      status: refreshRes.status,
      contentType,
    });

    let raw: TvTokenResponse;
    try {
      raw = (await refreshRes.json()) as TvTokenResponse;
    } catch {
      console.warn("[tradovate/client] OAuth refresh response is not valid JSON", {
        status: refreshRes.status,
        contentType,
      });
      throw new TradovateClientError(
        "PARSE_ERROR",
        "Could not parse token refresh response.",
      );
    }

    console.info("[tradovate/client] OAuth refresh response shape", {
      keys: Object.keys(raw as object),
      hasAccessToken: "accessToken" in (raw as object),
      has_access_token: "access_token" in (raw as object),
      hasToken: "token" in (raw as object),
      hasRefreshToken: "refreshToken" in (raw as object) || "refresh_token" in (raw as object),
      hasExpiresIn: "expiresIn" in (raw as object) || "expires_in" in (raw as object),
      hasErrorField: "error" in (raw as object) || "errorText" in (raw as object) || "errorCode" in (raw as object),
    });

    const tokens = normalizeTokenResponse(raw);
    if (!tokens.accessToken) {
      throw new TradovateClientError(
        "REFRESH_NO_ACCESS_TOKEN",
        "Tradovate did not return a renewed access token. Please re-authorize the connection.",
      );
    }

    // When the OAuth endpoint returns no new refresh token, preserve the
    // existing one — never overwrite a working refresh token with null.
    await this.#storeRefreshedTokens(
      tokens,
      /* preserveRefreshToken */ tokens.refreshToken === null,
    );
  }

  /**
   * Encrypt and persist refreshed tokens. Only updates refreshTokenEncrypted
   * when a new refresh token was returned; set preserveRefreshToken=true to
   * leave the existing encrypted refresh token unchanged.
   */
  async #storeRefreshedTokens(
    tokens: { accessToken: string | null; refreshToken: string | null; expiresAt: Date | null },
    preserveRefreshToken: boolean,
  ): Promise<void> {
    if (!tokens.accessToken) {
      throw new TradovateClientError(
        "REFRESH_NO_ACCESS_TOKEN",
        "Cannot store tokens: no access token provided.",
      );
    }
    try {
      const encryptedAccess = encryptAndSerialize(tokens.accessToken);

      if (this.#brokerConnectionId) {
        // BrokerConnection-backed account — update the shared token row so
        // all accounts linked to this connection pick up the new token.
        const bcData: Parameters<typeof prisma.brokerConnection.update>[0]["data"] = {
          accessTokenEncrypted: encryptedAccess,
          tokenExpiresAt: tokens.expiresAt,
          connectionStatus: "connected_readonly",
          errorMessage: null,
        };
        if (!preserveRefreshToken && tokens.refreshToken) {
          bcData.refreshTokenEncrypted = encryptAndSerialize(tokens.refreshToken);
        }
        await prisma.brokerConnection.update({
          where: { id: this.#brokerConnectionId },
          data: bcData,
        });
      } else {
        // Legacy per-account token columns.
        const data: Parameters<typeof prisma.connectedAccount.update>[0]["data"] = {
          accessTokenEncrypted: encryptedAccess,
          tokenExpiresAt: tokens.expiresAt,
          connectionStatus: "connected_readonly",
          errorMessage: null,
        };
        if (!preserveRefreshToken && tokens.refreshToken) {
          data.refreshTokenEncrypted = encryptAndSerialize(tokens.refreshToken);
        }
        await prisma.connectedAccount.update({
          where: { id: this.#accountId },
          data,
        });
      }

      this.#accessToken = tokens.accessToken;
      if (!preserveRefreshToken && tokens.refreshToken) {
        this.#refreshToken = tokens.refreshToken;
      }
      this.#tokenExpiresAt = tokens.expiresAt;

      console.info("[tradovate/client] token store succeeded", { storeSucceeded: true });
    } catch (err) {
      const errorName = err instanceof Error ? err.name : "unknown";
      console.error("[tradovate/client] token store failed", {
        errorName,
        storeSucceeded: false,
      });
      throw new TradovateClientError(
        "REFRESH_STORE_FAILED",
        "Tokens refreshed but could not be stored.",
      );
    }
  }

  async #request<T>(
    path: string,
    method: "GET" | "POST" = "GET",
    body?: unknown,
    /** Internal: true when the call is the post-renewal retry (prevents loops). */
    retriedAfterRenewal = false,
    /**
     * When true, a persistent 401 (after renewal succeeds) does NOT mark the
     * connection expired. Used for optional trade-count endpoints (order/deps,
     * fillPair/deps, fill/deps) whose 401 means "OAuth scope can't access this
     * endpoint" rather than "credentials are globally broken".
     */
    skipMarkExpired = false,
  ): Promise<T> {
    if (!this.#accessToken || !this.#baseUrl) {
      throw new TradovateClientError(
        "NO_TOKENS",
        "Client not initialized — call initialize() first.",
      );
    }

    const url = `${this.#baseUrl}/${path.replace(/^\//, "")}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.#accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
    } catch {
      throw new TradovateClientError("NETWORK_ERROR", `Network error on ${path}.`);
    }

    if (res.status === 401) {
      // First 401 in this request: try one in-place renewal then retry once.
      // Only mark the connection expired when the renewal itself fails with
      // an auth_invalid error — never on the bare 401, which can happen if
      // the token expired between #refreshIfExpired and the actual fetch.
      if (!retriedAfterRenewal) {
        console.info("[tradovate/auth] received 401 — attempting in-place renewal + retry", {
          accountId: this.#accountId,
          path,
          skipMarkExpired,
        });
        try {
          await this.#renewTokenNow();
        } catch (renewErr) {
          const cls = this.#classifyError(renewErr);
          if (cls === "auth_invalid") {
            await this.#markConnectionExpired(
              "Tradovate rejected token renewal after a 401 response. Re-authorize to reconnect.",
            );
            throw new TradovateClientError(
              "API_ERROR",
              `Tradovate API ${path} returned 401 and renewal was rejected.`,
              401,
            );
          }
          // Transient renewal failure — surface without marking expired.
          throw renewErr;
        }
        return this.#request<T>(path, method, body, /* retriedAfterRenewal */ true, skipMarkExpired);
      }
      // Already tried renewal and got 401 again.
      // For core endpoints this means the credential is invalid — mark expired.
      // For optional endpoints (skipMarkExpired=true) a persistent 401 means
      // "this OAuth scope can't access this endpoint", not a global auth failure.
      if (!skipMarkExpired) {
        await this.#markConnectionExpired(
          "Tradovate returned 401 after a successful token renewal. Re-authorize to reconnect.",
        );
      }
      throw new TradovateClientError(
        "API_ERROR",
        `Tradovate API ${path} returned 401 after renewal retry.`,
        401,
      );
    }

    if (!res.ok) {
      throw new TradovateClientError(
        "API_ERROR",
        `Tradovate API ${path} returned HTTP ${res.status}.`,
        res.status,
      );
    }

    try {
      return (await res.json()) as T;
    } catch {
      throw new TradovateClientError(
        "PARSE_ERROR",
        `Could not parse response from ${path}.`,
      );
    }
  }

  // ── Public read methods ───────────────────────────────────────────────────
  // Each method corresponds to one Tradovate endpoint. Call initialize() first.

  /** List all Tradovate accounts linked to the OAuth token. */
  getAccounts(): Promise<TvAccount[]> {
    return this.#request<TvAccount[]>("account/list");
  }

  /**
   * Primary balance source: POST cashBalance/getCashBalanceSnapshot.
   *
   * Tradovate may return a bare array, a single object, or a wrapper envelope.
   * parseSnapshotItems() normalises all shapes to an array before we pick the
   * first item. Logs the raw response shape and per-candidate field types so
   * server logs tell us exactly what Tradovate sent.
   */
  async getCashBalanceSnapshot(
    tvAccountId: number,
  ): Promise<TvCashBalanceSnapshot | null> {
    const raw = await this.#request<unknown>(
      "cashBalance/getCashBalanceSnapshot",
      "POST",
      { accountId: tvAccountId },
    );

    const isRawArray = Array.isArray(raw);
    const topLevelKeys =
      !isRawArray && typeof raw === "object" && raw !== null
        ? Object.keys(raw as object)
        : null;

    const items = parseSnapshotItems<TvCashBalanceSnapshot>(raw);
    const snapshot = items[0] ?? null;

    if (snapshot) {
      const s = snapshot as Record<string, unknown>;
      const describeField = (key: string): string => {
        if (!(key in s)) return "absent";
        const v = s[key];
        if (v === null) return "null";
        if (typeof v === "number") return Number.isFinite(v) ? "number(finite)" : "number(non-finite)";
        return typeof v;
      };
      console.info("[tradovate/balance] getCashBalanceSnapshot", {
        accountId: this.#accountId,
        tvAccountId,
        rawIsArray: isRawArray,
        parsedItems: items.length,
        allKeys: Object.keys(s),
        candidates: {
          netLiq: describeField("netLiq"),
          totalCashValue: describeField("totalCashValue"),
          cashBalance: describeField("cashBalance"),
          accountBalance: describeField("accountBalance"),
          amount: describeField("amount"),
          openPl: describeField("openPl"),
        },
      });
    } else {
      console.info("[tradovate/balance] getCashBalanceSnapshot → no snapshot", {
        accountId: this.#accountId,
        tvAccountId,
        rawIsArray: isRawArray,
        topLevelKeys,
        parsedItems: items.length,
      });
    }

    return snapshot;
  }

  /**
   * Fallback balance source: GET cashBalance/list, filtered to tvAccountId.
   *
   * Called only when getCashBalanceSnapshot returns no usable balance.
   * cashBalance/list returns all cash balance records for the authenticated
   * user's accounts — we filter client-side to the target account.
   */
  async getCashBalanceFallback(
    tvAccountId: number,
  ): Promise<TvCashBalanceSnapshot | null> {
    const raw = await this.#request<unknown>("cashBalance/list");
    const items = parseSnapshotItems<TvCashBalanceSnapshot>(raw);
    const match = items.find((item) => item.accountId === tvAccountId) ?? null;

    console.info("[tradovate/balance] getCashBalanceFallback (cashBalance/list)", {
      accountId: this.#accountId,
      tvAccountId,
      rawIsArray: Array.isArray(raw),
      totalItems: items.length,
      foundMatch: match !== null,
      candidateType: match
        ? (typeof (match as Record<string, unknown>).amount === "number"
            ? "number(finite)"
            : "other")
        : "none",
    });

    return match;
  }

  /** Open positions, filtered to the stored Tradovate account ID when set. */
  async getPositions(): Promise<TvPosition[]> {
    const all = await this.#request<TvPosition[]>("position/list");
    if (this.#tvAccountId !== null) {
      return all.filter((p) => p.accountId === this.#tvAccountId);
    }
    return all;
  }

  /** Working orders, filtered to the stored Tradovate account ID when set. */
  async getOrders(): Promise<TvOrder[]> {
    const all = await this.#request<TvOrder[]>("order/list");
    const working = all.filter(
      (o) => o.ordStatus === "Working" || o.ordStatus === "Pending",
    );
    if (this.#tvAccountId !== null) {
      return working.filter((o) => o.accountId === this.#tvAccountId);
    }
    return working;
  }

  /**
   * Today's completed (fully filled) orders, filtered to this account.
   * Each completed order corresponds to one user-facing trade.
   *
   * Preferred over fill/list for trade counting because orders reliably
   * carry accountId as a direct field.
   */
  async getCompletedOrdersToday(sessionStartMs: number): Promise<TvOrder[]> {
    const raw = await this.#request<unknown>("order/list");
    const all = parseSnapshotItems<TvOrder>(raw);
    const lookbackMs = sessionStartMs;

    const recentCompleted = all.filter((o) => {
      if (o.ordStatus !== "Completed" && o.ordStatus !== "Filled") return false;
      const d = new Date(o.timestamp);
      return Number.isFinite(d.getTime()) && d.getTime() >= lookbackMs;
    });

    const filtered =
      this.#tvAccountId !== null
        ? recentCompleted.filter((o) => o.accountId === this.#tvAccountId)
        : recentCompleted;

    const allStatuses = [...new Set(all.map((o) => o.ordStatus))];
    console.info("[tradovate/orders] completed today", {
      accountId: this.#accountId,
      tvAccountId: this.#tvAccountId,
      totalOrders: all.length,
      allStatuses,
      completedRecent: recentCompleted.length,
      filteredCount: filtered.length,
    });

    return filtered;
  }

  /**
   * Today's fills, using the most permissive filters possible to avoid
   * silently dropping items when Tradovate omits account/date fields.
   *
   * Always uses `fill/list` (no account-scoping parameters exist for this
   * endpoint per the Tradovate OpenAPI spec — `fill/deps` is order-scoped,
   * not account-scoped). Client-side `fillMatchesAccount` filters by
   * accountId → accountSpec → includes-all (assumes already-scoped).
   *
   * When `fill/list` returns fills that carry no accountId/accountSpec and
   * tvAccountId is set, the verdict is recorded as `unscoped_suspect` so
   * the caller can downgrade the trade count to "estimated".
   *
   * Date filter: checks timestamp, time, tradeTime, executionTime, tradeDate
   * (object or string). When none of those fields exist, includes the fill.
   */
  async getFills(sessionStartMs: number): Promise<TvFill[]> {
    const raw = await this.#request<unknown>("fill/list");

    const all = parseSnapshotItems<TvFill>(raw);

    // Log raw item fields for the first fill (and the second if present) so
    // server logs reveal the exact field names Tradovate is returning.
    const samplesToLog = Math.min(all.length, 2);
    for (let i = 0; i < samplesToLog; i++) {
      const s = all[i] as Record<string, unknown>;
      console.info("[tradovate/fills] raw item", {
        accountId: this.#accountId,
        sampleIndex: i,
        keys: Object.keys(s),
        id: s.id,
        orderId: s.orderId,
        fillAccountId: s.accountId,
        accountSpec: s.accountSpec,
        timestamp: s.timestamp,
        tradeDate: s.tradeDate,
        time: s.time,
        action: s.action,
        side: s.side,
        qty: s.qty,
        size: s.size,
        profit: s.profit,
        pnl: s.pnl,
        realizedPnL: s.realizedPnL,
      });
    }

    const todayFills = all.filter((f) => {
      const ts = extractFillTimestamp(f as Record<string, unknown>);
      if (ts == null) return true; // no date field — include it
      const d = new Date(ts);
      if (!Number.isFinite(d.getTime())) return true; // unparseable — include it
      return d.getTime() >= sessionStartMs;
    });

    const filtered =
      this.#tvAccountId !== null
        ? todayFills.filter((f) =>
            fillMatchesAccount(f as Record<string, unknown>, this.#tvAccountId!),
          )
        : todayFills;

    // Detect the silent-mixing case: tvAccountId is set and none of the fills
    // carry account identifiers — the client-side filter passes everything
    // through and we can't trust the count for a multi-account token.
    const fillsCarryAccountIds = todayFills.some((f) =>
      fillCarriesAccountId(f as Record<string, unknown>),
    );
    const accountScopingSuspect = isAccountScopingSuspect({
      tvAccountId: this.#tvAccountId,
      fills: todayFills as ReadonlyArray<Record<string, unknown>>,
    });

    this.#lastFillsScopingVerdict = accountScopingSuspect ? "unscoped_suspect" : "field_scoped";

    if (accountScopingSuspect) {
      console.warn("[tradovate/fills] account scoping suspect — fill/list returned items without accountId/accountSpec", {
        accountId: this.#accountId,
        tvAccountId: this.#tvAccountId,
        todayCount: todayFills.length,
        note: "Trade count may include fills from other accounts on the same OAuth token.",
      });
    }

    console.info("[tradovate/fills] summary", {
      accountId: this.#accountId,
      tvAccountId: this.#tvAccountId,
      endpoint: "fill/list",
      sessionStartMs,
      responseShape: Array.isArray(raw)
        ? "bare_array"
        : raw !== null && typeof raw === "object"
          ? "wrapped_object"
          : "other",
      rawCount: all.length,
      todayCount: todayFills.length,
      filteredCount: filtered.length,
      fillsCarryAccountIds,
      accountScopingSuspect,
    });

    return filtered;
  }

  /**
   * Returns the scoping verdict from the most recent getFills() call.
   * Use this to decide whether tradesCount derived from those fills can be
   * treated as authoritative (`field_scoped`) or only as an estimate
   * (`unscoped_suspect`). Returns `not_loaded` before the first call.
   */
  getLastFillsScopingVerdict(): FillsScopingVerdict {
    return this.#lastFillsScopingVerdict;
  }

  // ── Per-account trade count sources ──────────────────────────────────────
  // Each method below is one fallback step in the trade-count resolver
  // (see tradovate-trade-count.ts). They are deliberately defensive: never
  // throw, log enough for diagnostics, and explicitly verify whether the
  // response can be attributed to a single account before reporting trust.

  /**
   * Look up the Tradovate account name (used as the `account` param when
   * requesting the Performance Report). Resolves from /account/list — the
   * stored externalAccountId is `account.id`, but the report wants
   * `account.name`. Returns null if it can't be resolved.
   */
  async getAccountName(): Promise<string | null> {
    if (this.#tvAccountId === null) return null;
    try {
      const accounts = await this.getAccounts();
      const match = accounts.find((a) => a.id === this.#tvAccountId);
      const name = match?.nickname ?? match?.name ?? null;
      console.info("[tradovate/trade-count] account name lookup", {
        accountId: this.#accountId,
        tvAccountId: this.#tvAccountId,
        found: name != null,
      });
      return typeof name === "string" && name.length > 0 ? name : null;
    } catch (err) {
      console.warn("[tradovate/trade-count] account name lookup failed", {
        accountId: this.#accountId,
        error: err instanceof Error ? err.message : "unknown",
      });
      return null;
    }
  }

  /**
   * POST to the Performance Report endpoint and return the raw response body
   * + content type for the parser. Returns null on network/config failure or
   * when the reports base URL isn't configured.
   *
   * Uses the existing OAuth bearer token; the reports host may reject it
   * with 401/403 for some account types — that's expected and the resolver
   * will fall through to the next source.
   */
  async fetchPerformanceReport(input: {
    accountName: string;
    tradingDayKey: string;
  }): Promise<{ status: number; body: string; contentType: string | null } | null> {
    if (!this.#reportsBaseUrl || !this.#accessToken) return null;
    // CME Globex sessions run 17:00 CT → 17:00 CT the next calendar day.
    // Using the full calendar day (00:00–23:59) on the session key date would
    // include the morning hours (00:00–16:59 CT) that belong to the PREVIOUS
    // CME session, inflating the count by carryover trades. Scope the report
    // to [startDate 17:00:00, endDate 16:59:59] to match the actual session.
    const startDateStr = formatDateMMDDYYYY(input.tradingDayKey);
    const endDateStr = formatDateMMDDYYYY(nextCalendarDay(input.tradingDayKey));
    const url = `${this.#reportsBaseUrl}/reports/requestreport`;
    const body = {
      name: "Performance",
      params: [
        { name: "startDate", value: startDateStr },
        { name: "endDate", value: endDateStr },
        { name: "startTime", value: "17:00:00" },
        { name: "endTime", value: "16:59:59" },
        { name: "account", value: input.accountName },
      ],
      representationType: "html",
      template: "Flex.html",
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#accessToken}`,
          "Content-Type": "application/json",
          Accept: "text/html, application/json, text/csv, */*;q=0.5",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      console.warn("[tradovate/trade-count] reports fetch network error", {
        accountId: this.#accountId,
        url,
        error: err instanceof Error ? err.message : "unknown",
      });
      return null;
    }

    const contentType = res.headers.get("content-type");
    let text = "";
    try {
      text = await res.text();
    } catch {
      // Treat as empty body — the parser will return null.
    }

    console.info("[tradovate/trade-count] reports response", {
      accountId: this.#accountId,
      tvAccountId: this.#tvAccountId,
      url,
      status: res.status,
      contentType,
      bodyLength: text.length,
    });

    return { status: res.status, body: text, contentType };
  }

  /**
   * GET /order/deps?masterid={tvAccountId} for today's completed/filled
   * orders. The /deps endpoint is account-scoped at the Tradovate API
   * level. We additionally verify that every kept order carries
   * accountId === this.#tvAccountId before reporting accountScopedAtApi.
   */
  async fetchAccountScopedOrders(sessionStartMs: number): Promise<{
    count: number;
    accountScopedAtApi: boolean;
    httpStatus?: number;
    endpoint: string;
  } | null> {
    if (this.#tvAccountId === null) return null;
    const endpoint = `order/deps?masterid=${this.#tvAccountId}`;
    let raw: unknown;
    try {
      raw = await this.#request<unknown>(endpoint, "GET", undefined, false, /* skipMarkExpired */ true);
    } catch (err) {
      const status =
        err instanceof TradovateClientError ? err.statusCode : undefined;
      console.warn("[tradovate/trade-count] order/deps failed", {
        accountId: this.#accountId,
        tvAccountId: this.#tvAccountId,
        status,
      });
      return { count: 0, accountScopedAtApi: false, httpStatus: status, endpoint };
    }

    const all = parseSnapshotItems<{ accountId?: number; ordStatus?: string; timestamp?: string }>(raw);
    const completed = all.filter((o) => {
      const status = o.ordStatus;
      if (status !== "Completed" && status !== "Filled") return false;
      if (!o.timestamp) return true;
      const t = new Date(o.timestamp).getTime();
      return Number.isFinite(t) && t >= sessionStartMs;
    });
    const allHaveAccountId = completed.every((o) => o.accountId === this.#tvAccountId);

    console.info("[tradovate/trade-count] order/deps result", {
      accountId: this.#accountId,
      tvAccountId: this.#tvAccountId,
      total: all.length,
      completedToday: completed.length,
      allRowsCarryMatchingAccountId: allHaveAccountId,
    });

    return {
      count: completed.length,
      // Only trust the count when EVERY row was tagged with the right account
      // (otherwise the /deps endpoint may have been order-scoped, not account-scoped).
      accountScopedAtApi: completed.length > 0 && allHaveAccountId,
      endpoint,
    };
  }

  /**
   * Resolve Tradovate contractIds to symbol names (e.g. "ESM5").
   * Best-effort — falls back silently on failure so callers receive
   * contractId.toString() as the symbol.
   */
  async resolveContracts(ids: number[]): Promise<Map<number, string>> {
    const map = new Map<number, string>();
    if (ids.length === 0) return map;
    try {
      const contracts = await this.#request<TvContract[]>(
        "contract/items",
        "POST",
        ids,
      );
      for (const c of contracts) map.set(c.id, c.name);
    } catch {
      // Contract resolution is best-effort; callers fall back to contractId.
    }
    return map;
  }

  // ── Account risk / auto-liquidation ──────────────────────────────────────

  /**
   * Fetch userAccountAutoLiq rules for this account.
   * Tradovate uses /deps?masterid={tvAccountId} to scope rules to an account.
   *
   * Endpoint: GET userAccountAutoLiq/deps?masterid={tvAccountId}
   */
  async getUserAccountAutoLiq(): Promise<TvUserAccountAutoLiq[]> {
    if (this.#tvAccountId === null) {
      throw new TradovateClientError(
        "NO_ACCOUNT_ID",
        "Tradovate account ID not resolved — call initialize() and ensure externalAccountId is set.",
      );
    }
    // skipMarkExpired=true: a 401 here means the OAuth token lacks Account Risk
    // Settings read access, not that the connection credentials are globally
    // broken. Do not expire the connection for a scope gap on this endpoint.
    const raw = await this.#request<unknown>(
      `userAccountAutoLiq/deps?masterid=${this.#tvAccountId}`,
      "GET",
      undefined,
      false,
      /* skipMarkExpired */ true,
    );
    return parseSnapshotItems<TvUserAccountAutoLiq>(raw);
  }

  /**
   * Apply a broker-side daily loss lock by setting the userAccountAutoLiq
   * dailyLossAutoLiq threshold to lossAmountToSet (dollars already lost).
   *
   * When the threshold is at or below the current daily loss, Tradovate's
   * risk engine immediately places the account into liquidation-only mode and
   * blocks new opening orders for the rest of the trading session.
   *
   * Sets changesLocked=true to prevent the setting from being modified until
   * the next trading session.
   *
   * Endpoints used:
   *   GET  userAccountAutoLiq/deps?masterid={tvAccountId}  (check for existing record)
   *   POST userAccountAutoLiq/update  (if record exists)
   *   POST userAccountAutoLiq/create  (if no record exists)
   *
   * Returns the endpoint used, exact payload sent, and raw response received
   * so callers can log all three for audit purposes.
   */
  async applyDailyLossLock(params: {
    lossAmountToSet: number;
    changesLocked?: boolean;
  }): Promise<AutoLiqLockResult> {
    if (this.#tvAccountId === null) {
      throw new TradovateClientError(
        "NO_ACCOUNT_ID",
        "Tradovate account ID not resolved — call initialize() and ensure externalAccountId is set.",
      );
    }

    const existing = await this.getUserAccountAutoLiq();
    const record = existing[0] ?? null;

    let endpoint: string;
    let payload: Record<string, unknown>;

    if (record?.id != null) {
      endpoint = "userAccountAutoLiq/update";
      payload = {
        id: record.id,
        dailyLossAutoLiq: params.lossAmountToSet,
        changesLocked: params.changesLocked ?? true,
      };
    } else {
      endpoint = "userAccountAutoLiq/create";
      payload = {
        accountId: this.#tvAccountId,
        dailyLossAutoLiq: params.lossAmountToSet,
        changesLocked: params.changesLocked ?? true,
      };
    }

    console.info("[tradovate/autoLiq] applying daily loss lock", {
      accountId: this.#accountId,
      tvAccountId: this.#tvAccountId,
      endpoint,
      lossAmountToSet: params.lossAmountToSet,
      existingRecordId: record?.id ?? null,
    });

    // skipMarkExpired=true: a 403 here means "Account Risk Settings: Full Access"
    // is missing from the OAuth scope — a capability limit, not a global auth
    // failure. A 401 post-renewal is also scope-specific. Neither should expire
    // the connection, which remains usable for read-only operations.
    const response = await this.#request<TvUserAccountAutoLiq>(
      endpoint,
      "POST",
      payload,
      false,
      /* skipMarkExpired */ true,
    );

    console.info("[tradovate/autoLiq] daily loss lock response", {
      accountId: this.#accountId,
      endpoint,
      responseKeys: response != null && typeof response === "object" ? Object.keys(response as object) : [],
    });

    // Verify that Tradovate stored the value we sent by checking the response
    // body first, then falling back to a read-back GET if the response doesn't
    // echo the field.
    const responseValue = response?.dailyLossAutoLiq ?? null;
    let confirmed = isAutoLiqConfirmed({
      expectedValue: params.lossAmountToSet,
      responseValue,
    });
    let readbackValue: number | null = responseValue;

    if (!confirmed) {
      // Response didn't confirm — do a read-back GET to verify the stored value.
      try {
        const readback = await this.getUserAccountAutoLiq();
        const readbackRecord = readback[0] ?? null;
        readbackValue = readbackRecord?.dailyLossAutoLiq ?? null;
        confirmed = isAutoLiqConfirmed({
          expectedValue: params.lossAmountToSet,
          responseValue: readbackValue,
        });
        console.info("[tradovate/autoLiq] read-back result", {
          accountId: this.#accountId,
          readbackValue,
          confirmed,
        });
      } catch (readbackErr) {
        console.warn("[tradovate/autoLiq] read-back GET failed", {
          accountId: this.#accountId,
          error: readbackErr instanceof Error ? readbackErr.message : String(readbackErr),
        });
      }
    }

    return { endpoint, payload, response, confirmed, readbackValue };
  }

  /**
   * Apply a broker-side daily profit target lock by setting the
   * userAccountAutoLiq dailyProfitAutoLiq threshold to profitAmountToSet
   * (dollars already earned today).
   *
   * When the threshold is at or below the account's current realized profit,
   * Tradovate's risk engine immediately places the account into
   * liquidation-only mode and blocks new opening orders for the rest of the
   * trading session.
   *
   * Sets changesLocked=true to prevent the setting from being modified until
   * the next trading session.
   *
   * Endpoints used:
   *   GET  userAccountAutoLiq/deps?masterid={tvAccountId}  (check for existing record)
   *   POST userAccountAutoLiq/update  (if record exists)
   *   POST userAccountAutoLiq/create  (if no record exists)
   */
  async applyProfitTargetLock(params: {
    profitAmountToSet: number;
    changesLocked?: boolean;
  }): Promise<AutoLiqLockResult> {
    if (this.#tvAccountId === null) {
      throw new TradovateClientError(
        "NO_ACCOUNT_ID",
        "Tradovate account ID not resolved — call initialize() and ensure externalAccountId is set.",
      );
    }

    const existing = await this.getUserAccountAutoLiq();
    const record = existing[0] ?? null;

    let endpoint: string;
    let payload: Record<string, unknown>;

    if (record?.id != null) {
      endpoint = "userAccountAutoLiq/update";
      payload = {
        id: record.id,
        dailyProfitAutoLiq: params.profitAmountToSet,
        changesLocked: params.changesLocked ?? true,
      };
    } else {
      endpoint = "userAccountAutoLiq/create";
      payload = {
        accountId: this.#tvAccountId,
        dailyProfitAutoLiq: params.profitAmountToSet,
        changesLocked: params.changesLocked ?? true,
      };
    }

    console.info("[tradovate/autoLiq] applying profit target lock", {
      accountId: this.#accountId,
      tvAccountId: this.#tvAccountId,
      endpoint,
      profitAmountToSet: params.profitAmountToSet,
      existingRecordId: record?.id ?? null,
    });

    // skipMarkExpired=true: see applyDailyLossLock for rationale.
    const response = await this.#request<TvUserAccountAutoLiq>(
      endpoint,
      "POST",
      payload,
      false,
      /* skipMarkExpired */ true,
    );

    console.info("[tradovate/autoLiq] profit target lock response", {
      accountId: this.#accountId,
      endpoint,
      responseKeys: response != null && typeof response === "object" ? Object.keys(response as object) : [],
    });

    const responseValue = response?.dailyProfitAutoLiq ?? null;
    let confirmed = isAutoLiqConfirmed({
      expectedValue: params.profitAmountToSet,
      responseValue,
    });
    let readbackValue: number | null = responseValue;

    if (!confirmed) {
      try {
        const readback = await this.getUserAccountAutoLiq();
        const readbackRecord = readback[0] ?? null;
        readbackValue = readbackRecord?.dailyProfitAutoLiq ?? null;
        confirmed = isAutoLiqConfirmed({
          expectedValue: params.profitAmountToSet,
          responseValue: readbackValue,
        });
        console.info("[tradovate/autoLiq] profit lock read-back result", {
          accountId: this.#accountId,
          readbackValue,
          confirmed,
        });
      } catch (readbackErr) {
        console.warn("[tradovate/autoLiq] profit lock read-back GET failed", {
          accountId: this.#accountId,
          error: readbackErr instanceof Error ? readbackErr.message : String(readbackErr),
        });
      }
    }

    return { endpoint, payload, response, confirmed, readbackValue };
  }

  /**
   * Cancel a single open order by Tradovate order ID.
   *
   * POST /order/cancelorder with { orderId }
   *
   * skipMarkExpired=true: a 403 here means Orders: Full Access is missing from
   * the OAuth scope — a capability limit, not a global auth failure. The
   * connection must NOT be marked expired.
   *
   * Returns the raw Tradovate response. Callers should check for errorText to
   * detect rejection (e.g. order already filled/cancelled).
   */
  async cancelOrder(orderId: number): Promise<{ ok?: boolean; errorText?: string }> {
    console.info("[tradovate/cancel] sending cancelorder", {
      accountId: this.#accountId,
      orderId,
    });
    const response = await this.#request<{ ok?: boolean; errorText?: string }>(
      "order/cancelorder",
      "POST",
      { orderId },
      false,
      /* skipMarkExpired */ true,
    );
    console.info("[tradovate/cancel] cancelorder response", {
      accountId: this.#accountId,
      orderId,
      ok: response?.ok,
      errorText: response?.errorText ?? null,
    });
    return response ?? {};
  }

  /**
   * Attempt to flatten (close) all open positions for this Tradovate account.
   *
   * Sequences:
   *   Step 1 (read):    GET  position/deps?masterid={tvAccountId}  — account-scoped
   *   Step 2 (write):   POST order/liquidatepositions              — if open positions exist
   *   Step 3 (confirm): GET  position/deps?masterid={tvAccountId}  — read-back
   *
   * Returns:
   *   not_needed   — no open positions found; no write endpoint called.
   *   flattened    — read-back confirmed all positions are flat (netPos === 0).
   *   attempted    — liquidatepositions accepted but read-back still shows open
   *                  positions (order may still be working in the market).
   *   failed       — request or read-back threw unexpectedly.
   *
   * skipMarkExpired=true for the write call: a 403 here means Orders: Full
   * Access is missing from the OAuth scope — a capability limit, not a global
   * auth failure. The connection must NOT be marked expired.
   *
   * ⚠ LIVE QA REQUIRED: order/liquidatepositions behavior must be validated on
   *   a Tradovate demo/sim account before treating this as fully confirmed.
   */
  async applyFlattenOpenPositions(): Promise<BrokerFlattenResult> {
    if (this.#tvAccountId === null) {
      throw new TradovateClientError(
        "NO_ACCOUNT_ID",
        "Tradovate account ID not resolved — call initialize() and ensure externalAccountId is set.",
      );
    }
    const tvAccountId = this.#tvAccountId;

    // Step 1: account-scoped position read
    const allPositions = await this.#request<TvPosition[]>(
      `position/deps?masterid=${tvAccountId}`,
    );
    const openPositions = (Array.isArray(allPositions) ? allPositions : []).filter(
      (p) => p.netPos !== null && p.netPos !== 0,
    );

    if (openPositions.length === 0) {
      console.info("[tradovate/flatten] no open positions — flatten not needed", {
        accountId: this.#accountId,
        tvAccountId,
      });
      return {
        flattenStatus: "not_needed",
        flattenMessage: "No open position found — no flatten required.",
        flattenPayload: null,
        flattenResponse: null,
      };
    }

    const positionIds = openPositions.map((p) => p.id);
    const payload = buildLiquidatePositionsPayload(positionIds);

    console.info("[tradovate/flatten] applying flatten", {
      accountId: this.#accountId,
      tvAccountId,
      positionCount: openPositions.length,
      positionIds,
    });

    // Step 2: send liquidatepositions
    const response = await this.#request<{ ok?: boolean; errorText?: string }>(
      "order/liquidatepositions",
      "POST",
      payload,
      false,
      /* skipMarkExpired */ true,
    );

    console.info("[tradovate/flatten] liquidatepositions response", {
      accountId: this.#accountId,
      ok: response?.ok,
      errorText: response?.errorText ?? null,
    });

    // Step 3: read-back to confirm positions are flat
    let flattenStatus: FlattenStatus = "attempted";
    let flattenMessage =
      `Flatten sent for ${openPositions.length} position(s). ` +
      "Read-back confirmation pending (order may still be working).";

    try {
      const readback = await this.#request<TvPosition[]>(
        `position/deps?masterid=${tvAccountId}`,
      );
      const readbackPositions = Array.isArray(readback) ? readback : [];
      const confirmed = isFlattenConfirmed(readbackPositions);

      if (confirmed) {
        flattenStatus = "flattened";
        flattenMessage =
          `Position exit confirmed: ${openPositions.length} position(s) flattened. ` +
          "Read-back shows all positions flat (netPos === 0).";
      } else {
        const stillOpen = readbackPositions.filter((p) => p.netPos !== null && p.netPos !== 0);
        flattenMessage =
          `Flatten sent but ${stillOpen.length} position(s) may still be open. ` +
          "Order may still be working in the market.";
      }

      console.info("[tradovate/flatten] read-back result", {
        accountId: this.#accountId,
        originalPositions: openPositions.length,
        flattenStatus,
      });
    } catch (readbackErr) {
      console.warn("[tradovate/flatten] read-back failed", {
        accountId: this.#accountId,
        error: readbackErr instanceof Error ? readbackErr.message : String(readbackErr),
      });
    }

    return { flattenStatus, flattenMessage, flattenPayload: payload, flattenResponse: response };
  }

  // ── Normalized outputs (BrokerAdapter shapes) ────────────────────────────

  /**
   * Lightweight connection probe. Returns "connected" only if the API
   * responds to /account/list successfully.
   */
  async probeConnection(): Promise<BrokerConnectionStatus> {
    try {
      await this.getAccounts();
      return "connected";
    } catch (err) {
      if (
        err instanceof TradovateClientError &&
        (err.statusCode === 401 || err.code === "TOKEN_EXPIRED_NO_REFRESH")
      ) {
        return "expired";
      }
      return "error";
    }
  }

  /**
   * Full account snapshot. Resolves the Tradovate account ID from
   * /account/list if not already stored, and saves it back to the DB.
   */
  async toAccountSnapshot(): Promise<BrokerAccountSnapshot> {
    if (this.#tvAccountId === null) {
      const accounts = await this.getAccounts();
      const first = accounts.find((a) => a.active) ?? accounts[0];
      if (!first) {
        throw new TradovateClientError(
          "API_ERROR",
          "No Tradovate accounts found for this token.",
        );
      }
      this.#tvAccountId = first.id;
      await prisma.connectedAccount.update({
        where: { id: this.#accountId },
        data: { externalAccountId: String(first.id) },
      });
    }

    // ── Balance: primary endpoint → fallback ──────────────────────────────
    const balanceSnapshot = await this.getCashBalanceSnapshot(this.#tvAccountId);
    let balanceEndpoint = "cashBalance/getCashBalanceSnapshot";

    let balance: number | null = null;
    let openPnlFromSnapshot: number | null = null;
    let todayPnL: number | null = null;

    if (balanceSnapshot) {
      const extracted = computeSnapshotBalance(balanceSnapshot);
      balance = extracted.balance;
      todayPnL = extracted.todayPnL;
      openPnlFromSnapshot = balanceSnapshot.openPl ?? null;
      console.info("[tradovate/balance] candidates", {
        accountId: this.#accountId,
        endpoint: balanceEndpoint,
        keys: Object.keys(balanceSnapshot).join(","),
        netLiq: balanceSnapshot.netLiq ?? null,
        totalCashValue: balanceSnapshot.totalCashValue ?? null,
        cashBalance: balanceSnapshot.cashBalance ?? null,
        accountBalance: balanceSnapshot.accountBalance ?? null,
        amount: balanceSnapshot.amount ?? null,
        realizedPnL: balanceSnapshot.realizedPnL ?? null,
        realizedPnl: balanceSnapshot.realizedPnl ?? null,
        openPl: openPnlFromSnapshot,
      });
      console.info("[tradovate/balance] selected", {
        accountId: this.#accountId,
        endpoint: balanceEndpoint,
        field: extracted.field ?? "none",
        value: balance,
        todayPnL,
      });
    }

    // If primary returned no usable balance, try cashBalance/list fallback.
    if (balance == null) {
      try {
        const fallback = await this.getCashBalanceFallback(this.#tvAccountId);
        if (fallback) {
          const extracted = computeSnapshotBalance(fallback);
          if (extracted.balance != null) {
            balance = extracted.balance;
            balanceEndpoint = "cashBalance/list";
            openPnlFromSnapshot = fallback.openPl ?? null;
            if (todayPnL == null) todayPnL = extracted.todayPnL;
            console.info("[tradovate/balance] selected (fallback)", {
              accountId: this.#accountId,
              endpoint: balanceEndpoint,
              field: extracted.field ?? "none",
              gotValue: true,
            });
          }
        }
      } catch {
        // Fallback is best-effort; primary failure already logged.
      }
    }

    if (balance == null) {
      console.warn("[tradovate/balance] no usable balance from any endpoint", {
        accountId: this.#accountId,
        tvAccountId: this.#tvAccountId,
      });
    }

    return {
      accountId: this.#accountId,
      label: String(this.#tvAccountId),
      currency: "USD",
      balance,
      equity: null,
      todayPnL,
      openPnlFromSnapshot,
      asOf: new Date(),
    };
  }

  async toPositions(): Promise<BrokerPosition[]> {
    const positions = await this.getPositions();
    const ids = [...new Set(positions.map((p) => p.contractId))];
    const contractMap = await this.resolveContracts(ids);

    return positions
      .filter((p) => p.netPos !== null && p.netPos !== 0)
      .map((p): BrokerPosition => {
        const qty = p.netPos ?? 0;
        return {
          positionId: String(p.id),
          symbol: contractMap.get(p.contractId) ?? String(p.contractId),
          side: qty > 0 ? "LONG" : "SHORT",
          quantity: Math.abs(qty),
          averagePrice: p.tradePrice ?? null,
          unrealizedPnL: p.openPl ?? null,
          asOf: new Date(p.timestamp),
        };
      });
  }

  async toOrders(): Promise<BrokerOrder[]> {
    const orders = await this.getOrders();
    const ids = [...new Set(orders.map((o) => o.contractId))];
    const contractMap = await this.resolveContracts(ids);

    return orders.map(
      (o): BrokerOrder => ({
        orderId: String(o.id),
        symbol: contractMap.get(o.contractId) ?? String(o.contractId),
        side: mapSide(o.action),
        quantity: o.qty,
        status: mapOrderStatus(o.ordStatus),
        type: mapOrderType(o.ordType),
        limitPrice: o.price ?? null,
        stopPrice: o.stopPrice ?? null,
        placedAt: new Date(o.timestamp),
      }),
    );
  }

  async toExecutions(sessionStartMs: number): Promise<BrokerExecution[]> {
    const fills = await this.getFills(sessionStartMs);
    const ids = [...new Set(fills.map((f) => f.contractId))];
    const contractMap = await this.resolveContracts(ids);

    return fills
      .map((f): BrokerExecution | null => {
        const action = f.action ?? f.side;
        if (!action) return null; // skip fills with no side info
        const qty = f.qty ?? f.size;
        if (qty == null) return null;
        const price = f.price;
        if (price == null) return null;
        const ts = f.timestamp ?? f.time ?? f.tradeTime;
        return {
          executionId: String(f.id),
          orderId: String(f.orderId),
          symbol: contractMap.get(f.contractId) ?? String(f.contractId),
          contractId: f.contractId,
          side: mapSide(action),
          quantity: qty,
          price,
          pnl: f.profit ?? f.pnl ?? f.realizedPnL ?? f.realizedPnl ?? null,
          occurredAt: ts ? new Date(ts) : new Date(),
        };
      })
      .filter((e): e is BrokerExecution => e !== null);
  }
}
