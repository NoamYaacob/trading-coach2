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
 *     Override the OAuth authorize endpoint per environment. By default
 *     both point to https://trader.tradovate.com/oauth — see the "OAuth
 *     model" comment below DEFAULTS. The auth URL and token URL must
 *     remain paired (same host family); mixing them causes invalid_client
 *     because authorization codes are scoped to the env that issued them.
 *
 *   TRADOVATE_TOKEN_URL_LIVE / TRADOVATE_TOKEN_URL_DEMO
 *     Override the token exchange endpoint per environment.
 *
 *   TRADOVATE_API_BASE_URL_LIVE / TRADOVATE_API_BASE_URL_DEMO
 *     Override the REST API base URL. Used by future read methods.
 */

// ── Production OAuth setup checklist ──────────────────────────────────────────
//
// If Tradovate returns invalid_client ("client_id, redirect_uri and
// client_secret do not match existing setup"), verify all three match the
// OAuth Registration at trader.tradovate.com exactly:
//
//   Redirect URI: https://guardrail-trade.com/api/auth/tradovate/callback
//     (Railway: TRADOVATE_REDIRECT_URI must be this exact string)
//   Client ID: from the same OAuth Registration
//     (Railway: TRADOVATE_CLIENT_ID)
//   Client Secret: from the same OAuth Registration
//     (Railway: TRADOVATE_CLIENT_SECRET)
//
// All three values in the token exchange POST must match the registration.
// The redirect_uri sent during authorization and during token exchange must
// be byte-for-byte identical, including scheme, domain, and path.

// ── Tradovate authentication flows — there are TWO and they are not
//    interchangeable ─────────────────────────────────────────────────────────
//
// (1) OAuth authorization-code flow — what Guardrail uses.
//     User authorizes at trader.tradovate.com/oauth, gets ?code=...,
//     and the app exchanges it at /auth/oauthtoken with grant_type=
//     authorization_code, code, redirect_uri, client_id, client_secret in a
//     form-urlencoded body. This is the "OAuth Registration" path.
//
// (2) Password / access-token-request flow — NOT used here.
//     Posts JSON { name, password, appId, appVersion, cid, sec, deviceId }
//     to /v1/auth/accesstokenrequest. This is the username/password flow,
//     not OAuth. The "Curl Example" shown in Tradovate's portal sometimes
//     references this endpoint — it does NOT apply to the OAuth callback.
//
// Reference: https://github.com/tradovate/example-api-oauth (official example)

// ── OAuth model decision ──────────────────────────────────────────────────────
//
// Tradovate's OAuth Registration is associated with a single Client ID that
// is recognized at one specific authorization host. In practice the issued
// CID is recognized at https://trader.tradovate.com/oauth — sending users
// to https://trader-d.tradovate.com/oauth produces a "Wrong client_id" UI
// error before any callback is hit.
//
// Tradovate's account model is per-user, not per-OAuth-env: a single user
// can have live, demo/sim, and prop-firm accounts under one login. After a
// successful OAuth at the host that recognizes the CID, /account/list
// returns all of those accounts. The user picks which to import; the
// account_type / prop_firm / label are local metadata.
//
// Therefore: both demo and live OAuth use the same URL pair. The "env"
// selector in the connect form is currently local metadata only (it does
// not drive Tradovate URL selection). If Tradovate later confirms that
// demo OAuth requires a separate CID, env-specific
// TRADOVATE_DEMO_CLIENT_ID/_SECRET vars can be added here.

const DEFAULTS = {
  // ── Authorization + token endpoints (OAuth authorization-code flow) ───────
  // Both env keys point to the same URL pair. Override per env via
  // TRADOVATE_AUTH_URL_LIVE/_DEMO and TRADOVATE_TOKEN_URL_LIVE/_DEMO if a
  // future configuration ever needs to split them again.
  authUrlLive: "https://trader.tradovate.com/oauth",
  authUrlDemo: "https://trader.tradovate.com/oauth",

  // Path is /auth/oauthtoken — NOT /oauth/token, NOT /v1/auth/oauthtoken.
  tokenUrlLive: "https://live-api.tradovate.com/auth/oauthtoken",
  tokenUrlDemo: "https://live-api.tradovate.com/auth/oauthtoken",

  // ── REST API base (read pipeline — separate from OAuth) ───────────────────
  // TODO: unverified against a real account — see docs/broker-integration-plan.md.
  apiBaseLive: "https://live.tradovateapi.com/v1",
  apiBaseDemo: "https://demo.tradovateapi.com/v1",
} as const;

export type TradovateEnv = "live" | "demo";

export type TradovateConfig = {
  clientId: string;
  clientSecret: string;
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
  if (!tokenEncryptionKey) {
    missing.push("TRADOVATE_TOKEN_ENCRYPTION_KEY");
  } else {
    // Validate the key decodes to exactly 32 bytes (AES-256 requirement).
    // Normalize URL-safe base64 first (mirrors token-crypto.ts loadKey).
    const normalized = tokenEncryptionKey.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(normalized, "base64");
    if (decoded.length !== 32) {
      missing.push(
        `TRADOVATE_TOKEN_ENCRYPTION_KEY (must decode to 32 bytes; got ${decoded.length} — regenerate with: openssl rand -base64 32)`,
      );
    }
  }

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

/**
 * True when the OAuth credentials needed to connect Tradovate are present.
 * Demo and live accounts both use the same credentials, so this is equivalent
 * to isTradovateConfigured().
 */
export function isDemoOAuthConfigured(): boolean {
  return isTradovateConfigured();
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

/**
 * Log a sanitized snapshot of the Tradovate OAuth configuration.
 * Intended to be called once at server startup via instrumentation.ts.
 *
 * Never logs TRADOVATE_CLIENT_SECRET or any token value.
 */
export function logTradovateConfigDiagnostic(): void {
  const status = getTradovateConfig();
  if (status.state !== "ready") {
    console.warn("[tradovate/config] OAuth not configured at startup — missing keys:", status.missing);
    return;
  }
  const { config } = status;
  console.info("[tradovate/config] OAuth startup diagnostic", {
    clientId: config.clientId,
    hasClientSecret: Boolean(config.clientSecret),
    redirectUriEnvVar: readEnv("TRADOVATE_REDIRECT_URI") ?? "(not set — derived from APP_URL or request)",
    nextPublicAppUrl: readEnv("NEXT_PUBLIC_APP_URL") ?? "(not set)",
    appUrl: config.appUrl ?? "(not set)",
    authUrlLive: config.authUrl.live,
    authUrlDemo: config.authUrl.demo,
    tokenUrlLive: config.tokenUrl.live,
    tokenUrlDemo: config.tokenUrl.demo,
  });
}
