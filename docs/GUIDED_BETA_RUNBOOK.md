# Guardrail — Guided Beta Runbook

Final operating checklist for the guided (monitoring-only) beta.

**Status at time of writing**

| Item | State |
|---|---|
| Trading Plan Phase 1 (truth / badges) | GO |
| Phase 2 (account-first UX) | GO |
| Phase 3 (Copy Rules) | GO |
| Phase 4A/B/C/D (symbol-specific max contracts) | GO |
| Phase 4E (live QA on DEMO7433035) | **Pending** — next CME session reset |
| Notifications / Telegram honesty | GO |
| Pricing / Billing audit | GO |
| Unit tests | 5240 pass / 0 fail |
| Broker writes | Disabled |
| Branch | `claude/rule-engine-violation-feed-ioIBS` |

**Posture:** Guardrail runs in **monitoring mode only** for this beta. No
broker-side enforcement, no order writes, no automated flatten/cancel. Daily
Loss is the only rule classified "broker-backed eligible", and even it is not
sending broker writes in this beta.

---

## 1. Pre-beta environment checklist

`.env.example` is the source of truth for variable names. The safety flags
below are read by code (`x === "true"`) but are intentionally **not** listed in
`.env.example` — when absent they default to **off**, which is the safe beta
state. Confirm each before opening the beta.

### 1a. Safety flags — MUST be off

| Variable | Required beta value | Effect if wrong |
|---|---|---|
| `BROKER_ENFORCEMENT_ENABLED` | `false` / unset | `true` would allow broker-side risk writes |
| `ENFORCEMENT_DRY_RUN` | `true` | dry-run keeps enforcement simulated only |
| `GUARDRAIL_INTERNAL_LOCK_ENABLED` | `false` / unset | `true` would create internal STOPPED locks |
| `TRADOVATE_LISTENER_ENABLE_LIVE` | `false` / unset | `true` would arm the live listener actions |
| `ENABLE_TRADOVATE_ORDER_ACTIONS` | `false` / unset | `true` would allow Tradovate order writes |
| `BILLING_ENABLED` | `false` | `true` would activate the subscription gate |

Verify live values with the read-only diagnostic (admin session + `x-cron-secret`):
`GET /api/debug/broker-enforcement-gates` — confirm `brokerEnforcementEnabled:false`
and `listenerLiveEnabled:false`.

### 1b. Web / app service env

- `DATABASE_URL` — Postgres connection.
- `APP_URL` / `NEXT_PUBLIC_APP_URL` — public base URL (used for Stripe + Telegram callbacks).
- `NODE_ENV=production`.
- `ANTHROPIC_API_KEY` — AI coach.
- `CRON_SECRET` — shared secret for cron + debug endpoints.
- `TRADOVATE_CLIENT_ID` / `TRADOVATE_CLIENT_SECRET` (+ `_DEMO_` pair), `TRADOVATE_TOKEN_ENCRYPTION_KEY`, `TRADOVATE_REDIRECT_URI`, and the auth/token/API base URLs.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google sign-in.

### 1c. Listener-worker env

- Same `DATABASE_URL`, Tradovate credentials, and `TRADOVATE_TOKEN_ENCRYPTION_KEY`.
- `TRADOVATE_LISTENER_ENABLE_LIVE` **must be off** — the listener may run for
  read/diagnostics, but live actions stay disabled.
- Started via `npm run start:listener` (`scripts/tradovate-listener-worker.ts`).

### 1d. Cron service env

- `CRON_SECRET` must match the web service.
- Cron jobs in scope for beta: Tradovate sync, token renewal, pending-rule
  promoter. See `docs/ops/railway-services.md`, `docs/ops/tradovate-token-renew-cron.md`,
  `docs/ops/pending-rule-promoter-cron.md`.
- Confirm the cron service is a **separate** Railway service from web (it has a
  `cronSchedule`; web does not).

### 1e. Telegram env (required if Telegram is in the beta)

- `TELEGRAM_BOT_TOKEN` — bot API token.
- `TELEGRAM_BOT_USERNAME` / `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` — deep-link target.
- `TELEGRAM_WEBHOOK_SECRET` — required in production; validates webhook payloads.
- If these are unset, the Settings → Telegram card shows a friendly
  "Coming soon" state — this is acceptable; the beta can run without Telegram.

### 1f. Stripe env (billing OFF for this beta)

- `BILLING_ENABLED=false` — with billing off, the checkout route returns 503 and
  every onboarded user has full access. No Stripe traffic should occur.
- `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_PRICE_ID`,
  `STRIPE_WEBHOOK_SECRET` may be left as placeholders for the beta; they are only
  exercised once `BILLING_ENABLED=true`.
