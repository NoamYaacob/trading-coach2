# Pre-launch security checklist

What still needs to land before real users connect Tradovate (or any
other broker) accounts. This is the companion to `pre-api-readiness.md`
— that file tracks broker-feature readiness; this one tracks security
posture.

## Status snapshot (audit date: 2026-04-27)

Audit performed on branch `claude/rule-engine-violation-feed-ioIBS`
covering: auth/session, ConnectedAccount tokens, Tradovate OAuth, route
ownership, journal/rules validation, logging, env var safety, rate
limiting, and copy consistency.

### Resolved this audit

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

### 1. Rate limiting on auth + sensitive routes (HIGH)

- `/api/auth/login` has no per-IP throttle — vulnerable to credential
  stuffing.
- `/api/auth/signup` returns 409 for known emails — useful enumeration
  with no rate cap.
- `/api/auth/tradovate/connect` and `/callback` have no per-user cap.
- `/api/journal`, `/api/rules`, `/api/guardian/status`,
  `/api/session/manual-event` have no per-user write rate limit.
- `/api/telegram/link-token` has no per-user cap (an attacker with a
  hijacked session could spam token generation).

**Recommended approach.** Add a small Redis-backed token bucket (or
Upstash) middleware and apply it per-route:

| Route                                 | Limit                |
|---------------------------------------|----------------------|
| `POST /api/auth/login`                | 5/min/IP, 20/hr/IP   |
| `POST /api/auth/signup`               | 3/hr/IP              |
| `GET  /api/auth/tradovate/connect`    | 5/hr/user            |
| `GET  /api/auth/tradovate/callback`   | 10/hr/user           |
| `POST /api/telegram/link-token`       | 5/hr/user            |
| `POST /api/journal`                   | 60/min/user          |
| `POST /api/rules`                     | 30/min/user          |
| `POST /api/session/manual-event`      | 60/min/user          |
| `POST /api/guardian/status`           | 60/min/user          |

If Redis is not available, accept a coarser in-memory limiter for
single-instance deploys but keep a Redis adapter behind a feature
flag for horizontal scale.

### 2. Webhook authentication (HIGH)

- `/api/telegram/webhook` accepts any POST. Anyone with the URL can
  inject "messages" from a connected user and trigger AI-coach calls
  (cost) or alter trader-state writes.
  - **Fix:** require `X-Telegram-Bot-Api-Secret-Token` header to
    equal `process.env.TELEGRAM_WEBHOOK_SECRET`. Set the same secret
    via Telegram's `setWebhook` call. The env validator already warns
    when this var is missing.
- `/api/tradovate/webhook` is currently unimplemented. When wired,
  require Tradovate's signature scheme (TBD with provider) before
  acting on any payload.

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

### 7. CSP / frame protection (LOW)

No `Content-Security-Policy` or `X-Frame-Options` header was observed.
Add at minimum:

- `Content-Security-Policy: default-src 'self'; ...` (tune for the
  Tailwind/Next runtime).
- `X-Frame-Options: DENY` (or CSP `frame-ancestors 'none'`).
- `Referrer-Policy: strict-origin-when-cross-origin`.
- `X-Content-Type-Options: nosniff`.

### 8. Generic-error vs enumeration trade-off (LOW)

`/api/auth/signup` returns 409 with "an account with this email
already exists". This is intentional for UX but is also user
enumeration. Decision needed pre-launch:

- Keep current behaviour (UX-friendly, enumeration-permissive), or
- Switch to "If this email is new, you'll receive a confirmation
  link" (privacy-friendly, requires email flow).

### 9. Debug routes guard (LOW)

Routes under `/api/debug/*` and `/api/dev/*` should be gated by
`NODE_ENV !== "production"` or a feature flag. Audit each route and
return 404 in production if not explicitly enabled.

### 10. IP/UA pinning (consider, not required)

Current sessions are bearer tokens — they ride along with whatever
client presents the cookie. Consider binding sessions to a coarse
IP block or user-agent family for high-risk operations (broker
connect, password change). Increases friction for users on cellular
networks; weigh carefully.

## What MUST be done before real users connect a broker

A minimum-viable checklist:

1. Rate limiting on `/api/auth/login`, `/api/auth/signup`,
   `/api/auth/tradovate/connect`, `/api/auth/tradovate/callback`,
   `/api/telegram/link-token`. (See §1.)
2. Telegram webhook secret (`TELEGRAM_WEBHOOK_SECRET`) wired and
   enforced. (See §2.)
3. Stripe webhook signature verification confirmed. (See §3.)
4. Session rotation on password change. (See §4.)
5. CSP / frame headers added. (See §7.)
6. Debug/dev routes confirmed disabled in production. (See §9.)
7. Re-run the audit against the current branch before flipping any
   capability from `requires_oauth` / `coming_soon` to `available`
   in the broker registry.

Items 5, 6, 8, and 10 from the open-gaps list are recommended but not
strictly blocking.
