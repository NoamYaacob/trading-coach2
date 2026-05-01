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
  mapOrderStatus,
  mapOrderType,
  mapSide,
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
  amount: number;
  realizedPnl: number | null;
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
  timestamp: string;
  action: "Buy" | "Sell";
  qty: number;
  price: number;
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
  #baseUrl: string | null = null;
  #tokenUrl: string | null = null;
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
      select: { accountType: true, externalAccountId: true },
    });
    if (!account) {
      throw new TradovateClientError("NO_TOKENS", "ConnectedAccount not found.");
    }

    const env = account.accountType === "demo" ? "demo" : "live";
    this.#baseUrl = config.apiBaseUrl[env];
    this.#tokenUrl = config.tokenUrl[env];
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

    await this.#refreshIfExpired();
  }

  async #refreshIfExpired(): Promise<void> {
    if (!this.#tokenExpiresAt) return;

    const remaining = this.#tokenExpiresAt.getTime() - Date.now();
    if (remaining > REFRESH_BUFFER_MS) return;

    if (!this.#refreshToken) {
      await prisma.connectedAccount.update({
        where: { id: this.#accountId },
        data: {
          connectionStatus: "expired",
          errorMessage: "Access token expired. Re-authorize to reconnect.",
        },
      });
      throw new TradovateClientError(
        "TOKEN_EXPIRED_NO_REFRESH",
        "Access token expired and no refresh token is available.",
      );
    }

    let refreshRes: Response;
    try {
      refreshRes = await fetch(this.#tokenUrl!, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          // Intentionally not logging refresh_token value.
          refresh_token: this.#refreshToken,
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

    let refreshData: {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
    try {
      refreshData = (await refreshRes.json()) as typeof refreshData;
    } catch {
      throw new TradovateClientError(
        "PARSE_ERROR",
        "Could not parse token refresh response.",
      );
    }

    try {
      const encryptedAccess = encryptAndSerialize(refreshData.access_token);
      const encryptedRefresh = refreshData.refresh_token
        ? encryptAndSerialize(refreshData.refresh_token)
        : undefined;
      const newExpiresAt =
        typeof refreshData.expires_in === "number" && refreshData.expires_in > 0
          ? new Date(Date.now() + refreshData.expires_in * 1000)
          : null;

      await prisma.connectedAccount.update({
        where: { id: this.#accountId },
        data: {
          accessTokenEncrypted: encryptedAccess,
          ...(encryptedRefresh !== undefined && {
            refreshTokenEncrypted: encryptedRefresh,
          }),
          tokenExpiresAt: newExpiresAt,
          connectionStatus: "connected_readonly",
          errorMessage: null,
        },
      });

      this.#accessToken = refreshData.access_token;
      if (refreshData.refresh_token) {
        this.#refreshToken = refreshData.refresh_token;
      }
      this.#tokenExpiresAt = newExpiresAt;
    } catch {
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
      await prisma.connectedAccount.update({
        where: { id: this.#accountId },
        data: {
          connectionStatus: "expired",
          errorMessage: "API returned 401 — re-authorize to reconnect.",
        },
      });
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
   * Cash balance snapshot for a Tradovate account ID.
   * Returns the first entry from the list, or null if empty.
   */
  async getCashBalanceSnapshot(
    tvAccountId: number,
  ): Promise<TvCashBalanceSnapshot | null> {
    const results = await this.#request<TvCashBalanceSnapshot[]>(
      "cashBalance/getCashBalanceSnapshot",
      "POST",
      { accountId: tvAccountId },
    );
    return results[0] ?? null;
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
   * Today's fills (UTC date boundary).
   * Filtered to the stored Tradovate account ID when set.
   */
  async getFills(): Promise<TvFill[]> {
    const all = await this.#request<TvFill[]>("fill/list");
    const todayPrefix = new Date().toISOString().slice(0, 10);
    return all.filter((f) => f.timestamp.startsWith(todayPrefix));
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

    const balance = await this.getCashBalanceSnapshot(this.#tvAccountId);

    return {
      accountId: this.#accountId,
      label: String(this.#tvAccountId),
      currency: "USD",
      balance: balance?.amount ?? null,
      equity: null,
      todayPnL: balance?.realizedPnl ?? null,
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
        pnl: null,
        occurredAt: new Date(f.timestamp),
      }),
    );
  }
}