- `ADMIN_EMAILS` — comma-separated admin bypass list (no hardcoded admin email).

---

## 2. First beta user flow

Walk one demo account end to end before inviting external users.

1. **Landing → Signup** — `/` → `/signup`. Email/password or Google. A
   `TRIALING` user is created with `trialEndsAt` = signup + 7 days.
2. **Onboarding** — redirected to `/onboarding/profile`, then `/onboarding`.
   Complete trader profile and starter rules.
3. **Connect Tradovate** — `/accounts/connect/tradovate`. Use a **demo**
   account. Confirm the connection lands `connected_readonly`.
4. **Select the demo account** — `/rules` shows the accounts overview. Pick the
   demo account (account-first UX).
5. **Create the account Trading Plan** — "Create rules for this account" on the
   "No Trading Plan yet" state.
6. **(Optional) Copy Rules** — if a second account already has a plan, use
   "Copy from another account". Confirm the source account is unchanged and the
   target shows the copied values.
7. **Set the rules:**
   - Daily Loss limit
   - Max Trades per day
   - Stop After Losses
   - **Contract limits by symbol** — global fallback + per-symbol rows
     (e.g. NQ, MNQ, ES, MES). Confirm the equivalent helper text renders.
8. **Verify Dashboard** — `/dashboard` loads, shows the account, rule status,
   and any in-app rule notices.
9. **Verify Alerts** — `/alerts` shows In-app as active, Telegram as
   connected/not-connected, and Planned items clearly badged.
10. **Verify Settings → Telegram** — connected / not-connected / "Coming soon"
    state renders correctly; "Connect Telegram" triggers the link-token flow.
11. **Legal / risk disclaimer** — confirm `/risk-disclaimer` is reachable and
    its content is current. Confirm onboarding surfaces the risk language.

---

## 3. Guardrail safety checks during the beta

Run these periodically (and after any deploy):

- **No broker writes** — `GET /api/debug/broker-enforcement-gates` shows
  `brokerEnforcementEnabled:false`, `listenerLiveEnabled:false`,
  `eligibleCount:0` (all locks skipped). No `applyMaxPositionSize` /
  Tradovate write calls in logs.
- **`BrokerRiskSettingsSyncAudit`** — only `gate_blocked` rows should appear
  (the sync is gated off). Any non-`gate_blocked` row means a broker write was
  attempted — investigate immediately.
- **`RuleChangeAudit`** — every rule save/copy writes a row: `allowed=true`
  (`reason: allowed` / `copied_from_account`) or `allowed=false`
  (`reason: session_already_traded` / `account_stopped`).
- **Rule-edit lock after first trade** — once a demo account trades, rule edits
  and Copy Rules return `423 session_already_traded` (3-signal lock:
  tradesCount, lastTradeAt, NormalizedTradeEvent). This is correct behavior.
- **Listener health** — listener worker is up; reconnection/reconciliation
  fields on `BrokerConnection` show no persistent gaps.
- **Token diagnostics** — `GET /api/debug/tradovate-token-diagnostics` (admin):
  no expired tokens for connected accounts.
- **Account-specific scoping** — alerts and rule evaluation reference the
  correct account; two accounts under one OAuth connection stay isolated.

---

## 4. Phase 4E live QA — DEMO7433035 (run at next CME session reset)

Phase 4E is the only outstanding item. DEMO7433035 is currently (correctly)
rule-edit locked because it traded this session. **Do not bypass the lock.**

**Steps:**

1. **Wait for the CME session reset** — 5:00 PM America/Chicago. After the roll,
   the previous session's trade signals no longer apply.
2. **Before placing any trade** on DEMO7433035, and within an editable rule
   window, call the diagnostic:
   `GET /api/debug/symbol-limits-diagnostics?account=DEMO7433035`
   (admin session + `x-cron-secret` header).
3. **Confirm `eligibility.canEditRulesNow === true`.** If it is `false`, stop —
   wait for the next reset or use another `connected_readonly`, untraded demo
   account. **Never reset session state or bypass the lock.**
4. **Save the QA preset** through the Trading Plan UI:
   - Global fallback `maxContracts` = **4**
   - NQ = **1**
   - MNQ = **10**
   - ES = **1**
   - MES = **10**
5. **Re-run the diagnostic** and confirm:
   - `rules.expectedPresetCheck` — all flags true (`hasNQ1`, `hasMNQ10`,
     `hasES1`, `hasMES10`, `globalFallbackIs4`).
   - `latestRuleChangeAudit.newValuesIncludesMaxContractsBySymbolJson === true`.
   - `evaluatorPreview` — NQ→1, MNQ→10, ES→1, MES→10, CL→fallback 4.
   - `verdict.status === "GO"`.
