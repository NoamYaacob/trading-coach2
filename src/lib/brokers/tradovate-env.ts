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
  authUrlLive: "https://live.tradovate.com/oauth/authorize",
  authUrlDemo: "https://demo.tradovate.com/oauth/authorize",
  tokenUrlLive: "https://live.tradovate.com/oauth/token",
  tokenUrlDemo: "https://demo.tradovate.com/oauth/token",
  apiBaseLive: "https://live.tradovateapi.com/v1",
  apiBaseDemo: "https://demo.tradovateapi.com/v1",
} as const;

export type TradovateEnv = "live" | "demo";

export type TradovateConfig = {
  clientId: string;
  clientSecret: string;
  /** Will gate token persistence until encryption is wired. */
  tokenEncryptionKey: string;
  /** Optional explicit override; otherwise derived per request. */
  redirectUriOverride: string | null;
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
      tokenEncryptionKey: tokenEncryptionKey!,
      redirectUriOverride: readEnv("TRADOVATE_REDIRECT_URI"),
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

/** Use in UI to render an "X is missing" hint. Never logs the values. */
export function getMissingTradovateKeys(): string[] {
  const status = getTradovateConfig();
  return status.state === "not_configured" ? status.missing : [];
}

export const TRADOVATE_REQUIRED_ENV_KEYS: readonly string[] = REQUIRED_KEYS;
