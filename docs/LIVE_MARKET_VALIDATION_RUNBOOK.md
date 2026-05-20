# Live-Market Validation Runbook

**For: DEMO7433035 only**  
**Environment constraints (never change without explicit approval):**

| Flag | Required value |
|---|---|
| `ENFORCEMENT_DRY_RUN` | `true` |
| `BROKER_ENFORCEMENT_ENABLED` | `false` |
| `GUARDRAIL_INTERNAL_LOCK_ENABLED` | `false` |
| `TRADOVATE_LISTENER_ENABLE_LIVE` | `false` |
| `ENABLE_TRADOVATE_ORDER_ACTIONS` | `false` (or absent) |

No broker writes. No order/flatten/cancel actions. No env flag changes unless explicitly instructed.

---

## Debug Endpoint Security Summary

### Permitted endpoints (safe to call in validation)

| Endpoint | Auth gate | Safe? | Notes |
|---|---|---|---|
| `GET /api/debug/tradovate-listener/dry-run-violations` | session + x-cron-secret | ✅ read-only | Returns DryRunViolation rows for current user |
| `GET /api/debug/tradovate-listener/dry-run-summary` | session + x-cron-secret | ✅ read-only | Aggregate counts |
| `GET /api/debug/broker-enforcement-gates` | session + x-cron-secret | ✅ read-only | Gate evaluation — no writes, no broker calls |
| `GET /api/debug/broker-enforcement-simulation` | session + x-cron-secret + `BROKER_ENFORCEMENT_SIMULATION_ENABLED=true` | ✅ read-only | Simulation preview — no writes, no broker calls |
| `POST /api/debug/accounts/[id]/reset-session-state` | session + x-cron-secret (prod) | ✅ safe write | Resets riskState/lock state only; does not touch P&L, fills, or broker |
| `POST /api/guardian/enable` | session (user-scoped) | ✅ safe write | Toggles GuardianProfile.guardianEnabled for the calling user only; no broker writes |
| `POST /api/guardian/disable` | session (user-scoped) | ✅ safe write | Same — no broker writes |

### Conditional endpoint (disabled by default)

| Endpoint | Auth gate | Safe? | Notes |
|---|---|---|---|
| `POST /api/debug/tradovate-event` | session + isAdminEmail + `DEBUG_TRADOVATE_EVENT_INJECTION_ENABLED=true` + account allowlist | ✅ when all gates pass | Synthetic fill injection for test scenarios. See §Synthetic Fill Injection below. Does **not** call Tradovate. |

### Forbidden in production (do not call)

These endpoints exist in the codebase but must not be called during live validation:

| Endpoint | Reason |
|---|---|
| Any endpoint under `/api/debug/tradovate-listener/repair` | Triggers listener reconnect — use only when listener is broken |
| Any endpoint under `/api/debug/tradovate-listener/reattach` | Listener management — not part of validation |
| `/api/debug/tradovate-probe` | Makes live Tradovate API read calls |
| `/api/debug/tradovate-tokens` | Shows token details — security-sensitive |

---

## Synthetic Fill Injection (DEMO only)

To inject a test fill without a live broker event, the following env vars **must** be set in the staging/QA environment (never in production):

```
DEBUG_TRADOVATE_EVENT_INJECTION_ENABLED=true
DEBUG_EVENT_INJECTION_ACCOUNT_ALLOWLIST=7433035
```

If these are not set, the endpoint returns 404.

**Request:**
```
POST /api/debug/tradovate-event
Content-Type: application/json
Cookie: <admin session>

{
  "email": "<admin-email>",
  "externalAccountId": "7433035",
  "type": "fill",
  "data": {
    "id": "test-fill-001",
    "side": "Buy",
    "qty": 1,
    "price": 21500.00,
    "contractId": 3000001,
    "pnl": -50.00,
    "timestamp": "<ISO-8601-now>"
  }
}
```

**Verify the injected event is tagged synthetic:**
```sql
SELECT id, "externalTradeId", "eventType", "rawPayload"
FROM   "NormalizedTradeEvent"
WHERE  "accountId" = '$ACCT_ID'
  AND  "externalTradeId" = 'test-fill-001';
```
The `rawPayload` column must contain `"_debugInjection": {"synthetic": true, ...}`.

**Verify idempotency (submit same fill twice — count must stay 1):**
```sql
SELECT COUNT(*)
FROM   "NormalizedTradeEvent"
WHERE  "accountId" = '$ACCT_ID'
  AND  "externalTradeId" = 'test-fill-001';
```
Expected: 1. If 2, the dedup constraint is broken — stop validation.

