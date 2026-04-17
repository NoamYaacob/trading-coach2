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
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from @BotFather |
| `TELEGRAM_BOT_USERNAME` | Recommended | Bot username without `@` — used to generate invite links |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | Optional | Client-side fallback for `TELEGRAM_BOT_USERNAME` |
| `NODE_ENV` | Yes (prod) | Set to `production` — enables `Secure` flag on session cookies |

`DATABASE_URL` and `TELEGRAM_BOT_TOKEN` are validated at startup. The app will refuse to start if either is missing.

---

## First-Time Deploy

Run these steps in order on a fresh environment.

```bash
# 1. Install dependencies
npm install

# 2. Generate Prisma client (must happen before build)
npm run prisma:generate

# 3. Apply schema to database (creates all tables)
npm run prisma:push

# 4. Build
npm run build

# 5. Start
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
npm run prisma:generate
npm run prisma:push        # only if schema changed
npm run build
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

## Sessions

- Sessions are stored in the PostgreSQL `Session` table — no external session store needed.
- Cookies are HTTP-only, `SameSite=lax`, 30-day TTL.
- The `Secure` flag is set only when `NODE_ENV=production`. Without it, sessions work over HTTP but browsers will not send cookies to HTTPS-only endpoints.
- No JWT secret or signing key is required — tokens are hashed with SHA-256 and stored in the database.

---

## Production Checklist

Run through this before and after every deploy.

**Environment**
- [ ] `DATABASE_URL` is set and the database is reachable
- [ ] `TELEGRAM_BOT_TOKEN` is set
- [ ] `TELEGRAM_BOT_USERNAME` is set (invite links will not work without it)
- [ ] `NODE_ENV=production` is set

**Build**
- [ ] `npm run prisma:generate` completed without errors
- [ ] `npm run prisma:push` applied (or migration deployed if using formal migrations)
- [ ] `npm run build` completed without errors

**Runtime**
- [ ] App started (`npm start`) without errors in the process log
- [ ] `GET /api/health` returns `{"ok":true,"env":"ok","db":"ok"}`

**Telegram**
- [ ] Webhook is registered to `https://your-domain.com/api/telegram/webhook`
- [ ] `getWebhookInfo` confirms the URL and shows `pending_update_count: 0`

**Smoke test**
- [ ] Login page loads and a session can be created
- [ ] Dashboard loads for a logged-in user
- [ ] Guardian page loads
- [ ] Telegram bot responds to a message (if bot token is set)
