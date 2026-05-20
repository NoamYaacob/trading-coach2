# Guardrail Rule Engine Capability Matrix

This document describes what each Guardrail rule can actually do end-to-end. It is generated from the authoritative source in `src/lib/rules/rule-capabilities.ts`.

**Last updated:** 2026-05-17

---

## Summary: What "enforcement" means in Guardrail

Guardrail has three enforcement layers, each progressively stronger:

| Layer | What it does | Bypassed by |
|-------|-------------|-------------|
| **UI evaluation** | Guardrail computes whether a rule is breached and shows it in the dashboard | Nothing — always runs |
| **Internal lock** | Guardrail marks the account as STOPPED; the app prevents new orders via Guardrail-connected tools | Placing orders directly through the broker platform |
| **Broker risk settings** | Guardrail writes a hard limit to Tradovate (e.g., `userAccountAutoLiq`) | Cannot be bypassed — exchange-level enforcement |

**Profit targets are monitored in Guardrail. They are NOT enforced via Tradovate broker risk settings.** When you hit your profit target, Guardrail notifies you. The broker will still accept new orders.

---

## Capability Matrix

| Rule | User Visible Name | Broker Risk Settings | Internal Lock | Guardian Evaluated | Status | Broker Sync Truth |
|------|-------------------|---------------------|---------------|-------------------|--------|-------------------|
| `maxDailyLoss` | Daily loss limit | ✅ YES | ✅ YES | ✅ YES | **full** | `broker_synced` |
| `dailyProfitTarget` | Daily profit target | ❌ NO | ❌ NO | ✅ YES | partial (dry-run) | `guardrail_monitored` |
| `maxTradesPerDay` | Max trades per day | ❌ NO | ✅ YES | ✅ YES | partial | `guardrail_lockable` |
| `stopAfterLosses` | Stop after consecutive losses | ❌ NO | ✅ YES | ✅ YES | partial | `guardrail_lockable` |
| `maxContracts` | Max contracts (position size) | ❌ NO | ❌ NO | ✅ YES | partial | `guardrail_monitored` |
| `sessionEndHour` | Session end time | ❌ NO | ❌ NO | ❌ NO | coming soon | `advisory_only` |
| `sessionEndBehavior` | Session end behavior | ❌ NO | ❌ NO | ❌ NO | coming soon | `advisory_only` |
| `notifications` | Breach notifications | ❌ NO | ❌ NO | ❌ NO | ui_only | `advisory_only` |

### Status legend

- **full** — UI display + Guardrail evaluation + enforcement all working
- **partial** — some path is missing (e.g., evaluation works but enforcement is app-side only)
- **ui_only** — visible in the UI, saved to DB, but not evaluated in the enforcement path
- **coming_soon** — planned but not yet implemented

### Broker Sync Truth legend

- **broker_synced** — Tradovate receives the limit directly via API write; exchange-level enforcement
- **guardrail_monitored** — Guardrail tracks the rule internally; no broker write occurs
- **guardrail_lockable** — Guardrail tracks AND can lock the account internally (STOPPED state); broker does not know about this rule
- **advisory_only** — Shown in UI, saved to DB, not evaluated in any enforcement path

---

## Rule Details

### maxDailyLoss — Daily Loss Limit

**Status: Full**

Your daily loss limit is monitored by Guardrail and, when broker permissions allow, sent directly to Tradovate as a hard account risk setting. If you hit your limit, Guardrail locks your account internally and (when enabled) writes the limit to the broker so new orders are rejected at the exchange level.

- Broker write: `userAccountAutoLiq/update` (Tradovate)
- Internal lock: yes — account enters STOPPED state
- Order action eligible: **no** (Phase 3 not started)
- Editable after breach: **no**

### dailyProfitTarget — Daily Profit Target

**Status: Partial (Guardrail monitoring only)**

Profit targets are monitored by Guardrail and trigger an internal notification when reached. **They are NOT enforced via Tradovate broker risk settings** — no broker-side stop is placed when you hit your profit goal. Guardrail can alert you and optionally lock the app, but the broker will still accept new orders.

- Broker write: **none** — Tradovate has no profit-target risk setting
- Internal lock: no
- Order action eligible: **no** (Phase 3 not started)
- Editable after breach: **no**

### maxTradesPerDay — Max Trades Per Day

**Status: Partial (Guardrail-lockable)**

Guardrail counts your trades during the session and locks your Guardrail account when the limit is reached. This is an app-side enforcement only — the broker will still accept orders if you bypass Guardrail. Broker-side trade-count enforcement is not supported by Tradovate.

- Broker write: **none**
- Internal lock: yes
- Order action eligible: **no** (Phase 3 not started)
- Editable after breach: **no**

### stopAfterLosses — Stop After Consecutive Losses

**Status: Partial (Guardrail-lockable)**