---

## Pre-Flight: Account Lookup

Run once before any other step.

```sql
-- Find account UUID
SELECT id, label, "externalAccountId", "protectionStatus",
       "connectionStatus", "accountType", "isActive", "brokerConnectionId"
FROM   "ConnectedAccount"
WHERE  label ILIKE '%DEMO7433035%'
   OR  "externalAccountId" = '7433035';

-- Record the id as $ACCT_ID and the userId as $USER_ID.

-- Confirm active rules
SELECT u.email,
       rr."maxDailyLoss"    AS default_maxDailyLoss,
       rr."maxTradesPerDay" AS default_maxTradesPerDay,
       rr."stopAfterLosses" AS default_stopAfterLosses,
       arr."maxDailyLoss"   AS account_maxDailyLoss,
       arr."maxTradesPerDay" AS account_maxTradesPerDay,
       arr."stopAfterLosses" AS account_stopAfterLosses
FROM   "ConnectedAccount" ca
JOIN   "User" u  ON u.id = ca."userId"
LEFT JOIN "RiskRules" rr        ON rr."userId" = u.id
LEFT JOIN "AccountRiskRules" arr ON arr."accountId" = ca.id
WHERE  ca.id = '$ACCT_ID';
```

Write down the **effective maxDailyLoss** (account-level overrides default). This is the breach threshold for Steps 4–5.

---

## Safe Closed-Market Checks (run any time, no fills needed)

These checks are read-only and can be run before or after market hours.

### C1 — Baseline session state
```sql
SELECT "sessionDate", "dailyPnl", "tradesCount", "consecutiveLosses",
       "riskState", "cooldownActive", "lastTradeAt", "updatedAt"
FROM   "LiveSessionState"
WHERE  "accountId" = '$ACCT_ID';
```
Expected: `riskState = NORMAL`, `cooldownActive = false`.

### C2 — Listener health
```sql
SELECT bc."listenerStatus", bc."listenerLastEventAt",
       bc."listenerLastHeartbeatAt", bc."connectionStatus",
       bc."lastReconciliationAt", bc."lastReconciliationStatus"
FROM   "BrokerConnection" bc
JOIN   "ConnectedAccount" ca ON ca."brokerConnectionId" = bc.id
WHERE  ca.id = '$ACCT_ID';
```
Expected: `listenerStatus = connected`, `lastReconciliationStatus = success`.

### C3 — No active broker-enforcement rows
```sql
-- Active internal locks (should be 0 while GUARDRAIL_INTERNAL_LOCK_ENABLED=false)
SELECT COUNT(*) AS active_locks
FROM   "InternalLockEvent"
WHERE  "accountId" = '$ACCT_ID'
  AND  "clearedAt" IS NULL;

-- Recent GuardianInterventions — none should have broker fields set
SELECT "triggerType", "brokerLockStatus", "flattenStatus", "brokerEndpoint", "createdAt"
FROM   "GuardianIntervention"
WHERE  "accountId" = '$ACCT_ID'
ORDER  BY "createdAt" DESC
LIMIT  5;
```
Expected: 0 active locks. All `brokerEndpoint = null` and `brokerLockStatus` is null/`dry_run`/`not_requested`.

### C4 — Safety Console
Navigate to `/debug/safety-console` (admin session).

| Section | Expected state |
|---|---|
| Overall | Green ("All safety checks passing") or at most informational |
| Enforcement flags | `BROKER_ENFORCEMENT_ENABLED=false`, `ENFORCEMENT_DRY_RUN=true` confirmed |
| Listener health | `connected`, recent heartbeat |
| Account summary | DEMO7433035 `riskState=NORMAL` |
| Rule edit audit | No rows, or rows from prior tests only |

### C5 — Confirm DryRunViolation count baseline
```sql
SELECT COUNT(*) AS today_violations
FROM   "DryRunViolation"
WHERE  "accountId" = '$ACCT_ID'
  AND  "tradingDay" = TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD');
```
Record this count. After injecting breach fills in open-market checks, this count should increase.

### C6 — No broker order logs
```sql
SELECT COUNT(*) AS broker_order_logs
FROM   "BrokerOrderActionLog"
WHERE  "accountId" = '$ACCT_ID'
  AND  "createdAt" >= CURRENT_DATE;
```
Expected: 0.

---

## Open-Market Checks (run during market hours or with synthetic fills)

These checks validate fill ingestion, state updates, and rule evaluation.

### O1 — Fill ingestion

