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
  type TvTokenResponse,
} from "./tradovate-client-helpers";

export type { TradovateClientErrorCode } from "./tradovate-client-helpers";
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
  accountId: number;
  orderId: number;
  contractId: number;
  timestamp: string;
  action: "Buy" | "Sell";
  qty: number;
  price: number;
  profit?: number | null;
  commission?: number | null;
};

type TvContract = {
  id: number;
  name: string;
};


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
  #tokenUrl: string | null = null;
  /** Auth-server renew URL — same host as #tokenUrl, different path. */
  #renewUrl: string | null = null;
  #clientId: string | null = null;
  #clientSecret: string | null = null;

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

  async #refreshIfExpired(): Promise<void> {
    if (!this.#tokenExpiresAt) return;

    const remaining = this.#tokenExpiresAt.getTime() - Date.now();
    if (remaining > REFRESH_BUFFER_MS) return;

    const tokenStillValid = remaining > 0;

    if (tokenStillValid) {
      // Token is approaching expiry but still valid.
      // Tradovate's /auth/renewAccessToken uses the current Bearer token and
      // returns a new access token without requiring the refresh_token secret.
      try {
        await this.#renewViaApiEndpoint();
        return;
      } catch {
        // Fall through to OAuth grant if we have a refresh token.
      }
    }

    if (this.#refreshToken) {
      await this.#refreshViaOAuthGrant();
      return;
    }

    if (this.#brokerConnectionId) {
      await prisma.brokerConnection.update({
        where: { id: this.#brokerConnectionId },
        data: { connectionStatus: "expired", errorMessage: "Access token expired. Re-authorize to reconnect." },
      });
    } else {
      await prisma.connectedAccount.update({
        where: { id: this.#accountId },
        data: { connectionStatus: "expired", errorMessage: "Access token expired. Re-authorize to reconnect." },
      });
    }
    throw new TradovateClientError(
      "TOKEN_EXPIRED_NO_REFRESH",
      "Access token expired and no refresh token is available.",
    );
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
      await prisma.connectedAccount.update({
        where: { id: this.#accountId },
        data: {
          connectionStatus: "expired",
          errorMessage: "Token refresh was rejected. Re-authorize to reconnect.",
        },
      });
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
      const expiredData = { connectionStatus: "expired", errorMessage: "API returned 401 — re-authorize to reconnect." };
      if (this.#brokerConnectionId) {
        await prisma.brokerConnection.update({ where: { id: this.#brokerConnectionId }, data: expiredData });
      } else {
        await prisma.connectedAccount.update({ where: { id: this.#accountId }, data: expiredData });
      }
      throw new TradovateClientError(
        "API_ERROR",
        `Tradovate API ${path} returned 401 Unauthorized.`,
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
   * Today's fills (UTC date boundary), filtered to this account's tvAccountId.
   */
  async getFills(): Promise<TvFill[]> {
    const all = await this.#request<TvFill[]>("fill/list");
    const todayPrefix = new Date().toISOString().slice(0, 10);
    const todayFills = all.filter((f) => f.timestamp.startsWith(todayPrefix));
    const filtered =
      this.#tvAccountId !== null
        ? todayFills.filter((f) => f.accountId === this.#tvAccountId)
        : todayFills;
    console.info("[tradovate/fills]", {
      accountId: this.#accountId,
      tvAccountId: this.#tvAccountId,
      datePrefix: todayPrefix,
      rawCount: all.length,
      todayCount: todayFills.length,
      filteredCount: filtered.length,
    });
    return filtered;
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
      console.info("[tradovate/balance] selected", {
        accountId: this.#accountId,
        endpoint: balanceEndpoint,
        field: extracted.field ?? "none",
        gotValue: balance != null,
      });
      console.info("[tradovate/pnl]", {
        accountId: this.#accountId,
        source: "snapshot",
        todayPnL,
        openPl: openPnlFromSnapshot,
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

  async toExecutions(): Promise<BrokerExecution[]> {
    const fills = await this.getFills();
    const ids = [...new Set(fills.map((f) => f.contractId))];
    const contractMap = await this.resolveContracts(ids);

    return fills.map(
      (f): BrokerExecution => ({
        executionId: String(f.id),
        orderId: String(f.orderId),
        symbol: contractMap.get(f.contractId) ?? String(f.contractId),
        side: mapSide(f.action),
        quantity: f.qty,
        price: f.price,
        pnl: f.profit ?? null,
        occurredAt: new Date(f.timestamp),
      }),
    );
  }
}
