# Tradovate Token Renewal Cron Service

Proactively renews Tradovate access tokens for active broker connections whose
tokens are expiring within the next 25 minutes.  Runs independently of account
sync so tokens stay fresh even during off-hours when no sync is needed.

---

## Railway service: `tradovate-token-renew-cron`

| Setting | Value |
|---|---|
| **Root directory** | `railway-cron-config/` |
| **Start command** | `node scripts/cron-renew-tradovate-tokens.mjs` |
| **Schedule** | `*/10 * * * *` (every 10 minutes) |
| **Healthcheck** | none — cron services exit after each run |

The root directory is set to `railway-cron-config/` in the Railway dashboard
so the service picks up `railway-cron-config/railway.json` rather than the
root `railway.json` (which is the web service config).

### Required environment variables

| Variable | Notes |
|---|---|
| `APP_URL` | Public origin, e.g. `https://guardrail-trade.com` |
| `CRON_SECRET` | Must match `CRON_SECRET` on the web service |

`DATABASE_URL` is **not** needed — the script only calls the web service's
HTTP endpoint; the web service owns the database connection.

---

## How it works

1. Railway invokes `node scripts/cron-renew-tradovate-tokens.mjs` on the schedule.
2. The script POSTs to `$APP_URL/api/cron/renew-tradovate-tokens` with
   `x-cron-secret: $CRON_SECRET`.
3. The web service renews any connections whose `tokenExpiresAt` is `null` or
   within 25 minutes, using `ensureTradovateAccessToken`.
4. Returns `{ checked, renewed, skipped, failed, errors }`.
5. The script exits 0 on success or transient renewal failures (retried next
   run); exits 1 only on HTTP-level failure so Railway marks the run as failed.

---

## Why a separate root directory

Railway's `railway.json` applies to every service that deploys from the same
root.  A single `deploy.startCommand` in the root `railway.json` would force
the cron service to run `npm run start:railway` instead of the cron script.

By pointing the cron service at `railway-cron-config/` as its root directory,
Railway reads `railway-cron-config/railway.json` for that service, which has
the correct `startCommand` and `cronSchedule`.

The root `railway.json` remains the web service config (start command
`npm run start:railway`, healthcheck `/api/health`).

---

## Renewal logic

- **Lookahead window**: 25 minutes.  Wider than the 15-minute internal refresh
  buffer so that connections expiring within two consecutive 10-minute cron
  intervals are always caught.
- **Pre-filter**: DB-level query on `tokenExpiresAt IS NULL OR tokenExpiresAt <=
  (now + 25 min)` — only active connections (`connected_readonly` or
  `connected_live`) are considered.
- **Delegation**: Each connection is passed to `ensureTradovateAccessToken`,
  which re-checks internally and is a no-op for already-fresh tokens.
- **Cascade heal**: On success, linked `ConnectedAccount` rows stuck at
  `"expired"` are healed to `"connected_readonly"`.
- **Cascade expire**: On repeated renewal failure, `BrokerConnection` and
  linked accounts are marked `"expired"` via `markExpiredWithAccounts`.
