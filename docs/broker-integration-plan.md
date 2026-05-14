# Broker Integration Plan

This is an internal engineering plan for moving Guardrail from Manual Mode
(journal-driven, app-level enforcement) to broker-connected risk
enforcement. Tradovate is the first target.

The goal is **honest, verifiable enforcement** — never claim a broker can
block trades unless it is wired end-to-end and proven against a real
account.

---

## What needs to be verified with Tradovate

Before any code that claims live broker enforcement ships, confirm the
following with Tradovate's API documentation and a sandbox account:

1. **OAuth client registration** — Do we have `client_id` / `client_secret`
   for production and demo? What scopes are required for read vs.
   destructive actions?

2. **Token lifecycle** — Access token TTL, refresh token TTL, refresh
   endpoint, revocation endpoint, behaviour on password change.

3. **Account discovery** — How to list a user's accounts (live, demo,
   funded, eval) after OAuth. Account ID format. Multi-account handling.

4. **Read endpoints** — Are these REST, WebSocket, or both? Required
   authentication on each:
   - Account snapshot (balance, equity, margin)
   - Open positions
   - Open orders (working, parked, OCO)
   - Today's executions / fills
   - Live P&L stream

5. **Order cancellation** — REST endpoint to cancel a single order, batch
   cancel, cancel-all. Idempotency. Permissions required. Latency.

6. **Position flattening** — Is there a native "flatten" endpoint, or do
   we need to issue closing orders ourselves? Behaviour during fast
   markets, partial fills.

7. **Broker-level lockout** — Does Tradovate expose a way to **prevent
   new orders from being placed** until a window expires? (E.g. a
   "trading halt" flag, max-loss-rule binding, evaluation lockout.)
   If no such API exists, we must NOT claim broker-level lockout — it
   becomes "client-side prevention only" and is best-effort.

8. **Webhook / push** — Does Tradovate push events to our endpoint, or
   do we poll? Signature / verification scheme. Replay protection.

9. **Rate limits** — Per-user, per-app, per-endpoint. Backoff requirements.

10. **Sandbox / demo environment** — Is there a separate base URL? Are
    demo accounts safe for end-to-end testing of destructive actions?

11. **Compliance** — Any disclaimers, acknowledgements, or licensing
    requirements before we're allowed to enforce risk on user accounts.

---

## Required environment variables

The OAuth flow refuses to start unless ALL three required keys are
present. This is the gate that prevents a "fake connected" state where
OAuth completes but we have no way to securely persist the tokens.

| Var                                | Required | Purpose                                                                                       |
|------------------------------------|----------|-----------------------------------------------------------------------------------------------|
| `TRADOVATE_CLIENT_ID`              | ✓        | OAuth client id from the Tradovate partner portal                                             |
| `TRADOVATE_CLIENT_SECRET`          | ✓        | OAuth client secret used in token exchange                                                    |
| `TRADOVATE_TOKEN_ENCRYPTION_KEY`   | ✓        | 32+ char secret for encrypting access/refresh tokens at rest. Generate with `openssl rand -hex 32` |
| `TRADOVATE_REDIRECT_URI`           |          | Optional override; routes derive it from the request origin otherwise                         |
| `TRADOVATE_AUTH_URL_LIVE`          |          | Override Tradovate live authorize URL                                                         |
| `TRADOVATE_AUTH_URL_DEMO`          |          | Override Tradovate demo authorize URL                                                         |
| `TRADOVATE_TOKEN_URL_LIVE`         |          | Override Tradovate live token endpoint                                                        |
| `TRADOVATE_TOKEN_URL_DEMO`         |          | Override Tradovate demo token endpoint                                                        |
| `TRADOVATE_API_BASE_URL_LIVE`      |          | Override Tradovate live REST API base                                                         |
| `TRADOVATE_API_BASE_URL_DEMO`      |          | Override Tradovate demo REST API base                                                         |

`src/lib/brokers/tradovate-env.ts` resolves all of the above and
returns either `{ state: "ready", config }` or
`{ state: "not_configured", missing }`.

## OAuth flow

Standard authorization code flow, gated by env-var presence:

```
User clicks "Connect Tradovate"
  -> GET /api/auth/tradovate/connect
     - getTradovateConfig() must return state="ready" or we 503
     - Generate nonce, persist as httpOnly cookie
     - Redirect to authUrl[env] with client_id, redirect_uri, scope=read, state

Tradovate redirects back
  -> GET /api/auth/tradovate/callback
     - Verify state cookie + nonce  (CSRF)
     - Re-validate getTradovateConfig() (env may have changed)
     - POST to tokenUrl[env] with the auth code
     - On success:
       - Read tokenData.access_token / refresh_token / account_id / expires_in
       - DO NOT persist raw tokens — encryption layer not yet shipped
       - Upsert ConnectedAccount with:
           connectionStatus = "oauth_pending_storage"
           errorMessage     = "OAuth verified. Read pipeline is not yet
                               enabled — token storage encryption is pending."
     - Redirect to /accounts/connect/tradovate?oauth=verified&account=<id>
```

