# Pre-launch security checklist

What still needs to land before real users connect Tradovate (or any
other broker) accounts. This is the companion to `pre-api-readiness.md`
— that file tracks broker-feature readiness; this one tracks security
posture.

## Status snapshot (last updated: 2026-04-27)

Audit performed on branch `claude/rule-engine-violation-feed-ioIBS`
covering: auth/session, ConnectedAccount tokens, Tradovate OAuth, route
ownership, journal/rules validation, logging, env var safety, rate
limiting, and copy consistency.

### Resolved — initial audit (2026-04-27)

- **OAuth callback session binding** — the callback now verifies
  `state.userId === session.userId` in addition to the CSRF nonce.
  Previously an authenticated attacker could craft a state with another
  user's id and have tokens stored against the wrong account.
  See `src/lib/brokers/tradovate-oauth-state.ts`.
- **Token-exchange error logs** — the callback no longer logs raw
  fetch error objects or upstream response bodies. Only HTTP status
  and error class name are logged.
- **Env validator alignment** — `validateEnv()` only marks
  `DATABASE_URL` as required (matches `pre-api-readiness.md`).
  Telegram is now a warning-only soft requirement.
- **Journal input bounds** — `symbol`, `strategy`, `notes`, and
  `breachReason` lengths are bounded; `tradedAt` is constrained to a
  sane window.
- **Rules numeric bounds** — money and integer fields validated for
  finiteness and reasonable magnitudes; string fields capped.
- **Telegram link tokens** — issuing a new link token now invalidates
  any previously issued, still-unused tokens for the same user.

### Resolved — priority security pass (2026-04-27)

- **Rate limiting** — `src/lib/rate-limit.ts` implements an in-memory
  sliding-window limiter (not suitable for multi-instance; see §1 for
  Redis upgrade path). Applied to: `POST /api/auth/login` (5/min/IP,
  20/hr/IP), `POST /api/auth/signup` (3/hr/IP),
  `GET /api/auth/tradovate/connect` (5/hr/user),
  `GET /api/auth/tradovate/callback` (10/hr/user),
  `POST /api/telegram/link-token` (5/hr/user),
  `POST /api/journal` (60/min/user), `POST /api/rules` (30/min/user).
  All return 429 with `Retry-After`.
- **Telegram webhook secret** — `POST /api/telegram/webhook` now
  verifies the `X-Telegram-Bot-Api-Secret-Token` header using a
  timing-safe SHA-256 comparison against `TELEGRAM_WEBHOOK_SECRET`.
  In production with no secret configured, the route fails closed
  (returns 403). In development the check is skipped if the env var
  is absent.
