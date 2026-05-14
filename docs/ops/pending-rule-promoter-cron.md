# Pending-Rule Promoter Cron

`POST /api/cron/promote-pending-rules`

## What it does

When a user saves Trading Plan rules while their account is in an active CME
trading session, the change is stored as **pending** (`pendingPayloadJson` +
`pendingEffectiveDate`) rather than applied immediately. This cron activates
those pending changes once it is safe to do so.

"Safe" is determined per-row by `canActivateRulesNow` in
`src/lib/rule-activation-window.ts`:

| Condition | Safe? |
|---|---|
| CME maintenance window (Mon–Thu 16:00–17:00 CT) | Yes |
| CME weekend close (Fri 16:00 CT – Sun 17:00 CT) | Yes |
| CME market closed (overnight / holiday) | Yes |
| Account scope: account is STOPPED or in cooldown | Yes |
| Account scope: account is actively trading | No — retry next tick |
| Default scope: no inheriting account is active | Yes |
| Default scope: any inheriting account is active | No — retry next tick |

Promotion is **idempotent**: re-running on an already-promoted row is a no-op
(the pending columns are already null after a successful promotion).

## What it does NOT do

- No Tradovate API calls. No broker actions of any kind.
- Does not disable, lock, or flatten any account.
- Does not touch `AccountRiskRules` when promoting a `RiskRules` (default
  template) row, and vice versa.
- Does not backfill missing rules or create new rows.

## Chosen deployment: Railway native HTTP cron (no separate service)

### Why not a separate Railway cron service?

The repository contains `railway.json` with a top-level `deploy.startCommand`.
Railway config-as-code overrides dashboard settings, so any separate Railway
cron service that shares this repository would also be forced to run
`npm run start:railway` — the full Next.js web server — instead of a
short-lived cron task. This makes a separate cron service unsafe to configure
without modifying `railway.json` in a way that would break the web service.

### The right approach: Railway HTTP cron trigger

Railway supports **cron jobs that call an HTTP endpoint** directly, with no
separate service needed. The cron trigger is attached to the existing web
service and calls the route on a schedule. The web service is already running;
Railway just POSTs to it periodically.

**Setup steps:**

1. Open the `guardrail-web` service in the Railway dashboard.
2. Go to **Settings → Cron Jobs → Add cron job**.
3. Fill in:
   - **Schedule**: `*/10 * * * *`  (every 10 minutes)
   - **Method**: `POST`
   - **Path**: `/api/cron/promote-pending-rules`
   - **Headers**: `x-cron-secret: $CRON_SECRET`
4. Save. The first execution fires within 10 minutes.

Railway resolves `$CRON_SECRET` from the service's environment variables, so
the header value does not need to be hard-coded in the dashboard.

### Alternative: external cron service

If Railway's built-in cron is unavailable (plan limitation) or you prefer an
external monitor, use any HTTPS-capable scheduler (cron-job.org free tier,
GitHub Actions scheduled workflow, etc.):

```
Method:  POST
URL:     https://guardrail-trade.com/api/cron/promote-pending-rules
Header:  x-cron-secret: <value of CRON_SECRET>
Schedule: every 10 minutes  (*/10 * * * *)
```

A standalone Node.js runner script is provided for environments where a
script-based runner is easier than raw HTTP:

```sh
# Requires APP_URL and CRON_SECRET in the environment.
npm run cron:promote
# or directly:
node scripts/cron-promote-pending-rules.mjs
```

The script calls the endpoint, logs the result (including per-row skip
reasons), and exits 0 on success / 1 on failure.

### GitHub Actions example

```yaml
# .github/workflows/promote-pending-rules.yml
on:
  schedule:
    - cron: "*/10 * * * *"
  workflow_dispatch:

jobs:
  promote:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger pending-rule promoter
        run: |
          curl -sf -X POST "$APP_URL/api/cron/promote-pending-rules" \
            -H "x-cron-secret: $CRON_SECRET" | jq .
        env:
          APP_URL: ${{ secrets.APP_URL }}
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
```

## Required environment variable

```
CRON_SECRET=<long-random-string>
```

Generate a value once and store it in Railway's environment config:

```sh
openssl rand -hex 32
```

The same variable is shared with the existing `tradovate-sync` cron.

## Recommended cadence

Every **10 minutes**. The safety window boundary only moves when the CME
session changes (maintenance/open/close), so running more often than every
5 minutes provides no benefit. Running every 10–15 minutes is sufficient.

