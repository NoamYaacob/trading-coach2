# Deployment Runbook

Operational reference for deploying Guardrail AI (trading-coach-v2) to production.

---

## Requirements

| Requirement | Notes |
|---|---|
| Node.js 18+ | Next.js 16 minimum requirement |
| PostgreSQL | Any modern version; app uses `pg` pool |
| Outbound HTTPS to `api.telegram.org` | Required for Telegram coaching messages |

---

## Environment Variables

Copy `.env.example` and fill in real values. All variables are server-only except where noted.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string (`postgresql://user:pass@host:5432/db`) |
| `NODE_ENV` | Yes (prod) | Set to `production` — enables `Secure` flag on session cookies |
| `APP_URL` | Yes | Public origin, e.g. `https://guardrail-trade.com` — used for OAuth redirects |
| `NEXT_PUBLIC_APP_URL` | Yes | Same value as `APP_URL`; exposed to the browser |
| `ANTHROPIC_API_KEY` | Yes | Claude API key — required for AI coaching features |
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from @BotFather |
| `TELEGRAM_BOT_USERNAME` | Recommended | Bot username without `@` — used to generate invite links |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | Optional | Client-side fallback for `TELEGRAM_BOT_USERNAME` |
| `CRON_SECRET` | Yes | Long random string that authorises scheduled job calls (see [Scheduled Jobs](#scheduled-jobs)) |
| `TRADOVATE_CLIENT_ID` | Yes (Tradovate) | OAuth app ID from the Tradovate developer portal |
| `TRADOVATE_CLIENT_SECRET` | Yes (Tradovate) | OAuth app secret |
| `TRADOVATE_TOKEN_ENCRYPTION_KEY` | Yes (Tradovate) | Base64-encoded 32-byte AES-256 key — generate with `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` | Yes (Google login) | Google OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | Yes (Google login) | Google OAuth 2.0 client secret |

`DATABASE_URL` and `TELEGRAM_BOT_TOKEN` are validated at startup. The app will refuse to start if either is missing.

---

## First-Time Deploy

Run these steps in order on a fresh environment.

```bash
# 1. Install dependencies
npm install

# 2. Apply schema to database (creates all tables)
npm run prisma:push

# 3. Build — prisma generate runs automatically
npm run build

# 4. Start
npm start
```

The server starts on port 3000 by default. To use a different port:

```bash
npm start -- -p 8080
```

---

## Redeployment

```bash
npm install
npm run prisma:push        # only if schema changed
npm run build              # prisma generate runs automatically
npm start                  # restart the process
```

If you are managing the process with a supervisor (systemd, PM2, etc.), restart it after `npm run build`.

---

## Database Notes

The project uses `prisma db push` — schema changes are applied directly without a migration history file. This is intentional for early-stage deployment.

**`npm run prisma:push`** — syncs the schema, safe to re-run, does not reset data.

**`npm run prisma:migrate`** — runs `prisma migrate deploy`. This requires a `prisma/migrations` directory. If you want to adopt formal migrations:

```bash
# Run once on a dev database to create the baseline migration
npx prisma migrate dev --name init
# Commit the generated prisma/migrations/ directory
# From that point, use prisma:migrate for production deploys
```

Until a migrations directory is committed, use `prisma:push`.

---

## Health Check

```
GET /api/health
```

Returns `200` when the app is healthy, `503` when something is wrong.

**Healthy response:**
```json
{ "ok": true, "env": "ok", "db": "ok" }
```

**Degraded response (example):**
```json
{
  "ok": false,
  "env": "missing_vars",
  "missing": ["TELEGRAM_BOT_TOKEN"],
  "warnings": ["NODE_ENV is not 'production' — session cookies will not be marked Secure"],
  "db": "ok"
}
```

Wire `/api/health` into your load balancer or container orchestrator health check. It verifies env validation and a live DB connection (`SELECT 1`) on every call.

---

## Telegram Webhook

The Telegram bot uses webhooks, not polling. After deploy, register the webhook once:

```bash
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=https://your-domain.com/api/telegram/webhook"
```

Expected response: `{"ok":true,"result":true,"description":"Webhook was set"}`

The webhook endpoint is `/api/telegram/webhook` (POST). Telegram sends all bot messages there.

**To verify the current webhook:**
```bash
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

Re-register the webhook any time the domain changes.

---

## Scheduled Jobs

The app exposes a single cron endpoint for background data refresh:

```
POST /api/cron/tradovate-sync
Header: x-cron-secret: <CRON_SECRET>
```

This endpoint syncs all active Tradovate accounts whose data is older than 5 minutes, keeping balance, daily P&L, fills, and account status current without requiring users to click Refresh.

**What it does:** queries all connected Tradovate broker connections, filters to those with stale `protected` / `monitor_only` accounts, and calls `syncTradovateConnection()` for each sequentially. Returns `{ ok, synced, failed, skipped }`.

**Security:** the endpoint rejects all requests if `CRON_SECRET` is not set in the environment, and rejects any request whose `x-cron-secret` header does not match exactly. Set `CRON_SECRET` to at least 32 random characters — never reuse a value from another service.

Generate a secret:
```bash
openssl rand -base64 32
```

### Scheduling on Railway (recommended)

The project ships `scripts/cron-tradovate-sync.mjs` — a tiny Node.js script that
calls the endpoint using built-in `fetch`. No extra packages or `curl` required.

**One-time setup:**

1. In your Railway project → **New** → **Empty Service** (or "Cron Job" if available)
2. Connect it to the same repository
3. Set the **Start Command**: `npm run cron:sync`
4. Set the **Deploy Trigger** / **Schedule**: `*/5 * * * *`
5. Add these variables on the Cron service:

   | Variable | Value |
   |---|---|
   | `APP_URL` | `https://guardrail-trade.com` |
   | `CRON_SECRET` | Same value as on the app service |

The script exits with code 1 on any failure (network error, wrong status, missing env),
so Railway marks the cron run as failed and surfaces it in the dashboard.

**Test before enabling the schedule:**
```bash
APP_URL=https://guardrail-trade.com CRON_SECRET=<your-secret> npm run cron:sync
# Expected: [cron] Done — synced: 0 skipped: <n> failed: 0
```

Alternatively, use an external scheduler (cron-job.org, Upstash QStash) with the same
POST + `x-cron-secret` header if you prefer zero-code setup.

### Scheduling on Vercel

Add a `crons` block to `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/tradovate-sync",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

Vercel sends a `Authorization: Bearer <CRON_SECRET>` header automatically when you set `CRON_SECRET` in the project's environment variables. The endpoint also accepts this as `x-cron-secret` — if you use Vercel's native cron, update the endpoint to check the `Authorization` header as well, or configure the Vercel cron to send a custom header.

> **Tip:** verify the endpoint manually before enabling the schedule:
> ```bash
> curl -s -X POST https://<your-domain>/api/cron/tradovate-sync \
>   -H "x-cron-secret: $CRON_SECRET" | jq .
> ```
> Expected response when all accounts are fresh: `{"ok":true,"synced":0,"skipped":<n>}`

---

## Sessions

- Sessions are stored in the PostgreSQL `Session` table — no external session store needed.
- Cookies are HTTP-only, `SameSite=lax`, 30-day TTL.
- The `Secure` flag is set only when `NODE_ENV=production`. Without it, sessions work over HTTP but browsers will not send cookies to HTTPS-only endpoints.
- No JWT secret or signing key is required — tokens are hashed with SHA-256 and stored in the database.

---

## Deploying to Railway

Railway is the primary deployment target. The project ships a `railway.json` that configures build, start, health check, and restart policy automatically.

### One-time setup

**1. Create the project**

```bash
# Install Railway CLI if needed
npm install -g @railway/cli
railway login
railway init
```

Or create the project from the Railway dashboard.

**2. Add a PostgreSQL service**

In the Railway dashboard: **New** → **Database** → **PostgreSQL**.

Railway injects `DATABASE_URL` automatically into your app service. No manual copy-paste needed.

**3. Set environment variables**

In the Railway dashboard, open your app service → **Variables** and add:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `APP_URL` | Your public domain, e.g. `https://guardrail-trade.com` |
| `NEXT_PUBLIC_APP_URL` | Same as `APP_URL` |
| `ANTHROPIC_API_KEY` | Claude API key |
| `TELEGRAM_BOT_TOKEN` | Your bot token from @BotFather |
| `TELEGRAM_BOT_USERNAME` | Your bot username without `@` |
| `CRON_SECRET` | Output of `openssl rand -base64 32` |
| `TRADOVATE_CLIENT_ID` | From the Tradovate developer portal |
| `TRADOVATE_CLIENT_SECRET` | From the Tradovate developer portal |
| `TRADOVATE_TOKEN_ENCRYPTION_KEY` | Output of `openssl rand -base64 32` (separate key from `CRON_SECRET`) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |

`DATABASE_URL` is provided automatically by the PostgreSQL plugin. Railway sets `PORT` automatically — Next.js reads it.

**4. Deploy**

```bash
railway up
```

Or push to the connected GitHub branch if auto-deploy is enabled.

### What happens on every deploy

`railway.json` drives the full flow:

| Step | Command |
|---|---|
| Build | `prisma generate && next build` |
| Start | `prisma db push && next start` |
| Health check | `GET /api/health` — must return 200 before traffic is routed |

`prisma db push` runs before `next start` on each deploy. It is idempotent — safe to run on restarts — and ensures the schema is always in sync with the connected database.

### After the first deploy — register the Telegram webhook

Railway assigns a public domain once the service is live. Find it in **Settings** → **Domains**.

```bash
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=https://your-railway-domain.up.railway.app/api/telegram/webhook"
```

Verify:
```bash
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

Re-register any time the domain changes (e.g. when switching from the default `.up.railway.app` domain to a custom domain).

### Switching to formal migrations

When you are ready to adopt `prisma migrate` (migration history files checked into the repo), update the start command in both `package.json` and `railway.json`:

```
# package.json
"start:railway": "prisma migrate deploy && next start"

# railway.json deploy.startCommand
"startCommand": "npm run start:railway"
```

Create the migration baseline first on a dev database:
```bash
npx prisma migrate dev --name init
```
Commit `prisma/migrations/` before deploying.

---

## Production Checklist

Run through this before and after every deploy.

**Environment**
- [ ] `DATABASE_URL` is set and the database is reachable
- [ ] `NODE_ENV=production` is set
- [ ] `APP_URL` and `NEXT_PUBLIC_APP_URL` are set to the public domain
- [ ] `ANTHROPIC_API_KEY` is set
- [ ] `TELEGRAM_BOT_TOKEN` is set
- [ ] `TELEGRAM_BOT_USERNAME` is set (invite links will not work without it)
- [ ] `CRON_SECRET` is set to a strong random value (min 32 chars)
- [ ] `TRADOVATE_CLIENT_ID`, `TRADOVATE_CLIENT_SECRET`, `TRADOVATE_TOKEN_ENCRYPTION_KEY` are set
- [ ] `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set

**Build**
- [ ] `npm run build` completed without errors (`prisma generate` runs automatically as part of build)
- [ ] Schema synced — `prisma db push` applied, or `prisma migrate deploy` if using formal migrations

**Runtime**
- [ ] App started without errors in the process log
- [ ] `GET /api/health` returns `{"ok":true,"env":"ok","db":"ok"}`

**Telegram**
- [ ] Webhook is registered to `https://your-domain.com/api/telegram/webhook`
- [ ] `getWebhookInfo` confirms the URL and shows `pending_update_count: 0`

**Scheduled jobs**
- [ ] Cron job configured to `POST /api/cron/tradovate-sync` with `x-cron-secret` header every 2–5 minutes
- [ ] Manual smoke test: `curl -X POST https://<domain>/api/cron/tradovate-sync -H "x-cron-secret: $CRON_SECRET"` returns `200 {"ok":true,...}`
- [ ] Unauthenticated call returns `401` (verify with `curl -X POST https://<domain>/api/cron/tradovate-sync`)

**Smoke test**
- [ ] Login page loads and a session can be created
- [ ] Dashboard loads for a logged-in user
- [ ] Guardian page loads
- [ ] Telegram bot responds to a message (if bot token is set)

---

## Railway Staging Launch Checklist

Sequential steps for the first Railway deployment. Work through top to bottom — each step depends on the previous.

### 1. Infrastructure

- [ ] Railway project created (dashboard **New Project**, or `railway init` via CLI)
- [ ] PostgreSQL service added: **New → Database → PostgreSQL**
- [ ] App service connected to this repository (or `railway up` from local)

### 2. Environment variables

Open app service → **Variables** in the Railway dashboard.

- [ ] `NODE_ENV` — set to `production`
- [ ] `APP_URL` — public domain, e.g. `https://guardrail-trade.com`
- [ ] `NEXT_PUBLIC_APP_URL` — same value as `APP_URL`
- [ ] `ANTHROPIC_API_KEY` — Claude API key
- [ ] `TELEGRAM_BOT_TOKEN` — bot token from @BotFather
- [ ] `TELEGRAM_BOT_USERNAME` — bot username without `@`
- [ ] `CRON_SECRET` — output of `openssl rand -base64 32`
- [ ] `TRADOVATE_CLIENT_ID` — from the Tradovate developer portal
- [ ] `TRADOVATE_CLIENT_SECRET` — from the Tradovate developer portal
- [ ] `TRADOVATE_TOKEN_ENCRYPTION_KEY` — output of `openssl rand -base64 32` (keep separate from `CRON_SECRET`)
- [ ] `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — from Google Cloud Console
- [ ] `DATABASE_URL` — confirm it appears in Variables (Railway injects this from the PostgreSQL service; if missing, the two services are not linked)

### 3. Deploy

- [ ] Trigger deploy: `railway up`, or push to the connected branch
- [ ] Build log shows `prisma generate` completed
- [ ] Build log shows `next build` completed without errors
- [ ] Start log shows `prisma db push` applied without errors
- [ ] Start log shows the app started on the assigned PORT

### 4. Health check

- [ ] Railway dashboard shows the deploy as **Active** (not Failed or Crashed)
- [ ] `GET https://<your-domain>/api/health` returns `{"ok":true,"env":"ok","db":"ok"}`

If the response has a `warnings` array, address each one before continuing. A `NODE_ENV` warning means session cookies are not secure. A `TELEGRAM_BOT_USERNAME` warning means invite links will not work.

### 5. Telegram webhook

- [ ] Railway domain found: app service → **Settings → Domains**
- [ ] Webhook registered:
  ```bash
  curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=https://<your-domain>/api/telegram/webhook"
  ```
  Expected: `{"ok":true,"result":true,"description":"Webhook was set"}`
- [ ] Verified:
  ```bash
  curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
  ```
  The `url` field should match your Railway domain. `pending_update_count` should be `0`.

### 6. Cron job

- [ ] Railway project → **New** → **Empty Service**, connected to this repo
- [ ] Start Command: `npm run cron:sync`
- [ ] Schedule: `*/5 * * * *`
- [ ] Variables on the Cron service: `APP_URL=https://<your-domain>`, `CRON_SECRET=<same value as app service>`
- [ ] Test locally before enabling:
  ```bash
  APP_URL=https://<your-domain> CRON_SECRET=<secret> npm run cron:sync
  # Expected: [cron] Done — synced: 0 skipped: <n> failed: 0
  ```
- [ ] Verify auth check: an unauthenticated POST returns HTTP 401
  ```bash
  curl -s -o /dev/null -w "%{http_code}" -X POST https://<your-domain>/api/cron/tradovate-sync
  # Expected: 401
  ```

### 7. Smoke test

- [ ] `/` — landing page loads
- [ ] `/login` — login page loads; sign in succeeds and a session cookie is set
- [ ] `/dashboard` — dashboard loads for the authenticated user
- [ ] `/guardian` — Guardian page loads
- [ ] Telegram — send a message to the bot; it replies
- [ ] Telegram — send `/start <token>` to link an account (test the full connect flow at least once)

If all seven groups pass, the staging deployment is live.