### Token storage (implemented)

Tokens are encrypted with **AES-256-GCM** keyed by
`TRADOVATE_TOKEN_ENCRYPTION_KEY`. The encryption module
(`src/lib/security/token-crypto.ts`) is the only path through which
tokens reach the database.

**Key format:** base64-encoded 32-byte key (44 chars with `=` padding,
or 43 chars unpadded). Generate with `openssl rand -base64 32`. Any
other decoded length is rejected with `KEY_LENGTH`.

**Stored payload format** (JSON-serialised in the
`accessTokenEncrypted` / `refreshTokenEncrypted` TEXT columns):

```json
{ "v": 1, "iv": "<base64 12 B>", "ct": "<base64>", "tag": "<base64 16 B>" }
```

- `v`   — payload version (1 today; bumped if the format changes)
- `iv`  — fresh random GCM nonce per encryption
- `ct`  — ciphertext
- `tag` — GCM auth tag (any tampering causes `DECRYPT_FAILED`)

**Connection lifecycle:**

| Status               | Meaning                                                              |
|----------------------|----------------------------------------------------------------------|
| `not_connected`      | No OAuth attempt yet                                                 |
| `connected_readonly` | OAuth done, tokens encrypted. Read pipeline active (unverified endpoints). |
| `connected_live`     | Reserved for after first verified successful broker read             |
| `expired`            | Token expired and refresh failed; user must re-authorize             |
| `connection_error`   | Reserved for adapter-level failures (future)                         |

**What is implemented:**

- AES-256-GCM encrypt + decrypt in `token-crypto.ts`
- Key validation (presence, base64, 32-byte length)
- Versioned payload format with auth tag
- OAuth callback encrypts and persists `access_token` + `refresh_token`
- `tokenExpiresAt` set when Tradovate returns `expires_in`
- `getTradovateTokensForAccount(accountId, userId)` — server-only
  loader with ownership + platform checks
- `TradovateClient` in `tradovate-client.ts` — server-only read client:
  - On-demand token refresh (5-minute pre-expiry buffer)
  - Marks account `expired` when refresh fails or 401 is received
  - Methods: `getAccounts`, `getCashBalanceSnapshot`, `getPositions`,
    `getOrders`, `getFills`, `resolveContracts`, `toAccountSnapshot`,
    `toPositions`, `toOrders`, `toExecutions`, `probeConnection`
  - Never logs token values; error messages reference codes only
- `GET /api/brokers/tradovate/snapshot?accountId=<id>` — internal test
  route; auth + ownership required; returns normalised read-only data
- Account card shows `connected_readonly` badge, `lastSyncAt`, and
  "Test read-only connection" CTA linking to the snapshot route
- 15 token-crypto unit tests + 13 mapping / error-class unit tests

**⚠ Endpoint verification status:**

All Tradovate REST API paths in `tradovate-client.ts` are based on
Tradovate's publicly documented API v1 but have **not been verified
against a real account**. Do not flip capabilities to `available` in
`TradovateAdapter` until each method is tested end-to-end with real
credentials. See the verification checklist at the top of this file.

**Destructive actions are completely disabled.** `cancelAllOrders`,
`flattenAllPositions`, `activateLockout`, and `deactivateLockout` all
throw `NotImplementedError`. No path through the codebase calls these
methods. They will not be enabled until:
1. Each Tradovate endpoint is verified against a real account.
2. An explicit user opt-in is wired in Rules → On-breach actions.
3. An audit log entry is written before each action fires.

**Limitations / not yet implemented:**

- **Endpoint verification**: every API path must be confirmed with a
  real Tradovate account before flipping capabilities to `available`.
- **Key rotation**: today the runtime accepts only the single configured
  key. Rotation requires a `keys` array, payload `v` bumped, and a
  one-time re-encrypt migration.
- **Risk state from broker data**: `computeBrokerRiskState` still throws
  `NotImplementedError`. Dashboard / Guardian continue to evaluate from
  manual journal entries until Phase 3 ships.
- **Audit logging**: encrypt / decrypt and API call operations are not
  logged individually. Failures log only the error `code`, never values.

### Verification page (read-only)

Path: **`/accounts/tradovate/verify?accountId=<id>`**

