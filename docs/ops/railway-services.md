# Railway Services

This project runs two services from the same GitHub repository.
`railway.json` defines only the build step and restart policy — it intentionally
omits `deploy.startCommand` and `deploy.healthcheckPath` so those settings can be
configured independently per service in the Railway dashboard (or per-service
`railway.json` overrides if you split the repo into multiple roots).

---

## Web service (`guardrail-web` or similar)

| Setting | Value |
|---|---|
| **Start command** | `npm run start:railway` |
| **Healthcheck path** | `/api/health` |
| **Healthcheck timeout** | `300` s |

The start command runs `prisma migrate deploy` before starting the Next.js
server, so the database schema is always up to date before the app accepts
traffic.

### Required environment variables

| Variable | Notes |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `CRON_SECRET` | Shared secret for cron auth headers |
| `APP_URL` | Public origin, e.g. `https://guardrail-trade.com` |
| `NEXTAUTH_SECRET` / `SESSION_SECRET` | Session signing key |
| Any other secrets referenced in the app | — |

---

## Cron service — `tradovate-token-renew-cron`

Proactively renews Tradovate access tokens for active broker connections whose
tokens are expiring within the next 25 minutes.  Runs independently of account
sync so tokens stay fresh even during off-hours when no sync is needed.

| Setting | Value |
|---|---|
| **Start command** | `node scripts/cron-renew-tradovate-tokens.mjs` |
| **Schedule** | `*/10 * * * *` (every 10 minutes) |
| **Healthcheck** | none — cron services exit after each run |

### Required environment variables

| Variable | Notes |
|---|---|
| `APP_URL` | Same public origin as the web service |
| `CRON_SECRET` | Must match `CRON_SECRET` on the web service |

`DATABASE_URL` is **not** needed on the cron service — it only calls the web
service's HTTP endpoint; the web service owns the database connection.

### How it works

1. Railway invokes `node scripts/cron-renew-tradovate-tokens.mjs` on the schedule.
2. The script POSTs to `$APP_URL/api/cron/renew-tradovate-tokens` with
   `x-cron-secret: $CRON_SECRET`.
3. The web service renews any tokens expiring within 25 minutes and returns a
   JSON summary (`checked`, `renewed`, `skipped`, `failed`, `errors`).
4. The script exits 0 on success or on transient renewal failures (retried next
   run); exits 1 only on HTTP-level failure so Railway marks the run as failed.

---

## Why startCommand is not in railway.json

Railway's config-as-code (`railway.json`) applies to **every service** that
deploys from this repository.  A single `deploy.startCommand` would override the
dashboard setting on the cron service, locking it to `npm run start:railway`
instead of the cron script.

By omitting `startCommand` (and the web-only `healthcheckPath` /
`healthcheckTimeout`) from `railway.json`, each service can set its own start
command and healthcheck in the Railway dashboard without being overridden.

The build step (`npm run build`) and restart policy (`ON_FAILURE`, max 10
retries) are safe to share across all services and remain in `railway.json`.
