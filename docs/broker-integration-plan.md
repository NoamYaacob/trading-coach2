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

## OAuth flow requirements

Standard authorization code flow:

```
User clicks "Connect Tradovate"
  -> /api/auth/tradovate/connect (already exists as a stub)
     - Generate state, store with userId
     - Redirect to Tradovate authorize URL with redirect_uri + state
Tradovate redirects back
  -> /api/auth/tradovate/callback (already exists as a stub)
     - Verify state
     - Exchange code for access/refresh tokens
     - Persist tokens (encrypted at rest) keyed by ConnectedAccount.id
     - Mark ConnectedAccount.connectionStatus = "connected_live"
```

**Open questions before we ship:**

- Where do refresh tokens get refreshed? (cron, on-demand, both?)
- Where do we store secrets? (env vars for app, KMS or pgcrypto for
  per-user tokens at rest)
- What happens on token expiry mid-session? (retry once, then mark
  the connection `expired` and surface in UI)

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