This is the canonical entry point for verifying a Tradovate read-only
connection. The Accounts page links here from the **"Verify read-only
connection ↗"** CTA on every `connected_readonly` card. The page is
authenticated and ownership-checked: it redirects non-owners back to
`/accounts` and 404s on missing accounts.

**What it does:**

1. Loads stored encrypted tokens via `getTradovateTokensForAccount` and
   refreshes them on demand if within the 5-minute pre-expiry buffer.
2. Runs every Tradovate read endpoint (`account/list`,
   `cashBalance/getCashBalanceSnapshot`, `position/list`, `order/list`,
   `fill/list`, `contract/items`) in parallel where independent.
3. Renders a structured report:
   - Summary banner (all green / token issue / partial failure).
   - Status row: connection, token, last sync.
   - Per-endpoint check list with pass / fail / skip and duration.
   - Warnings (e.g. contract resolution silently fell back to numeric IDs).
   - Collapsible **Developer details** with timings, error codes, and a
     link to the JSON endpoint. No token values or raw upstream payloads.

**Status transitions made by the verification flow:**

| Outcome                                | DB side-effect                                            |
|----------------------------------------|-----------------------------------------------------------|
| Token load OK + at least one endpoint  | `lastSyncAt` set to now; status unchanged                 |
| `externalAccountId` newly resolved     | Persisted on `ConnectedAccount`                           |
| Token refresh succeeds                 | Re-encrypted access/refresh stored; `errorMessage` cleared |
| Token refresh fails / 401 from API     | `connectionStatus = "expired"`; `errorMessage` populated  |
| Token expired with no refresh token    | `connectionStatus = "expired"` (re-authorize required)    |

### Snapshot route

`GET /api/brokers/tradovate/snapshot?accountId=<id>` returns the same
report as JSON. Auth + ownership are enforced. Response shape:

```json
{
  "ok": true,
  "connectionStatus": "connected" | "expired" | "error" | "disconnected",
  "tokenStatus": "valid" | "expired" | "no_refresh" | "load_failed" | "config_missing" | "unknown",
  "checks": [
    { "name": "tokens", "label": "Token load and refresh", "status": "pass", "message": "...", "durationMs": 12 },
    { "name": "account_discovery", "label": "Account discovery", "status": "fail", "message": "...", "errorCode": "API_ERROR", "durationMs": 312 }
  ],
  "snapshot": {
    "account": { "balance": ..., "todayPnL": ..., ... } | null,
    "positions": [...] | null,
    "orders": [...] | null,
    "executions": [...] | null
  },
  "warnings": ["..."],
  "lastSyncAt": "2026-04-26T..." | null
}
```

**Partial-failure behavior:**

- A failing endpoint does **not** abort the rest of the checks.
- Token / auth failure (`tokens` check fails) short-circuits the run:
  every other check is marked `skip`. This is the only short-circuit.
- The `snapshot.<key>` is `null` when the corresponding check failed,
  populated when it passed.
- `ok` is `true` only when every non-skipped check is `pass`. A skip is
  acceptable (e.g. contract resolution skipped when there are no
  contracts to resolve).
- Tokens and raw upstream payloads are NEVER returned, regardless of the
  `ok` value.

### Promoting endpoints to "verified"

Endpoints in `tradovate-client.ts` remain **unverified** until tested
against a real Tradovate account. To promote:

1. Connect a real Tradovate account (Live or Demo).
2. Open `/accounts/tradovate/verify?accountId=<id>`.
3. Confirm every check passes and the `snapshot` values match what you
   see in Tradovate's official UI (balance, open positions, fills).
4. Cross-check each endpoint shape against Tradovate's official API
   documentation. Update the field names in `tradovate-client.ts` if
   the documented shape differs from what the code expects.
5. Flip the corresponding `requires_oauth` capability statuses to
   `available` in `tradovate-adapter.ts` (one capability at a time —
   verify the UI still renders correctly after each flip).
6. Repeat for both Live and Demo environments.

**Until the above is done, broker data is NOT used for risk
evaluation** — Dashboard and Guardian continue to evaluate from manual
journal entries.

### Open operational questions

- Where do refresh tokens get refreshed? (cron, on-demand, both)
- Where do we store the encryption key? (env var for app; consider KMS
  in production)
- What happens on token expiry mid-session? (retry once, then mark
  connection `expired` and surface in UI)

---

## Permissions / scopes needed

Map Guardrail's capability keys to Tradovate scopes (TBD — fill in once
documented):