**Before fill (baseline):**
```sql
SELECT COUNT(*) AS fill_count, MAX("occurredAt") AS last_fill
FROM   "NormalizedTradeEvent"
WHERE  "accountId" = '$ACCT_ID'
  AND  "occurredAt" >= CURRENT_DATE;
```

After a fill arrives (either real or synthetic), recheck. Count must increase by exactly 1.

```sql
SELECT id, "eventType", "externalTradeId", side, quantity, price, pnl, "occurredAt"
FROM   "NormalizedTradeEvent"
WHERE  "accountId" = '$ACCT_ID'
ORDER  BY "createdAt" DESC
LIMIT  3;
```

PASS: count +1, correct externalTradeId, correct pnl.  
FAIL: count unchanged (not ingested) or count +2 (dedup broken).

### O2 — Dashboard metrics update

```sql
SELECT "sessionDate", "dailyPnl", "tradesCount", "consecutiveLosses",
       "lastTradeAt", "riskState", "updatedAt"
FROM   "LiveSessionState"
WHERE  "accountId" = '$ACCT_ID';
```

| Metric | Expected |
|---|---|
| `tradesCount` | +1 from baseline |
| `dailyPnl` | Reflects fill pnl |
| `lastTradeAt` | ≈ fill occurredAt |
| `riskState` | NORMAL (unless breach) |
| `updatedAt` | Recent (seconds after fill) |

Also check loss budget:
```sql
SELECT ss."dailyPnl",
       COALESCE(arr."maxDailyLoss", rr."maxDailyLoss") AS "maxDailyLoss",
       COALESCE(arr."maxDailyLoss", rr."maxDailyLoss") + ss."dailyPnl" AS "remainingBudget",
       ROUND(
         ABS(ss."dailyPnl") / NULLIF(COALESCE(arr."maxDailyLoss", rr."maxDailyLoss"), 0) * 100,
         1
       ) AS "lossUsedPct"
FROM   "LiveSessionState" ss
JOIN   "ConnectedAccount" ca ON ca.id = ss."accountId"
JOIN   "User" u ON u.id = ca."userId"
LEFT JOIN "RiskRules" rr ON rr."userId" = u.id
LEFT JOIN "AccountRiskRules" arr ON arr."accountId" = ca.id
WHERE  ss."accountId" = '$ACCT_ID';
```

PASS: `remainingBudget` decreased, `lossUsedPct` increased.

### O3 — Dedup validation

Inject the same fill payload twice (same `externalTradeId`). Recheck count:
```sql
SELECT COUNT(*) FROM "NormalizedTradeEvent"
WHERE  "accountId" = '$ACCT_ID' AND "externalTradeId" = '<your-test-id>';
```
PASS: count = 1.  
FAIL: count = 2 — immediate stop.

### O4 — DryRunViolation on breach

Inject a fill with `pnl = -(maxDailyLoss + 1)` (or cumulative pnl exceeding the limit).

```sql
SELECT id, "ruleType", "thresholdAmount", "observedAmount",
       "dryRun", "actionWouldHaveTaken", "tradingDay", "createdAt"
FROM   "DryRunViolation"
WHERE  "accountId" = '$ACCT_ID'
  AND  "tradingDay" = TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')
ORDER  BY "createdAt" DESC
LIMIT  3;
```

PASS: Row exists, `dryRun=true`, `ruleType=daily_loss_limit`, `actionWouldHaveTaken=internal_lock`.  
FAIL: No row (evaluation skipped), or `brokerLockStatus=broker_locked` on any intervention row.

Also confirm no broker endpoint was called:
```sql
SELECT "triggerType", "brokerLockStatus", "brokerEndpoint", "flattenStatus"
FROM   "GuardianIntervention"
WHERE  "accountId" = '$ACCT_ID'
ORDER  BY "createdAt" DESC
LIMIT  3;
```
Expected: `brokerEndpoint = null` on every row.

### O5 — Guardian ON/OFF toggle

**With Guardian ON (default):** Breach fill → DryRunViolation written.  
**Disable Guardian:** `POST /api/guardian/disable`  
**Inject breach fill:** Count of DryRunViolation rows must NOT increase.  
**Re-enable Guardian:** `POST /api/guardian/enable`

```sql
-- Count before/after disable+fill:
SELECT COUNT(*) FROM "DryRunViolation"
WHERE  "accountId" = '$ACCT_ID'
  AND  "tradingDay" = TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD');
```

PASS: Count stays flat while Guardian is OFF.  
FAIL: Count increases while Guardian is OFF (master switch not respected).