- **Security headers** — added via `next.config.ts` `headers()`:
  `Content-Security-Policy` (default-src 'self', frame-ancestors 'none'),
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy` (camera/mic/geo off),
  `Strict-Transport-Security` (production only, 2-year max-age).
- **Debug/dev routes** — `GET /api/dev/coach-eval` and
  `GET /api/dev/coach-eval` already had guards; added 404-in-production
  guard to `POST /api/debug/coach` and `POST /api/debug/tradovate-event`
  which were previously unguarded.

### Confirmed in-spec (no change needed)

- AES-256-GCM token encryption (15 unit tests; never logs key).
- Session tokens are SHA-256 hashed before DB storage; httpOnly,
  sameSite=lax, secure in prod; 30-day expiry.
- `bcryptjs` cost 12 for password hashing.
- Every user-scoped API route checks `getCurrentUser()` and filters
  every Prisma query by `userId` (or by an account whose `userId` was
  pre-checked).
- `getTradovateTokensForAccount` enforces the ownership boundary
  (`account.userId !== userId → throw`).
- Snapshot endpoint never returns tokens; all token-touching code
  paths use `parseAndDecrypt` and surface only error categories on
  failure.
- All destructive broker methods (`cancelAllOrders`,
  `flattenAllPositions`, `activateLockout`, `deactivateLockout`,
  `placeOrderBlock`) throw `NotImplementedError` on every adapter.
  No code path calls them.
- `TRADOVATE_TOKEN_ENCRYPTION_KEY` is read only on the server (token
  helpers are server-only). It is never embedded in client bundles
  (no `NEXT_PUBLIC_` alias) and never serialised in API responses.
- OAuth scope is hardcoded to `read`. No write/order/lockout scopes
  are requested anywhere.

## Open gaps — must close before broker launch

These are the items that should be addressed before real users connect
broker accounts. Severity reflects the risk if shipped as-is.

### 1. Rate limiting — upgrade to Redis for multi-instance deploys (MEDIUM)

**Partially resolved.** The routes listed below are now rate-limited via
`src/lib/rate-limit.ts`. The current implementation is an **in-memory
sliding-window limiter** — each process has its own store. On
single-instance Railway deploys this is sufficient.

| Route                                 | Limit              | Status  |
|---------------------------------------|--------------------|---------|
| `POST /api/auth/login`                | 5/min/IP, 20/hr/IP | ✅ done |
| `POST /api/auth/signup`               | 3/hr/IP            | ✅ done |
| `GET  /api/auth/tradovate/connect`    | 5/hr/user          | ✅ done |
| `GET  /api/auth/tradovate/callback`   | 10/hr/user         | ✅ done |
| `POST /api/telegram/link-token`       | 5/hr/user          | ✅ done |
| `POST /api/journal`                   | 60/min/user        | ✅ done |
| `POST /api/rules`                     | 30/min/user        | ✅ done |
| `POST /api/session/manual-event`      | 60/min/user        | open    |
| `POST /api/guardian/status`           | 60/min/user        | open    |

**Remaining:** Before scaling to multiple instances, replace
`checkRateLimit` in `src/lib/rate-limit.ts` with a Redis/Upstash adapter
behind the same interface. `/api/session/manual-event` and
`/api/guardian/status` are lower-priority (session writes) but should
be capped before launch.

### 2. Webhook authentication (partially resolved)

- **Telegram webhook — ✅ resolved.** `/api/telegram/webhook` now
  requires `X-Telegram-Bot-Api-Secret-Token` to match
  `TELEGRAM_WEBHOOK_SECRET`. Comparison is timing-safe (SHA-256).
  Production fails closed when the env var is absent. Set the same
  secret on Telegram's `setWebhook` call before going live.
- **Tradovate webhook — open.** `/api/tradovate/webhook` is currently
  unimplemented. When wired, require Tradovate's signature scheme (TBD
  with provider) before acting on any payload.

### 3. Stripe webhook signature verification (MEDIUM)

The audit did not deeply review `/api/billing/webhook` — confirm the
Stripe signature header is verified with `stripe.webhooks.constructEvent`
before any DB write. If not, an attacker could forge subscription
events.

### 4. Session rotation / invalidation (MEDIUM)

- Sessions live for 30 days with no rotation. Add an opt-in "revoke
  all sessions" control on Settings, and rotate the session token on
  password change.
- Consider rotating token on a sliding window (e.g. every 7 days of
  use) to limit blast radius from a stolen cookie.

### 5. Tradovate config rotation (MEDIUM)

`TRADOVATE_TOKEN_ENCRYPTION_KEY` is single-version. There is no
migration path if it is ever rotated — existing ciphertexts become
unreadable. Before launch:

- Define a key-versioning scheme (the payload already has a `v`
  field, currently always `1`).
- Document a rotation runbook: deploy new key as `v2`, decrypt-with-
  fallback for `v1`, re-encrypt on next read, retire `v1`.

### 6. Audit log for destructive actions (MEDIUM, gated on feature)

When `cancelAllOrders` / `flattenAllPositions` / `activate(de)Lockout`
ship, every invocation must:

- Write an audit log entry (user, account, action, parameters, result,
  initiated-by) BEFORE the broker call.
- Be gated by an explicit per-account user opt-in stored on the
  account.
- Surface a confirmation dialog with the exact action and counts.
- Have a rollback path for partial failures.

This is already in `pre-api-readiness.md` — restated here so it is on
the security checklist as well.

### 7. CSP / frame protection — ✅ resolved

Security headers are set globally via `next.config.ts` `headers()`:
`Content-Security-Policy` (default-src 'self', frame-ancestors 'none'),
`X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
`X-Content-Type-Options: nosniff`, `Permissions-Policy`,
`Strict-Transport-Security` (production only, 2-year max-age).

`'unsafe-inline'` is required for Next.js App Router RSC hydration
scripts and Tailwind v4 inline styles. `'unsafe-eval'` is excluded.

### 8. Generic-error vs enumeration trade-off (LOW)

`/api/auth/signup` returns 409 with "an account with this email
already exists". This is intentional for UX but is also user
enumeration. Decision needed pre-launch:

- Keep current behaviour (UX-friendly, enumeration-permissive), or
- Switch to "If this email is new, you'll receive a confirmation
  link" (privacy-friendly, requires email flow).

### 9. Debug routes guard — ✅ resolved

All routes under `/api/debug/*` and `/api/dev/*` now return 404 in
production: `debug/coach`, `debug/tradovate-event` (guards added),
`debug/fire-test-event` and `dev/coach-eval` (guards were already
present).

### 10. IP/UA pinning (consider, not required)

Current sessions are bearer tokens — they ride along with whatever
client presents the cookie. Consider binding sessions to a coarse
IP block or user-agent family for high-risk operations (broker
connect, password change). Increases friction for users on cellular
networks; weigh carefully.

## What MUST be done before real users connect a broker

A minimum-viable checklist:

1. ✅ Rate limiting on `/api/auth/login`, `/api/auth/signup`,
   `/api/auth/tradovate/connect`, `/api/auth/tradovate/callback`,
   `/api/telegram/link-token`, `/api/journal`, `/api/rules`. (See §1.)
   **Remaining:** `/api/session/manual-event`, `/api/guardian/status`;
   Redis upgrade for multi-instance scale.
2. ✅ Telegram webhook secret (`TELEGRAM_WEBHOOK_SECRET`) wired and
   enforced. (See §2.) **Remaining:** must set `setWebhook` with the
   same secret before going live.
3. Stripe webhook signature verification confirmed. (See §3.)
4. Session rotation on password change. (See §4.)
5. ✅ CSP / frame headers added. (See §7.)
6. ✅ Debug/dev routes confirmed disabled in production. (See §9.)
7. Re-run the audit against the current branch before flipping any
   capability from `requires_oauth` / `coming_soon` to `available`
   in the broker registry.

Items 8 and 10 from the open-gaps list are recommended but not
strictly blocking.
