# Rule Edit Locking and Anti-Cheat System

Guardrail prevents users from weakening their risk rules at vulnerable moments — specifically during live trading sessions when a breach is imminent or has already occurred. This document explains how the locking system works and how to verify it.

---

## Lock layers (in order of priority)

### 1. Hard lock — Account STOPPED (riskState=STOPPED)

**The strongest lock. Blocks all rule changes, regardless of session timing.**

When any connected account enters the STOPPED risk state (e.g., daily loss limit hit, consecutive losses limit reached), rule changes are rejected with HTTP 423. This is enforced in:

- `POST /api/rules` — default rule template edits
- `PATCH /api/accounts/[id]` — account-specific rule overrides

The lock remains until the account's riskState clears (typically at the daily reset). Users see:

> "Rules are locked for this account right now because protection is active. You can edit them after the lock clears."

This is intentional — a user who just hit their loss limit should not be able to immediately change the limit to allow more losses.

### 2. Session window lock — Active session in progress

**Blocks rule changes during the configured trading session window.**

Before the session cutoff time (configurable, default: 5 minutes before session start), users can freely edit rules. Once the session window opens, changes are saved as "pending" and will apply on the next trading day.

The session window is defined by:
- `sessionStartTime` / `sessionEndTime` (HH:mm in `sessionTimezone`)
- OR legacy `sessionStartHour` / `sessionEndHour` (integer hours)
- OR multi-preset selection (e.g., NY AM + London combined window)

**Exceptions — no session lock applies during:**
- CME daily maintenance break (4:00–5:00 PM CT, Monday–Thursday) — market is closed, no active risk
- Weekend close (Friday 4:00 PM CT → Sunday 5:00 PM CT) — market is closed
- First-time setup — no rules exist yet, so there's nothing to weaken

### 3. Protection lock — Guardian lockout active

**Blocks rule changes when a protection lockout signal is present.**

`hasProtectionLockToday` is true when:
- `guardianStatus.currentLockoutActive === true` (legacy guardian system)
- Any connected account has `riskState === "STOPPED"` or `cooldownActive === true`

This is a superset of the hard lock (layer 1) but is used for the session-window pending-save decision rather than a hard 423 reject.

### 4. Open position lock

**Rule-edit eligibility checks for open positions.** When a user has an open position, certain rule changes (particularly those that would weaken active protection) are blocked. This is evaluated by `deriveRuleEditEligibility` in `src/lib/rule-edit-eligibility.ts`.

---

## What happens to changes made while locked

When a rule change is submitted during the session window lock (but NOT the hard STOPPED lock), it is saved as a **pending payload**:

- Stored in `RiskRules.pendingPayloadJson` (default rules) or `AccountRiskRules.pendingPayloadJson` (account-specific)
- Tagged with `pendingEffectiveDate` (the next trading day key, e.g., "2026-05-18")
- Applied automatically when the next trading day starts (by the pending-rule promoter)

The user sees a response like:
```json
{
  "ok": true,
  "applied": false,
  "reason": "session_active",
  "effectiveDate": "2026-05-18",
  "message": "Rules will apply at the start of your next trading session (May 18)."
}
```

---

## RuleChangeAudit table

Every rule change attempt is recorded in the `RuleChangeAudit` table — whether allowed or blocked. This provides a complete audit trail for compliance, debugging, and safety verification.

### Schema

| Column | Description |
|--------|-------------|
| `id` | CUID primary key |
| `userId` | User who attempted the change |
| `accountId` | Account-specific change (null for default template edits) |
| `scope` | `"default"` or `"account"` |
| `oldValuesJson` | Snapshot of old rule values (when available) |
| `newValuesJson` | Snapshot of the submitted new values |
| `allowed` | `true` if the change was accepted (immediately or as pending), `false` if blocked |
| `reason` | Outcome reason: `"allowed"`, `"saved_as_pending"`, `"account_stopped"`, etc. |
| `blockReason` | When blocked: specific reason code |
| `sessionRiskState` | Risk state at the time of the attempt |
| `listenerFreshAt` | Timestamp of the last listener event (staleness check) |
| `hasOpenPosition` | Whether an open position was detected |
| `ip` | Client IP address (from `x-forwarded-for` or `x-real-ip`) |
| `userAgent` | Client user-agent string |
| `createdAt` | Timestamp of the attempt |

### Indexes

- `(userId, createdAt)` — query all attempts by user, chronologically
- `(accountId, createdAt)` — query attempts for a specific account
- `(allowed, createdAt)` — query all blocked attempts across all users (ops monitoring)

### How to query blocked attempts

```sql
-- All blocked rule changes in the last 24 hours
SELECT * FROM "RuleChangeAudit"
WHERE allowed = false
  AND "createdAt" > NOW() - INTERVAL '24 hours'
ORDER BY "createdAt" DESC;

-- Blocked attempts for a specific user
SELECT * FROM "RuleChangeAudit"
WHERE "userId" = 'usr_xxx'
  AND allowed = false
ORDER BY "createdAt" DESC;
```

---

## What users see (simplified messages)

Guardrail deliberately uses simple, non-technical language in user-facing messages. Internal terms like "riskState", "STOPPED", "protection lock" are never shown to users.

| Lock reason | User-facing message |
|-------------|---------------------|
| Account STOPPED | "Rules are locked for this account right now because protection is active. You can edit them after the lock clears." |
| Session window | "Rules will apply at the start of your next trading session (date)." |
| Protection locked during session | "Your rules are saved and will take effect tomorrow." |

---

## Future: Safety Console — Blocked Rule Changes section

A "Blocked Rule Changes" section is planned for the Safety Console. It will surface:
- A count of blocked attempts in the last 7 days
- A timeline of blocked attempts per account
- The reason each attempt was blocked

Until this is implemented, use the SQL queries above to monitor the `RuleChangeAudit` table directly.

---

## Verifying the lock works

To verify a specific change was blocked:

1. Attempt the rule change via the Trading Plan UI during a live session.
2. The UI should show a lock message, not a success toast.
3. Query the `RuleChangeAudit` table:
   ```sql
   SELECT * FROM "RuleChangeAudit"
   WHERE "userId" = 'usr_xxx'
   ORDER BY "createdAt" DESC
   LIMIT 5;
   ```
4. Confirm `allowed = false` and `blockReason = 'account_stopped'` (or relevant reason).

---

## Implementation references

| File | What it does |
|------|-------------|
| `src/lib/rule-edit-eligibility.ts` | Core eligibility logic — session window, open position, account stopped |
| `src/app/api/rules/route.ts` | Default rules API — applies hard STOPPED check and writes audit rows |
| `src/app/api/accounts/[id]/route.ts` | Account-specific rules API — same pattern |
| `src/lib/rules/rule-change-audit-writer.ts` | Helper to write `RuleChangeAudit` rows without boilerplate |
| `prisma/schema.prisma` | `RuleChangeAudit` model definition |
| `prisma/migrations/20260517000001_add_rule_change_audit/migration.sql` | DB migration for the audit table |
