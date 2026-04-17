# Guardrail AI — trading-coach-v2

Real-time trading discipline enforcer. Monitors sessions, applies configured risk rules via Guardian, and delivers coaching through a Telegram bot.

---

## Development

```bash
cp .env.example .env.local   # fill in DATABASE_URL and TELEGRAM_BOT_TOKEN at minimum
npm install
npm run prisma:generate
npm run prisma:push           # create tables
npm run dev                   # http://localhost:3000
```

## Production

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the full runbook, environment variable reference, Telegram webhook setup, and production checklist.

**Quick summary:**

```bash
npm install
npm run prisma:generate
npm run prisma:push
npm run build
npm start
curl http://localhost:3000/api/health
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Development server (Turbopack) |
| `npm run build` | Production build |
| `npm start` | Start production server |
| `npm run prisma:generate` | Regenerate Prisma client after schema changes |
| `npm run prisma:push` | Sync schema to database (development / first deploy) |
| `npm run prisma:migrate` | Apply pending migrations (production, requires migration history) |
| `npm run lint` | Run ESLint |