Also verify fills still ingest during Guardian OFF:
```sql
SELECT COUNT(*) FROM "NormalizedTradeEvent"
WHERE  "accountId" = '$ACCT_ID' AND "occurredAt" >= NOW() - INTERVAL '5 minutes';
```
PASS: Count increases even while Guardian is OFF (ingestion is independent of evaluation).

### O6 — No broker writes

After all breach fills, confirm:
```sql
SELECT COUNT(*) FROM "BrokerOrderActionLog"
WHERE  "accountId" = '$ACCT_ID' AND "createdAt" >= CURRENT_DATE;
```
Expected: 0.

```sql
SELECT "brokerEndpoint", "brokerLockStatus", "flattenStatus"
FROM   "GuardianIntervention"
WHERE  "accountId" = '$ACCT_ID' AND "createdAt" >= CURRENT_DATE
  AND  "brokerEndpoint" IS NOT NULL;
```
Expected: 0 rows.

Enforcement gates endpoint (requires x-cron-secret header):
```
GET /api/debug/broker-enforcement-gates
```
For DEMO7433035's locks: `eligibleForBrokerEnforcement = false` and `gateFails` must include the env-disabled reason.

---

## Clean-Up

Run after completing all checks. Reset DEMO7433035 to a clean state for the demo.

```
POST /api/debug/accounts/$ACCT_ID/reset-session-state
Header: x-cron-secret: <CRON_SECRET>
```

Verify:
```sql
SELECT "riskState", "cooldownActive", "cooldownUntil", "tradesCount",
       "dailyPnl", "updatedAt"
FROM   "LiveSessionState"
WHERE  "accountId" = '$ACCT_ID';
```
Expected: `riskState = NORMAL`, `cooldownActive = false`.

> Note: `dailyPnl` and `tradesCount` are intentionally **preserved** — the reset only clears lock state, not P&L history.

```sql
-- Confirm all active locks cleared:
SELECT COUNT(*) FROM "InternalLockEvent"
WHERE  "accountId" = '$ACCT_ID' AND "clearedAt" IS NULL;
```
Expected: 0.

---

## GO / NO-GO Scorecard

| # | Check | Pass criteria | Status |
|---|---|---|---|
| C1 | Session state baseline | `riskState=NORMAL`, `cooldownActive=false` | ☐ |
| C2 | Listener healthy | `listenerStatus=connected`, recent heartbeat | ☐ |
| C3 | No active broker rows | 0 active InternalLockEvents, all `brokerEndpoint=null` | ☐ |
| C4 | Safety Console green | No new critical alerts | ☐ |
| C5 | DryRunViolation baseline | Count recorded | ☐ |
| C6 | No broker order logs | 0 rows today | ☐ |
| O1 | Fill ingested | NormalizedTradeEvent count +1 | ☐ |
| O2 | Dashboard metrics update | tradesCount, dailyPnl, remainingBudget all update | ☐ |
| O3 | Dedup | Second identical fill → count stays 1 | ☐ |
| O4 | DryRunViolation on breach | Row with `dryRun=true`, no `brokerEndpoint` | ☐ |
| O5a | Guardian ON evaluates rules | Breach → DryRunViolation written | ☐ |
| O5b | Guardian OFF allows sync | Fills ingest, no DryRunViolation | ☐ |
| O6 | No broker writes | 0 BrokerOrderActionLog rows, no brokerEndpoint on interventions | ☐ |
| O7 | Safety Console still safe | No new critical alerts after fill sequence | ☐ |
| O8 | RuleChangeAudit clean | 0 spurious rows from fill path | ☐ |

**GO:** All 15 checks pass.

**Immediate STOP (NO-GO) if any of these appear:**
- `brokerLockStatus = broker_locked` on any GuardianIntervention row
- Any row in BrokerOrderActionLog written today
- `brokerEndpoint` set on any GuardianIntervention
- Safety Console shows a new `critical` alert
- NormalizedTradeEvent count +2 for same externalTradeId (dedup broken)

---

## Futures Contract Metadata Verification

### Standard-equivalent ratios (source: CME product specs)

The Guardrail position-size limit uses standard-equivalent contract sizing so that
`maxContracts = 1` consistently means "1 full-size equivalent" regardless of whether
the user trades standard or micro contracts.

| Pair | Standard | Micro | Ratio | Source |
|---|---|---|---|---|
| E-mini / Micro E-mini S&P 500 | ES | MES | 10 MES = 1 ES | CME Group — Micro E-mini S&P 500 spec |
| E-mini / Micro E-mini Nasdaq-100 | NQ | MNQ | 10 MNQ = 1 NQ | CME Group — Micro E-mini Nasdaq-100 spec |
| E-mini / Micro E-mini Dow Jones | YM | MYM | 10 MYM = 1 YM | CME Group — Micro E-mini Dow Jones spec |
| E-mini / Micro E-mini Russell 2000 | RTY | M2K | 10 M2K = 1 RTY | CME Group — Micro E-mini Russell 2000 spec |