Guardrail tracks your consecutive losing trades and locks your Guardrail account when the streak limit is hit. This is an app-side enforcement only — no broker-side consecutive-loss rule exists in Tradovate.

- Broker write: **none**
- Internal lock: yes
- Order action eligible: **no** (Phase 3 not started)
- Editable after breach: **no**

### maxContracts — Max Contracts (Position Size)

**Status: Partial (Guardrail monitoring only)**

Guardrail monitors position size using standard-equivalent contract counting (e.g., 10 MNQ = 1 NQ equivalent). There is no real-time pre-trade enforcement — Guardrail cannot intercept an order before it reaches the broker. When a position exceeds the limit, Guardrail flags it and can notify you, but cannot reverse the fill.

- Broker write: **none** by default (optional raw hard-limit mode available but not recommended for micro/standard mixed portfolios)
- Internal lock: no
- Order action eligible: **no** (Phase 3 not started)
- Editable after breach: **no**

### sessionEndHour / sessionEndBehavior — Session End Rules

**Status: Coming soon**

Session end time is used by Guardrail to define when the rule-edit lock window closes. Active session-end enforcement (automatically stopping trading at the session end) is planned but not yet implemented.

### notifications — Breach Notifications

**Status: UI only**

Notification preferences (Telegram, in-app) control how Guardrail alerts you when rules are breached. These are delivery settings only — they do not affect enforcement decisions.

---

## Safety Invariants (enforced in code)

1. **Only `maxDailyLoss` may have `brokerRiskSettingsEligible=true`.** No other rule — including profit targets — triggers a broker API write.
2. **No rule has `orderActionEligible=true`.** Order cancel/flatten actions (Phase 3) are not started.
3. **No rule has `editableAfterBreach=true`.** Rules are locked after a breach is recorded for the day.
4. These invariants are verified in `src/lib/rules/rule-capabilities.test.ts` and will fail CI if violated.

---

## How to verify broker enforcement is active

1. Go to the account row in the Dashboard.
2. Check the "Broker-backed: Daily loss" chip. If visible, the limit has been written to Tradovate.
3. Check `brokerLockStatus` in the Safety Console — `broker_locked` means the Tradovate limit is active.

If you see "Broker-backed: Profit target" anywhere in the Guardrail UI, that is a bug — file an issue immediately.

---

## Rule-Save Sync

*Added in Phase 2C — see `docs/TRADOVATE_RISK_SETTINGS_SYNC.md` for full details.*

Rule-Save Sync is a proactive path that writes a user's saved daily loss rule to Tradovate's `userAccountAutoLiq` risk settings when the rule is saved. It is distinct from breach-time enforcement (the listener path).

### What gets synced vs. what stays Guardrail-only

| Rule | Synced to Tradovate? | Notes |
|------|---------------------|-------|
| `maxDailyLoss` | **YES** | Written to `userAccountAutoLiq.dailyLossAutoLiq` when gates pass |
| All other rules | **NO** | Enforced app-side only; no Tradovate API field exists |

### Gates for rule-save sync (in order)

1. `BROKER_ENFORCEMENT_ENABLED=true` must be set → `gateFailureReason: broker_enforcement_disabled`
2. Account `env` must be `"demo"` → `gateFailureReason: env_not_demo`
3. `isActive` must be true → `gateFailureReason: account_inactive`
4. `missingFromBroker` must be false → `gateFailureReason: account_missing_from_broker`
5. `connectionStatus` must not be `expired`, `connection_error`, `not_connected`, `pending_webhook`, or `oauth_pending_storage` → `gateFailureReason: connection_not_live`
6. `permissionLevel` must be `"full_access"` → `gateFailureReason: insufficient_permissions`
7. `accountAllowlisted` must be true → `gateFailureReason: account_not_allowlisted`
8. `guardianEnabled` must be true → `gateFailureReason: guardian_inactive`

Each gate failure returns `{ allowed: false, skipReason, gateFailureReason }` for structured audit logging.

### Differences from the listener (breach-time) path

- Does NOT require an active `InternalLockEvent` (listener path gate 9)
- DOES require an account allowlist (gate 7) — accounts must be explicitly allowlisted before broker writes proceed
- DOES require Guardian active (gate 8) — broker writes are blocked if Guardrail monitoring is not running
- Does NOT perform a dedup check (listener path gate 10)
- Fires on user save action, not on automated breach detection
- Implementation: `src/lib/brokers/tradovate-risk-settings-service.ts`

### Dry-run and simulation

- `simulateTradovateRiskSettingsSync(input)` — evaluates all gates and returns a payload preview without ever calling TradovateClient
- `ENFORCEMENT_DRY_RUN=true` — skips the live broker call in `syncDailyLossRiskSettingToTradovate` and returns `auditNote: "dry_run"`
