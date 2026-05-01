/**
 * Tradovate environment configuration.
 *
 * Centralises every env var Tradovate OAuth + read API needs. Surfaces a
 * single `getTradovateConfig()` that returns a fully-resolved config or
 * `null` plus a list of missing keys — UI and route handlers branch on
 * the result instead of spreading `process.env.X` checks across the app.
 *
 * Required env vars (see .env.example):
 *
 *   TRADOVATE_CLIENT_ID
 *     OAuth client id from the Tradovate partner portal.
 *
 *   TRADOVATE_CLIENT_SECRET
 *     OAuth client secret. Used in the token-exchange POST.
 *
 *   TRADOVATE_TOKEN_ENCRYPTION_KEY
 *     32+ char secret used to encrypt access/refresh tokens at rest.
 *     Required even before the encryption layer ships — its presence is
 *     the gate that says "we're ready to actually persist tokens." Until
 *     this is set, the OAuth flow stops before redirecting the user.
 *
 * Optional env vars (with sensible defaults):
 *
 *   TRADOVATE_REDIRECT_URI
 *     The redirect URI sent to Tradovate. Must match exactly what is
 *     registered in the Tradovate OAuth app. In production set this to:
 *       https://<your-domain>/api/auth/tradovate/callback
 *     Leave unset in local dev — routes derive it from the request origin.
 *
 *   TRADOVATE_AUTH_URL_LIVE / TRADOVATE_AUTH_URL_DEMO
 *     Override the OAuth authorize endpoint per environment.
 *
 *   TRADOVATE_TOKEN_URL_LIVE / TRADOVATE_TOKEN_URL_DEMO
 *     Override the token exchange endpoint per environment.
 *
 *   TRADOVATE_API_BASE_URL_LIVE / TRADOVATE_API_BASE_URL_DEMO
 *     Override the REST API base URL. Used by future read methods.
 */

const DEFAULTS = {
  // ── Authorization endpoints ────────────────────────────────────────────────
  // Confirmed from Tradovate's official OAuth example:
  //   https://github.com/tradovate/example-api-oauth/blob/master/index.js
  //
  // The example hardcodes:
  //   AUTH_URL     = 'https://trader-d.tradovate.com/oauth'       (demo/-d)
  //   EXCHANGE_URL = 'https://live-api-d.tradovate.com/auth/oauthtoken' (demo/-d)
  //
  // The "-d" suffix is Tradovate's demo/development indicator. Live removes it.
  // Override TRADOVATE_AUTH_URL_LIVE / _DEMO in Railway if Tradovate confirms
  // different URLs for your OAuth app registration.
  authUrlLive: "https://trader.tradovate.com/oauth",
  authUrlDemo: "https://trader-d.tradovate.com/oauth",

  // ── Token exchange endpoints ───────────────────────────────────────────────
  // Path is /auth/oauthtoken — NOT /oauth/token, NOT /v1/auth/oauthtoken.
  // Verified from the same example (live-api-d for demo; live-api for live).
  // TODO: confirm live-api.tradovate.com is reachable for your OAuth app.
  // Override TRADOVATE_TOKEN_URL_LIVE / _DEMO in Railway to adjust.
  tokenUrlLive: "https://live-api.tradovate.com/auth/oauthtoken",
  tokenUrlDemo: "https://live-api-d.tradovate.com/auth/oauthtoken",

  // ── REST API base (read pipeline — separate from OAuth) ───────────────────
  // TODO: unverified against a real account — see docs/broker-integration-plan.md.
  apiBaseLive: "https://live.tradovateapi.com/v1",
  apiBaseDemo: "https://demo.tradovateapi.com/v1",
} as const;

export type TradovateEnv = "live" | "demo";

export type TradovateConfig = {
  clientId: string;
  clientSecret: string;
  /** Separate demo-environment credentials. Null when not configured. */
  demoClientId: string | null;
  demoClientSecret: string | null;
  /** Will gate token persistence until encryption is wired. */
  tokenEncryptionKey: string;
  /** Explicit override from TRADOVATE_REDIRECT_URI; takes highest priority. */
  redirectUriOverride: string | null;
  /**
   * App origin from APP_URL / NEXT_PUBLIC_APP_URL — used as the second-tier
   * fallback when TRADOVATE_REDIRECT_URI is not set. Prevents the connect
   * route from sending localhost when Railway terminates TLS at a proxy.
   */
  appUrl: string | null;
  /** Per-env URLs (always set; falls back to hardcoded Tradovate defaults). */
  authUrl: Record<TradovateEnv, string>;
  tokenUrl: Record<TradovateEnv, string>;
  apiBaseUrl: Record<TradovateEnv, string>;
};

export type TradovateConfigStatus =
  | { state: "ready"; config: TradovateConfig }
  | { state: "not_configured"; missing: string[] };

const REQUIRED_KEYS = [
  "TRADOVATE_CLIENT_ID",
  "TRADOVATE_CLIENT_SECRET",
  "TRADOVATE_TOKEN_ENCRYPTION_KEY",
] as const;

