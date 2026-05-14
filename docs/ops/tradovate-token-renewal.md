# Tradovate Token Renewal

## How it works

Tradovate access tokens last approximately 80–90 minutes. Guardrail renews
tokens **proactively** — before they expire — so there is no gap in broker
connectivity.

### Token storage

| Column | Table | Notes |
|---|---|---|
| `accessTokenEncrypted` | `BrokerConnection` | Canonical encrypted token (AES-256-GCM) |
| `refreshTokenEncrypted` | `BrokerConnection` | Optional; used as fallback if `renewAccessToken` fails |
| `tokenExpiresAt` | `BrokerConnection` | UTC datetime; null means "unknown — treat as stale" |
| `accessTokenEncrypted` | `ConnectedAccount` | Legacy per-account copy; set only by the old single-account OAuth flow |

**Rule**: when `ConnectedAccount.brokerConnectionId` is set, the
`BrokerConnection` columns are always authoritative. The per-account columns
are only used for accounts that pre-date the multi-account OAuth flow and have
no `brokerConnectionId`.

### Two-tier renewal strategy

Every time a BrokerConnection is synced, Guardrail renews the token in two
steps:

1. **`GET /auth/renewAccessToken`** — lightweight call using the current
   Bearer token. Tradovate returns a new `accessToken` (and optionally
   `expirationTime`). This is tried first because it requires no secrets.

2. **`POST /auth/oauthtoken` (refresh_token grant)** — full OAuth grant using
   the stored `refreshTokenEncrypted`. Used only when the lightweight renew
   fails with an `auth_invalid` error and a refresh token is available.

If both fail with `auth_invalid` the `BrokerConnection.connectionStatus` is
set to `"expired"` and all linked `ConnectedAccount` rows are updated to
`connectionStatus: "expired"` so the UI surfaces the Reconnect card
immediately.

Transient failures (network errors, 5xx, 429, parse errors) do **not** mark
the connection expired — the next cron cycle retries automatically.

### Proactive renewal buffer

The buffer is **15 minutes** (`REFRESH_BUFFER_MS = 15 * 60 * 1000`).
`shouldRenewToken()` triggers renewal when:

- `tokenExpiresAt` is null (unknown expiry — treat as stale)
- `tokenExpiresAt` is in the past (already expired)
- `tokenExpiresAt` is within 15 minutes of now

A 15-minute buffer ensures a sync that takes 1–2 minutes (balance + positions
+ orders + fills + report) never reaches the expiry midway.

### Connection-level renewal in the cron

`syncTradovateConnection` calls `ensureTradovateAccessToken` **once per
BrokerConnection** before discovery and parallel account syncs:

```
syncTradovateConnection(connectionId, userId)
  └── ensureTradovateAccessToken(connectionId, userId)  ← renews once
  └── runDiscoveryForConnection(connectionId, userId)   ← uses fresh token
  └── Promise.allSettled([syncAccount1, syncAccount2, ...])
        └── TradovateClient.initialize()  ← sees fresh token, skips renewal
```

Without connection-level pre-renewal, N accounts on the same connection would
each attempt renewal concurrently — creating N concurrent `GET
/auth/renewAccessToken` requests with the same (possibly expired) token and N
races to write the same DB row.

## When a reconnect is required

A reconnect (fresh OAuth authorization) is required when:

- `BrokerConnection.connectionStatus = "expired"` — token renewal was rejected
  by Tradovate with a confirmed auth error (401/403, `invalid_grant`,
  `invalid_token`, or an empty token response to a 200 OK)
- The connection was revoked in the Tradovate platform by the user
- The Guardrail OAuth application's client credentials were rotated

The Settings → Broker connections page shows a **Needs attention** card with a
**Reconnect** button for any expired connection.

A reconnect is **not** required for:
- Network timeouts / 5xx from Tradovate
- Rate limiting (429)
- Tradovate maintenance windows

These are transient; the next cron cycle retries and does not change the
connection status.

## Verifying renewal in Railway logs

Every renewal attempt emits structured JSON log lines. Search for the tag
`[tradovate/ensure-token]` in the Railway log stream:

```
[tradovate/ensure-token] renewal decision {
  brokerConnectionId: "...",
  expiresAt: "2026-05-10T14:32:00.000Z",
  shouldRenew: true,
  reason: "within_buffer",
  msUntilExpiry: 120000
}

[tradovate/ensure-token] token renewed via renewAccessToken {
  brokerConnectionId: "...",
  newExpiresAt: "2026-05-10T15:27:00.000Z"
}
```

If renewal succeeds via the OAuth fallback you will see `token renewed via
OAuth grant` instead.

### Log lines to check

| Log tag | What it means |
|---|---|
| `renewal decision { shouldRenew: false }` | Token is fresh; no action taken |
| `renewal decision { shouldRenew: true, reason: "within_buffer" }` | Proactive renewal triggered |
| `renewal decision { shouldRenew: true, reason: "already_expired" }` | Token was past expiry (investigate why prior renewal missed) |
| `token renewed via renewAccessToken` | Lightweight renewal succeeded |
| `token renewed via OAuth grant` | Lightweight renewal failed; OAuth fallback succeeded |
| `renewAccessToken attempt failed { class: "transient" }` | Tradovate error (5xx/429/network); next cron will retry |
| `renewAccessToken attempt failed { class: "auth_invalid" }` | Credential rejected; checking OAuth fallback |
| `connection marked expired` | Both renewal paths failed with auth_invalid; user must reconnect |

Per-account logs from `TradovateClient.initialize()` use the tag
`[tradovate/auth]`:

```
[tradovate/auth] renewal decision { ... }
[tradovate/auth] token renewal succeeded { ... }
[tradovate/auth] token renewal failed { class: "transient", willMarkExpired: false }
```

After `ensureTradovateAccessToken` runs, `TradovateClient.initialize()` for
each account should log:

```
[tradovate/auth] renewal decision { shouldRenew: false, reason: "valid_outside_buffer" }
```

If it logs `shouldRenew: true` for an account after `ensure-token` already
renewed, the account's DB read is fetching a stale token — check that
`ConnectedAccount.brokerConnectionId` is correctly set and that
`tradovate-tokens.ts` is using the BrokerConnection path.

## 401 mid-request handling

`TradovateClient.#request()` handles 401 responses during API calls:

1. First 401: attempt one inline renewal + retry the original request once.
2. If renewal fails with `auth_invalid`: mark expired, throw.
3. If retry also returns 401: mark expired (for core endpoints), throw.
4. Subsequent 401 after successful renewal+retry: no additional loops.

The `skipMarkExpired` flag is used for optional endpoints (`order/deps`,
`fill/deps`) whose 401 means "OAuth scope cannot access this endpoint" rather
than "credentials are globally broken." These endpoints log the 401 but do not
mark the connection expired.