## Manual test

Replace `$APP_URL` and `$CRON_SECRET` with your actual values.

```sh
curl -s -X POST "$APP_URL/api/cron/promote-pending-rules" \
  -H "x-cron-secret: $CRON_SECRET" | jq .
```

Expected success response (HTTP 200):

```json
{
  "ok": true,
  "promotedDefaultCount": 0,
  "promotedAccountCount": 1,
  "skippedCount": 0,
  "skippedNotSafeCount": 2,
  "skippedRows": [
    {
      "id": "acct-demo7433035",
      "scope": "account",
      "pendingEffectiveDate": "2026-05-09",
      "canActivateNow": false,
      "skipReason": "account_active"
    }
  ],
  "failedCount": 0,
  "errors": []
}
```

| Field | Meaning |
|---|---|
| `promotedDefaultCount` | Default-template (RiskRules) rows promoted |
| `promotedAccountCount` | Account-override (AccountRiskRules) rows promoted |
| `skippedCount` | Rows skipped because pending was already cleared or malformed |
| `skippedNotSafeCount` | Rows skipped because the account is still in active trading |
| `skippedRows` | Per-row detail: id, scope, pendingEffectiveDate, skipReason |
| `failedCount` | Rows where promotion threw — pending columns left intact for retry |
| `errors` | Per-row error details (rowId, scope, message) |

Auth failure response (HTTP 401):

```json
{ "error": "unauthorized" }
```

Fatal response (HTTP 500, should not occur in normal operation):

```json
{ "error": "promotion_failed", "message": "..." }
```

## Verifying promoted rows

After a successful promotion the pending columns are cleared. Confirm in the
Railway Postgres console (or via your DB explorer):

```sql
-- Should return 0 rows if promotion ran cleanly
SELECT id, "accountId", "pendingPayloadJson", "pendingEffectiveDate"
FROM "AccountRiskRules"
WHERE "pendingPayloadJson" IS NOT NULL;

SELECT id, "userId", "pendingPayloadJson", "pendingEffectiveDate"
FROM "RiskRules"
WHERE "pendingPayloadJson" IS NOT NULL;
```

Promoted rows will have `pendingPayloadJson = NULL` and their active columns
(`allowedEndHour`, `maxDailyLoss`, etc.) updated to the values that were in
the pending payload.

## Diagnosing past-due rows that didn't promote

Use `skippedRows` in the response. Common `skipReason` values:

| skipReason | Meaning |
|---|---|
| `account_active` | Account is in active CME trading — safe window not open yet |
| `default_inheriting_account_active` | An inheriting account is live — default won't activate until all are safe |
| `no_pending` | Payload was already cleared (idempotent — no action needed) |
| `invalid_payload` | JSON blob is not a plain object (data corruption) |
| `invalid_date` | `pendingEffectiveDate` is not a valid YYYY-MM-DD string |
| `default_row_has_delete_payload` | Default-template row carries `__delete` sentinel — should never happen |

## Server logs

The cron route emits a structured log line only when at least one row was
promoted or failed (no-op runs are silent):

```
[cron/promote-pending-rules] done {
  promotedDefaultCount: 0,
  promotedAccountCount: 1,
  skippedCount: 0,
  skippedNotSafeCount: 0,
  failedCount: 0,
  errors: []
}
```

Fatal errors are logged at the `error` level:

```
[cron/promote-pending-rules] fatal error { message: "..." }
```

## Security notes

- The endpoint returns JSON that never includes the `CRON_SECRET` value.
- All responses use the same `{ error: "unauthorized" }` body regardless of
  whether `CRON_SECRET` is unset or the supplied header is wrong, to avoid
  leaking configuration state.
- The route is stateless: it reads from and writes to the application DB only.
  No external HTTP calls are made.

## railway.json — why it is web-service-only

The repo root `railway.json` configures the **web service only**:

```json
{
  "build": { "builder": "NIXPACKS", "buildCommand": "npm run build" },
  "deploy": {
    "startCommand": "npm run start:railway",
    "healthcheckPath": "/api/health",
    "healthcheckTimeout": 300,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

`startCommand: "npm run start:railway"` runs Prisma migrations then starts the
Next.js server. This is correct for the web service. **Do not attach a separate
Railway cron service to this repo** — it would inherit this start command and
launch a full web server on every cron tick, which is wrong.

The cron is triggered via the Railway HTTP cron feature (or external scheduler)
as described above. No second service is needed.