These ratios are encoded in `src/lib/futures/contracts.ts` as `exposureRatioToParent = 0.1` for each micro.

**DB verification — confirm the active rule is being applied with standard-equivalent math:**
```sql
SELECT arr."maxContracts" AS configured_limit,
       ca.label,
       ss."dailyPnl"
FROM   "ConnectedAccount" ca
JOIN   "LiveSessionState" ss ON ss."accountId" = ca.id
LEFT JOIN "AccountRiskRules" arr ON arr."accountId" = ca.id
WHERE  ca.id = '$ACCT_ID';
```
`maxContracts = 1` means up to 10 MNQ, 10 MES, 10 MYM, or 10 M2K can be held simultaneously (1 standard-equivalent each).

### UI copy verification

**Must say (monitored, not broker-pretrade-blocked):**
```
"Position size limit" or "Max position size, standard-equivalent"
```

**Must NOT say:**
- "Broker pre-trade blocked"
- "Hard limit at broker"
- "Broker enforced position limit"

The UI copy "Position size limit" chip (from `buildRuleSummaryChips`) is advisory.
Guardrail monitors position size but does not pre-trade block at the broker.

**Confirm in the dashboard chips source:**
```
grep -n "max_contracts\|Position size" src/lib/rules/rule-summary-chips.ts
```
Expected: `"Position size limit"` — not a broker-backed claim.

### Unknown symbols — safe fallback

Any symbol not in the `contracts.ts` registry uses `exposureRatioToParent = 1` (1:1 mapping — never understates exposure). This is the safe fallback: an unknown micro would be counted as 1 full-size equivalent, so the limit is never accidentally exceeded in the permissive direction.

**Confirm in code:**
```
grep -n "fallback\|ratio.*1\b\|= 1" src/lib/futures/contracts.ts | grep -i "fallback\|unknown"
```
Expected: `"Unknown roots → 1.0 (safe fallback: never understates exposure)"`

**Unknown symbols must NOT be marked broker-backed.**  
`buildRuleSummaryChips` only emits the `broker_backed` chip when `account.brokerLockStatus` is set AND `account.maxDailyLoss != null`. Position size rules never receive a `broker_backed` chip regardless of symbol.

**Verify with source scan:**
```bash
grep -n "broker_backed\|Broker-backed" src/lib/rules/rule-summary-chips.ts
```
Expected: only the `daily_loss` chip path emits `broker_backed`. No path for `max_contracts`.

---

## Endpoint Verification Table (quick reference)

| Referenced in validation plan | Exists | Auth | Read-only | No broker writes | Hardened |
|---|---|---|---|---|---|
| `POST /api/debug/tradovate-event` | ✅ | session + isAdmin + env flag + allowlist | ❌ writes DB (synthetic fills only) | ✅ confirmed | ✅ hardened this session |
| `GET /api/debug/tradovate-listener/dry-run-violations` | ✅ | session + x-cron-secret | ✅ | ✅ | ✅ already safe |
| `GET /api/debug/broker-enforcement-gates` | ✅ | session + x-cron-secret | ✅ | ✅ | ✅ already safe |
| `GET /api/debug/broker-enforcement-simulation` | ✅ | session + x-cron-secret + BROKER_ENFORCEMENT_SIMULATION_ENABLED | ✅ | ✅ | ✅ already safe |
| `POST /api/debug/accounts/[id]/reset-session-state` | ✅ | session + x-cron-secret (prod) + ownership | ❌ writes DB (resets lock state only) | ✅ confirmed | ✅ already safe |
| `POST /api/guardian/enable` | ✅ | session (user-scoped) | ❌ writes GuardianProfile | ✅ confirmed | ⚠️ no admin gate (per-user scope acceptable) |
| `POST /api/guardian/disable` | ✅ | session (user-scoped) | ❌ writes GuardianProfile | ✅ confirmed | ⚠️ no admin gate (per-user scope acceptable) |
| `GET /api/debug/tradovate-listener/dry-run-summary` | ✅ | session + x-cron-secret | ✅ | ✅ | ✅ already safe |
| `GET /api/debug/internal-lock-events` | ✅ | session + x-cron-secret | ✅ | ✅ | ✅ already safe |