6. Let one `tradovate-sync` cycle run; confirm the evaluator reads the symbol
   limits and that **no** Tradovate write / `applyMaxPositionSize` /
   `BrokerRiskSettingsSyncAudit` row resulted.
7. Do not trade on the account until the QA read is captured — a trade
   re-locks it.

---

## 5. What NOT to promise users

- **No guaranteed prevention of losses.** Guardrail enforces the rules the user
  configures; it does not predict markets or stop losses.
- **No financial advice** — it is a discipline/monitoring tool, not advisory.
- **No broker-side enforcement is active by default.** Guardrail monitors;
  it does not place, cancel, or block orders at the broker in this beta.
- **Daily Loss is the only "broker-backed eligible" rule** — and it is still
  monitoring-only in this beta (no broker write).
- **Max contracts, symbol-specific limits, session cutoff, daily profit
  target, and news alerts are monitoring or planned** — not live broker
  enforcement.
- **No automated flatten or cancel** is active today.
- **Telegram only sends currently wired alerts** — the daily-loss 80% early
  warning, the loss-streak warning (one loss before the limit), pre-session
  check-in, and end-of-day review. It does **not** push a max-trades alert.

---

## 6. Known gaps

| Gap | Impact | Gate |
|---|---|---|
| Phase 4E live QA pending | Symbol-limit evaluator unverified on a live demo account | Before first external user |
| Telegram bot env may be unset | Telegram shows "Coming soon" — no live alert delivery | Before promising Telegram in the beta |
| Stripe webhook has no event-ID idempotency | Replayed `invoice.payment_failed` could mis-set status | Before paid public launch |
| Subscription gating scope undecided | With billing on, only Telegram is gated; Dashboard/Rules stay open | Before paid public launch |
| Per-alert preferences | Planned only — `AlertPreferences` model is orphaned | Post-beta |
| News / pre-news alerts | Planned only — not wired | Post-beta |
| Daily profit target alert | Planned only — not wired | Post-beta |
| Max-trades Telegram alert | Planned only — in-app notice exists, no Telegram push | Post-beta |

---

## 7. Rollback plan

- **Bad deploy** — roll back the Railway deployment to the previous known-good
  release (web + cron + listener services). Re-run `npm run test:unit` on the
  branch to confirm 5240 pass / 0 fail before redeploying.
- **Env safety rollback** — if any safety flag was flipped on, set it back to
  `false` / unset and redeploy. Re-verify via
  `GET /api/debug/broker-enforcement-gates`.
- **Token expired** — the token-renewal cron should refresh automatically; if an
  account is stuck, see `docs/ops/tradovate-token-renewal.md`. Diagnose with
  `GET /api/debug/tradovate-token-diagnostics`.
- **Dashboard shows "reconnect"** — the broker connection is expired/errored.
  Have the user re-run the Tradovate OAuth connect flow. Monitoring degrades
  gracefully; no enforcement is affected (none is active).
- **Unexpected broker write appears** — treat as a P0. Immediately set
  `BROKER_ENFORCEMENT_ENABLED`, `TRADOVATE_LISTENER_ENABLE_LIVE`, and
  `ENABLE_TRADOVATE_ORDER_ACTIONS` to off, redeploy, and audit
  `BrokerRiskSettingsSyncAudit` + listener logs for the source. No broker write
  is expected in this beta.

---

## 8. Verdict

- **Runbook path:** `docs/GUIDED_BETA_RUNBOOK.md`
- **Beta GO / NO-GO:** **GO for guided (monitoring-only) beta** — once the
  Section 1 environment checklist is confirmed.
- **Blockers (hard):** none for a guided internal/monitoring beta. The
  Section 1 safety-flag verification is a required pre-flight, not a blocker.
- **Should-fix before the first external user:**
  - Complete Phase 4E live QA on DEMO7433035 (Section 4).
  - Confirm Telegram bot env is set, or explicitly scope Telegram out of the
    beta (the UI already degrades to "Coming soon").
  - Run the Section 2 first-user flow end to end once.
- **Should-fix before paid public launch:**
  - Add Stripe webhook event-ID idempotency (dedupe replays).
  - Decide and implement the subscription-gating strategy for when
    `BILLING_ENABLED=true` (today only Telegram is gated).
  - Document the safety flags and Stripe test/live-mode setup in `.env.example`.
  - Decide which planned alerts (news, profit target, per-alert preferences,
    max-trades Telegram) ship for paid launch.