function readEnv(name: string): string | null {
  const v = process.env[name];
  if (!v) return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Resolve the full Tradovate configuration. Returns `not_configured` with
 * the list of missing required keys when something is missing — caller is
 * responsible for surfacing that to the user.
 */
export function getTradovateConfig(): TradovateConfigStatus {
  const missing: string[] = [];
  const clientId = readEnv("TRADOVATE_CLIENT_ID");
  const clientSecret = readEnv("TRADOVATE_CLIENT_SECRET");
  const tokenEncryptionKey = readEnv("TRADOVATE_TOKEN_ENCRYPTION_KEY");

  if (!clientId) missing.push("TRADOVATE_CLIENT_ID");
  if (!clientSecret) missing.push("TRADOVATE_CLIENT_SECRET");
  if (!tokenEncryptionKey) missing.push("TRADOVATE_TOKEN_ENCRYPTION_KEY");

  if (missing.length > 0) {
    return { state: "not_configured", missing };
  }

  // After the guard above we know all required values are non-null strings.
  return {
    state: "ready",
    config: {
      clientId: clientId!,
      clientSecret: clientSecret!,
      demoClientId: readEnv("TRADOVATE_DEMO_CLIENT_ID"),
      demoClientSecret: readEnv("TRADOVATE_DEMO_CLIENT_SECRET"),
      tokenEncryptionKey: tokenEncryptionKey!,
      redirectUriOverride: readEnv("TRADOVATE_REDIRECT_URI"),
      appUrl: readEnv("APP_URL") ?? readEnv("NEXT_PUBLIC_APP_URL"),
      authUrl: {
        live: readEnv("TRADOVATE_AUTH_URL_LIVE") ?? DEFAULTS.authUrlLive,
        demo: readEnv("TRADOVATE_AUTH_URL_DEMO") ?? DEFAULTS.authUrlDemo,
      },
      tokenUrl: {
        live: readEnv("TRADOVATE_TOKEN_URL_LIVE") ?? DEFAULTS.tokenUrlLive,
        demo: readEnv("TRADOVATE_TOKEN_URL_DEMO") ?? DEFAULTS.tokenUrlDemo,
      },
      apiBaseUrl: {
        live: readEnv("TRADOVATE_API_BASE_URL_LIVE") ?? DEFAULTS.apiBaseLive,
        demo: readEnv("TRADOVATE_API_BASE_URL_DEMO") ?? DEFAULTS.apiBaseDemo,
      },
    },
  };
}

/** Lightweight check — true when every required env var is present. */
export function isTradovateConfigured(): boolean {
  return getTradovateConfig().state === "ready";
}

/** True when separate demo OAuth credentials are configured. */
export function isDemoOAuthConfigured(): boolean {
  const status = getTradovateConfig();
  if (status.state !== "ready") return false;
  return Boolean(status.config.demoClientId && status.config.demoClientSecret);
}

/** Use in UI to render an "X is missing" hint. Never logs the values. */
export function getMissingTradovateKeys(): string[] {
  const status = getTradovateConfig();
  return status.state === "not_configured" ? status.missing : [];
}

export const TRADOVATE_REQUIRED_ENV_KEYS: readonly string[] = REQUIRED_KEYS;

const CALLBACK_PATH = "/api/auth/tradovate/callback";

/**
 * Resolve the app base URL (origin only, no trailing slash) using three-tier
 * priority. Used by any redirect that must land on the app — e.g. the error
 * redirects in the OAuth callback. Works without a TradovateConfig object so
 * it is safe to call before the config check passes.
 *
 *   1. Origin extracted from TRADOVATE_REDIRECT_URI (always set in production)
 *   2. APP_URL / NEXT_PUBLIC_APP_URL (Railway production safe)
 *   3. requestUrl origin (local dev fallback — never reliable behind a proxy)
 */
export function resolveAppBaseUrl(requestUrl?: string): string {
  const explicitUri = readEnv("TRADOVATE_REDIRECT_URI");
  if (explicitUri) {
    try { return new URL(explicitUri).origin; } catch { /* fall through */ }
  }
  const appUrl = readEnv("APP_URL") ?? readEnv("NEXT_PUBLIC_APP_URL");
  if (appUrl) return appUrl.replace(/\/$/, "");
  if (requestUrl) {
    try { return new URL(requestUrl).origin; } catch { /* fall through */ }
  }
  return "";
}

/**
 * Resolve the redirect_uri to send to Tradovate, using three-tier priority:
 *
 *   1. TRADOVATE_REDIRECT_URI (explicit override — always wins)
 *   2. APP_URL / NEXT_PUBLIC_APP_URL + callback path (Railway/production safe)
 *   3. requestUrl origin + callback path (local dev fallback only)
 *
 * The third tier exists so local dev works without any extra env config, but
 * it must never be reached in production because Railway's reverse proxy can
 * expose an internal localhost origin on the request object.
 *
 * Pass `requestUrl` as the full URL string of the incoming Next.js request.
 * For UI display (no request available), omit it — the function returns the
 * best static answer it can derive from env vars alone.
 */
export function resolveRedirectUri(config: TradovateConfig, requestUrl?: string): string {
  if (config.redirectUriOverride) return config.redirectUriOverride;
  if (config.appUrl) return `${config.appUrl.replace(/\/$/, "")}${CALLBACK_PATH}`;
  if (requestUrl) return new URL(CALLBACK_PATH, requestUrl).toString();
  return CALLBACK_PATH;
}
