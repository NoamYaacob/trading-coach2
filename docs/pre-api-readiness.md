# Pre-API readiness checklist

Internal tracking doc — what is built, what is gated on real Tradovate
API access, and what must NOT ship until verified.

The product status panel at `src/components/ui/product-status-panel.tsx`
renders a user-facing version of this list (Accounts and Settings
embed it). Keep both in sync.

## Required environment variables

| Var                              | Required for             | Status                        |
|----------------------------------|--------------------------|-------------------------------|
| `DATABASE_URL`                   | App runtime              | Always required               |
| `TELEGRAM_BOT_TOKEN`             | Telegram alerts          | Optional — alerts surface only |
| `TRADOVATE_CLIENT_ID`            | Tradovate OAuth          | Required to start OAuth       |
| `TRADOVATE_CLIENT_SECRET`        | Tradovate OAuth          | Required to start OAuth       |
| `TRADOVATE_TOKEN_ENCRYPTION_KEY` | Token storage at rest    | Required to start OAuth       |
| `TRADOVATE_REDIRECT_URI`         | OAuth callback override  | Optional                      |
| `TRADOVATE_*_URL_LIVE/DEMO`      | Per-env URL overrides    | Optional                      |

If any required Tradovate var is missing, `getTradovateConfig()` returns
`{ state: "not_configured", missing }` and the connect flow refuses to
start. Manual Mode remains the fallback.

## OAuth credentials

- Live and Demo client_id / client_secret live in
  `TRADOVATE_CLIENT_ID` / `TRADOVATE_CLIENT_SECRET`.
- Per-env URLs default to Tradovate's documented endpoints (overridable
  via `TRADOVATE_AUTH_URL_LIVE` / `..._DEMO`, etc.).
- Scope on the authorize redirect is hardcoded to `read`. No
  `orders:write` / `positions:write` scopes are requested anywhere in
  the codebase.

**Open question:** confirm with Tradovate which scope strings their API
expects for read-only access. The current value is a best-guess.

## Token encryption

- Algorithm: AES-256-GCM with random 12-byte IV per encryption.
- Key format: base64-encoded 32-byte key (`openssl rand -base64 32`).
- Payload format: `{ v: 1, iv, ct, tag }` JSON-serialised in the
  `accessTokenEncrypted` / `refreshTokenEncrypted` TEXT columns.
- Auth tag is verified on every decrypt — tampering throws
  `DECRYPT_FAILED`.
- 15 unit tests cover round trip, wrong key, tampered ciphertext, and
  malformed payloads.

## Read-only verification

- Page: `/accounts/tradovate/verify?accountId=<id>` (server component).
- API: `GET /api/brokers/tradovate/snapshot?accountId=<id>` returns the
  same `VerificationReport` JSON.
- Auth + ownership enforced at both surfaces.
- Token / auth failure short-circuits remaining checks (skip status).
  Endpoint failures are isolated.
- 71 unit tests covering token encryption, helper functions, and
  verification report mapping.

## Tradovate endpoints — verification status

| Endpoint                                       | Path used in client            | Verified? |
|------------------------------------------------|--------------------------------|-----------|
| List accounts for OAuth user                   | `GET /account/list`            | Pending   |
| Cash balance snapshot                          | `POST /cashBalance/getCashBalanceSnapshot` | Pending |
| Open positions                                 | `GET /position/list`           | Pending   |
| Working orders                                 | `GET /order/list`              | Pending   |
| Today's fills                                  | `GET /fill/list`               | Pending   |
| Contract symbol resolution                     | `POST /contract/items`         | Pending   |
| Refresh token grant                            | OAuth `tokenUrl` (env-derived) | Pending   |

**Promotion criterion:** an endpoint moves from "Pending" to "Verified"
only after the verification page returns a passing check for that
endpoint AND the JSON shape matches the documented Tradovate spec.

## Destructive actions — explicitly disabled

The following adapter methods throw `NotImplementedError` on every
broker provider. There is no code path that calls them.

| Method                              | TradovateAdapter status | Notes                                           |
|-------------------------------------|-------------------------|-------------------------------------------------|
| `cancelAllOrders()`                 | `coming_soon`           | Will require explicit user opt-in + audit log   |
| `flattenAllPositions()`             | `coming_soon`           | Same; idempotent, partial-fill safe             |
| `activateLockout()`                 | `unknown`               | Tradovate API support to be verified            |
| `deactivateLockout()`               | `unknown`               | Same                                            |
| `placeOrderBlock()` (pre-trade)     | `unknown`               | Likely not exposed by Tradovate to third parties |

**Non-negotiable rules before any of the above ship:**

1. End-to-end verification against a live account.
2. Explicit user opt-in surfaced in Rules → On-breach actions.
3. Audit log entry written before each invocation.
4. Confirmation dialog with the exact action ("Cancel all 3 working
   orders for account X?").
5. Rollback / reset path.

## Manual Mode — what works today

- Risk rules editor (`/rules`) — edits `RiskRules` and mirrors session
  fields into `GuardianProfile`.
- Trade entry form (`/journal`) — auto-calc P&L, risk, R-multiple.
- `computeManualRiskState({ rules, todayTrades })` — pure function,
  drives Dashboard + Guardian permission state.
- Trading-day window with timezone + session hours support.
- Journal-derived "Safe / Warning / Locked" verdict.

What Manual Mode does NOT do:

- Prevent orders at the broker. Lockout is an in-app state only.
- Receive automatic fills. Each trade must be logged manually.
- Pull P&L from the broker. P&L is computed from logged entries.

## Telegram alerts — optional

- Bot integration in `src/lib/telegram-bot.ts`.
- Linked per-user via `/alerts` page.
- Sends Guardian state changes and lockout messages when configured.
- Not required for the rest of the product to work.

## Things NOT to do before API access arrives

- Do not flip `TradovateAdapter` capability statuses to `available`.
- Do not call `cancelAllOrders` / `flattenAllPositions` / lockout
  methods anywhere — they exist only as `NotImplementedError` throws.
- Do not promise broker-level enforcement on the landing page or
  marketing copy. Use "app-level" or "Manual Mode" framing.
- Do not synthesise broker data when the API is unavailable. The
  honest UX is "Manual Mode is the source of truth until your broker
  is connected and verified".
- Do not add account types beyond Tradovate / Manual until the read
  pipeline ships for the first broker.

## When real API access arrives

1. Connect a Tradovate account (Live and/or Demo).
2. Open `/accounts/tradovate/verify?accountId=<id>`.
3. For each failing check:
   - Compare the request shape in `tradovate-client.ts` against the
     official Tradovate API documentation.
   - Update field names, request method, or response parsing.
   - Re-run verification until the check passes.
4. Repeat for both Live and Demo environments.
5. Once all reads pass and snapshots match Tradovate's official UI:
   - Update each capability in `tradovate-adapter.ts` from
     `requires_oauth` to `available`.
   - Wire `computeBrokerRiskState` to the broker adapter (it currently
     throws `NotImplementedError`).
   - Update the product status panel's `endpoints` and `risk_state`
     items from `pending` to `ready`.
6. Cancel / flatten / lockout remain off the roadmap until each one is
   verified against the live API in isolation.
