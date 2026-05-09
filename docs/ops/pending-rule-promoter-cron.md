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

## Railway setup

1. Open your service in the Railway dashboard.
2. Go to **Settings → Cron Jobs → Add cron job**.
3. Fill in:
   - **Schedule**: `*/10 * * * *`
   - **Method**: POST
   - **Path**: `/api/cron/promote-pending-rules`
   - **Headers**: `x-cron-secret: <value of CRON_SECRET>`
4. Save. The job will first fire within 10 minutes.

### railway.toml (alternative)

```toml
[[crons]]
name     = "promote-pending-rules"
schedule = "*/10 * * * *"
path     = "/api/cron/promote-pending-rules"
method   = "POST"
[crons.headers]
x-cron-secret = "$CRON_SECRET"
```

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
