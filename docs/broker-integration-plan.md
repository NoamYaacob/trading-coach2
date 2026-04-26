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

| Status                     | Meaning                                                         |
|----------------------------|-----------------------------------------------------------------|
| `not_connected`            | No OAuth attempt yet                                            |
| `connected_readonly`       | OAuth done, tokens encrypted in storage. Read pipeline not yet wired. |
| `connected_live`           | Reserved for after the first successful broker read             |
| `expired`                  | Token expired and refresh failed (future)                       |
| `connection_error`         | Reserved for adapter-level failures (future)                    |

**What is implemented:**

- AES-256-GCM encrypt + decrypt in `token-crypto.ts`
- Key validation (presence, base64, 32-byte length)
- Versioned payload format with auth tag
- Callback encrypts and persists `access_token` + `refresh_token`
- `tokenExpiresAt` set when Tradovate returns `expires_in`
- `getTradovateTokensForAccount(accountId, userId)` — server-only
  loader with ownership + platform checks; never returns to client code
- 15 unit tests covering round trip, wrong key, tampered ciphertext,
  malformed payload, missing key, invalid key length, and serialise/parse

**Limitations / not implemented:**

- **Key rotation**: today the runtime accepts only the single configured
  key. Rotation will require a `keys` array, the payload's `v` field
  bumped, and a one-time re-encrypt migration. Out of scope until the
  read pipeline ships.
- **Refresh job**: tokens are never refreshed yet. When `tokenExpiresAt`
  passes, the read pipeline (when built) must mint a new access token
  via the refresh token before each broker call.
- **Audit logging**: encrypt / decrypt operations are not logged
  individually. Failures log only the `code` field, never the value.

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