| Guardrail capability   | Tradovate scope (TBD)        |
|------------------------|------------------------------|
| readAccount            | `accounts:read` (?)          |
| readBalance            | `accounts:read` (?)          |
| readPositions          | `positions:read` (?)         |
| readOrders             | `orders:read` (?)            |
| readPnL                | `accounts:read` (?)          |
| readExecutions         | `executions:read` (?)        |
| cancelOrders           | `orders:write` (?)           |
| flattenPositions       | `positions:write` (?)        |
| brokerLevelLockout     | unknown — to verify          |
| placeOrderBlock        | unknown — to verify          |

---

## Which enforcement actions may or may not be possible

**High confidence (most APIs support these):**

- Read account, balance, positions, orders, P&L, executions
- Cancel open orders
- Submit closing market orders to flatten positions

**Uncertain — requires verification:**

- True broker-level lockout (server-side rejection of new orders for a
  defined window). If unavailable, the closest practical option is:

  - Cancel all open orders + flatten + repeatedly cancel new orders as
    they arrive. This is **best-effort, not authoritative** — there is
    a race window where an order can fill before we cancel it.

  - We MUST clearly mark this in the UI as "best-effort lockout" and
    not promise it as a hard broker-level block.

- Pre-trade order blocking. Probably not exposed by Tradovate to
  third-party apps — broker rules engines run at the exchange/risk
  layer, not at the API consumer layer.

---

## Safe rollout plan

Each phase ships with the previous one fully working and visible in the
Accounts capability matrix. No phase advances until we have a real
test against a real account.

### Phase 0 — Foundation (this commit)

- Broker adapter interface + Tradovate placeholder
- Capability registry drives the Accounts page matrix
- All destructive methods throw `NotImplementedError`
- Manual Mode keeps working

### Phase 1 — Read-only connection

- Implement OAuth (authorize + callback + token storage)
- Implement `getConnectionStatus()` against Tradovate
- Mark `readAccount` status = `available`
- Show real account label + balance on the account card
- **No risk evaluation from broker data yet** — Manual Mode still
  drives Dashboard / Guardian. We only verify the connection works.

### Phase 2 — Read positions, orders, P&L

- Implement `getOpenPositions`, `getOpenOrders`, `getAccountSnapshot`
- Mark those capabilities `available` in the registry
- Surface positions / orders in the Accounts detail view
- Still no automated risk evaluation from broker data

### Phase 3 — Read executions, compute broker risk state

- Implement `getTodayExecutions`
- Wire `computeBrokerRiskState` (currently throws) to the broker
  adapter's executions
- Dashboard / Guardian start using broker numbers when broker is
  connected; Manual Mode remains the fallback
- Telegram alerts now fire from broker-driven verdicts

### Phase 4 — App-level alerts only (no destructive actions)

- Pre-news warnings, approaching-limit warnings, lockout-reached
  notifications all fire from broker data
- Still no broker-side cancellation / flatten / lockout
- The capability matrix updates: read-* → `available`,
  cancel/flatten/lockout still `coming_soon`

### Phase 5 — Cancel orders

- Implement `cancelAllOrders` against Tradovate
- Add a confirmation dialog in the UI ("Cancel all 3 working orders?")
- Add an audit log entry for every cancellation
- Mark `cancelOrders` `available`

### Phase 6 — Flatten positions (kill switch)

- Implement `flattenAllPositions`
- Idempotent + safe under partial fills
- Behind explicit user opt-in in Rules → On-breach actions
- Mark `flattenPositions` `available`

### Phase 7 — Broker-level lockout (only if API supports it)

- Verify Tradovate exposes a true server-side lockout. If not, do not
  ship this — keep `brokerLevelLockout` as `unknown` / `not_supported`.
- If supported: implement `activateLockout` + `deactivateLockout`
- Add a clear lockout state in the UI with reset window

---

## Tradovate endpoint reference

See [`docs/tradovate-openapi-notes.md`](./tradovate-openapi-notes.md) for the
authoritative list of `/deps?masterid` parent-entity rules, trade count source
authority levels, and the required broker-side lockout sequence. Update that
file before adding any new Tradovate endpoint.

---

## Operational guardrails (non-negotiable)

1. **No fake data in production code paths.** Demo data lives behind a
   `BrokerProvider = "demo"` flag and is clearly labelled.
2. **No silent fallbacks.** If broker data is unavailable when we expect
   it, the UI says so. We do NOT fall back to Manual Mode silently —
   that would mislead the trader about which numbers are authoritative.
3. **Capability statuses must reflect reality.** Flipping a status to
   `available` requires both:
   - The adapter method actually works against a real account.
   - The UI explicitly tested with that account.
4. **Audit log every destructive action** (cancel, flatten, lockout
   activate/deactivate) before it ships. Required for trust + debugging.
5. **Manual Mode is not deleted.** It remains the fallback for users
   who haven't connected a broker, and the demo path for evaluation.
