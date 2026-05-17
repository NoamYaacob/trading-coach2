# First External Beta Runbook — Guardrail

**Audience: Admin / founder only.**
**Status: Pre-session template. Complete all checklists before inviting the user.**

This runbook covers the first guided beta session with an external user on a demo/sim Tradovate account. Beta is not self-serve. You (the admin) are present for the full session.

---

## 1. Purpose

- This is the first monitored session with a real person who is not on the internal team.
- The session is **guided** — the user does not self-onboard alone.
- The account **must be demo or sim** unless you have explicitly reviewed and approved a live account in writing. When in doubt, use demo.
- The goal is to validate the full onboarding → rules → dashboard → monitoring flow under real conditions, not to test broker enforcement.

---

## 2. Absolute Safety Rules

These are non-negotiable. Verify each before inviting the user.

| Rule | Required state |
|------|---------------|
| `BROKER_ENFORCEMENT_ENABLED` | `false` (absent or explicitly `false`) |
| `TRADOVATE_LISTENER_ENABLE_LIVE` | `false` |
| `ENFORCEMENT_DRY_RUN` | `true` |
| `GUARDRAIL_INTERNAL_LOCK_ENABLED` | `false` unless you are deliberately testing app-only lock behavior and have documented the reason |
| Flatten / cancel / order actions | **Never** — these are not implemented; confirm no code path triggers them |
| Beta user live account | **Do not** add any live account to `BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST` |
| Safety Console overall status | Must be `safe` before and throughout the session |

**If Safety Console is not `safe`, stop. Do not invite the user until it is.**

---

## 3. Pre-Session Checklist

Complete this checklist in order. Do not start the session if any blocking item is unresolved.

### 3a. Safety Console (`/debug/safety-console`)

- [ ] Overall status = **`safe`** — zero alerts at any severity
- [ ] `BROKER_ENFORCEMENT_ENABLED=false` confirmed in listener-worker env row
- [ ] `TRADOVATE_LISTENER_ENABLE_LIVE=false` confirmed in listener-worker env row
- [ ] `ENFORCEMENT_DRY_RUN=true` confirmed in listener-worker env row
- [ ] `GUARDRAIL_INTERNAL_LOCK_ENABLED=false` confirmed (or documented exception)
- [ ] Listener-worker env row is **fresh** (not stale/missing)

### 3b. Listener health

- [ ] `listener.status = connected` for the target account's connection
- [ ] Last heartbeat is recent (< 5 min)
- [ ] Last reconciliation = `success`

### 3c. Account state

- [ ] Target account is **demo or sim** — confirm `connectionEnv = "demo"` in Safety Console
- [ ] No active Guardrail app-lock (`activeLockCount = 0`)
- [ ] No `broker_lock_failed` history for this account
- [ ] Account appears on the admin dashboard
- [ ] Rollout readiness = **`ready`** (not `needs_review` or `blocked`) — check Safety Console rollout readiness section

### 3d. Rules

- [ ] At least one rule is configured (default plan or account-specific)
- [ ] Guardian is enabled on the rules page (green "Guardian active" badge visible)
- [ ] Account is not in "Setup needed" / "Pending" state on the dashboard

### 3e. Event routing

- [ ] Webhook URL has been confirmed with Tradovate
- [ ] At least one test event has been received (first event visible in account diagnostics)
- [ ] The first event's account mapping matches the correct internal account ID

### 3f. User readiness

- [ ] Telegram or support channel is open and you can reach the user in real time
- [ ] The user has been told this is a **monitoring and protection beta** — not financial advice
- [ ] The user understands that **no broker-side writes are active by default**
- [ ] The user's account is demo/sim (confirm with them directly)

---

## 4. Customer Setup Flow

Walk the user through each step. You (admin) confirm each milestone before they proceed.

**Step 1 — Send invite / login**
Send the user their invite link or login credentials. Confirm they can reach the app and that their email matches the expected account.

**Step 2 — Onboarding**
User completes the onboarding flow. Confirm they reach the accounts page without errors. Check server logs for any auth or DB errors.

**Step 3 — Connect Tradovate**
User clicks "Connect Tradovate" and goes through the OAuth flow. Remind them: Guardrail starts in monitoring mode; they are selecting an access level for the connection, not enabling enforcement.

**Step 4 — Select account**
User selects their demo/sim account from the list. Confirm the account label and type look correct. If they have multiple accounts, make sure they select the demo one.

**Step 5 — Choose rules**
User reaches the "Assign a trading plan" page (Step 3 of 3). Walk them through the three options:
- **Default trading plan** — applies globally; configure if not already set
- **Account-specific plan** — account-level override
- **Monitor only** — data sync, no rule alerts

Admin: confirm the choice makes sense for what you want to test.

**Step 6 — Confirm first event**
After the user places a test trade (or uses the dev "Fire test event" if available), confirm the event appears in the account's Advanced Diagnostics panel. If no event appears within 2–3 min, pause and investigate webhook routing before continuing.

**Step 7 — Dashboard**
User opens the dashboard. Confirm:
- Account row appears with the correct label
- Status badge is `Tradable` or `Pending` (not `Not connected`)
- P&L / trade count / loss budget reflect demo account data

**Step 8 — Trading Plan**
User opens their Trading Plan (rules page). Confirm:
- Rules are visible and correctly scoped
- Guardian shows as active (green badge)
- No unexpected "Action required" banners

**Step 9 — Account detail**
User navigates to the account detail page. Confirm:
- Connection readiness panel shows the correct status
- Advanced Diagnostics shows recent events
- No "Not connected" or "Setup needed" banners

**Step 10 — Status labels walkthrough**
Briefly explain the status labels the user may encounter:

| Label | What it means |
|-------|--------------|
| `Market closed` | CME weekend or maintenance window — no trades possible |
| `Live monitoring` | Listener is connected and receiving events in real time |
| `Synced` | Data received via reconciliation (fallback — still accurate) |
| `Stale` | No recent data — investigate listener health |
| `Tradable` | Account is active, rules configured, no locks |
| `Pending` | Waiting for first event — normal immediately after connect |

---

## 5. What to Say to the User

Use this as a script or talking-point guide. Adjust tone to match the conversation.

---

**What Guardrail does:**
> "Guardrail monitors your trading account against the rules you set. When you breach a rule — like hitting your daily loss limit or taking too many trades — Guardrail marks your account as locked inside the app and alerts you. It doesn't place trades or give financial advice. It's a rule-enforcement layer you control."

**What Guardian means:**
> "Guardian is the rule engine inside Guardrail. When Guardian is on, it's watching your account during the session against the rules you configured. When it's off, your rules are saved but not active. You can turn Guardian on from your rules page."

**What is active today:**
> "Right now, Guardrail is in monitoring mode. It tracks your trades and P&L, evaluates your rules in real time, and marks the account as locked inside the app if a rule is breached. You'll see that on your dashboard immediately."

**What is not active today:**
> "Broker-side writes — things like applying a daily loss limit directly through Tradovate's API — are not active. That's a separate capability that requires your explicit opt-in and is off by default. This session is purely monitoring and app-level rule evaluation."

**Broker-side protection:**
> "Guardrail can optionally communicate rule limits to Tradovate's risk system, but only when you deliberately enable that. It's never on by default. In this beta, it's off."

**This session is monitored:**
> "I'm watching the Guardrail dashboard and backend during this session. If anything unexpected happens — a rule fires, data looks wrong, the account gets stuck — I'll see it and we'll handle it together."

**Not financial advice:**
> "Guardrail doesn't tell you whether a trade is a good idea. It enforces rules you set yourself. If you're unsure about the right rules for your account, that's a decision for you and your plan — not something Guardrail decides."

---

## 6. Live Monitoring Checklist (During Session)

Run through this checklist every 10–15 minutes during the live session.

- [ ] Safety Console overall status remains **`safe`**
- [ ] Listener status remains **`connected`**
- [ ] Last heartbeat is fresh (< 5 min old)
- [ ] Dashboard account row reflects current data (trades, P&L, loss budget)
- [ ] Trade events appear in the account's Advanced Diagnostics within 1–2 min of placement
- [ ] P&L and loss budget are scoped to the correct account (not mixed with another)
- [ ] No unexpected `GuardianIntervention` rows for this account (check `/debug/safety-console` or DB directly)
- [ ] No `broker_lock_failed` status for any intervention
- [ ] No stale or confusing UI state reported by the user
- [ ] No errors in application logs related to this account

---

## 7. If Something Goes Wrong

### Troubleshooting table

| Symptom | What to check | What to tell user | When to stop |
|---------|--------------|-------------------|--------------|
| **Safety Console shows a warning or critical alert** | Read the alert detail; identify which env var or state is out of range | "One moment — let me check something on my end." | Stop if the alert is critical or if `BROKER_ENFORCEMENT_ENABLED` has somehow become true |
| **Listener disconnected** | Check listener-worker Railway logs; check `ListenerWorkerStatus.listenerStatus`; wait 30–60 s for auto-reconnect | "We may have a brief data gap — your account is fine, I'm checking the connection." | Stop if listener is down for > 5 min without reconnecting |
| **Account stuck on "Pending" / no first event** | Check Advanced Diagnostics for any events; check webhook routing in Tradovate settings; verify the webhook URL is correct | "The connection is set up — we just need to confirm the first trade event arrives. Can you place a small demo trade?" | Stop if no event after two confirmed test trades; investigate webhook before continuing |
| **Webhook missing / wrong URL** | Check the webhook URL shown in Advanced Diagnostics step 1; compare to Tradovate's configured endpoint | "Let me double-check the endpoint URL with you." | Pause until confirmed; do not continue without a confirmed event |
| **Stale dashboard data** | Check listener heartbeat age; check last reconciliation; trigger manual reconciliation if available | "Data may be a few minutes behind — this is normal during initial setup." | Stop if data is > 15 min stale with no recovery |
| **Wrong account selected** | Check the account label and `connectionEnv` in Safety Console rollout readiness; check the account ID in the URL of the account detail page | "Let me verify we're looking at the right account." | Stop and reconnect the correct account if the wrong one was connected |
| **User sees 404 from account detail link** | Check that the account ID in the link matches a real `ConnectedAccount.id` for this user; verify `isActive=true` | "I'll send you the correct link directly." | Do not stop — fix the link and continue |
| **User confused by Guardian / broker settings** | Re-read the "What to say" script in Section 5; emphasize Guardian = rule engine, broker writes = off by default | "Let me clarify — Guardian is just the monitoring engine. Nothing writes to your broker account unless you explicitly turn that on, and it's off right now." | Do not stop — this is a copy/UX issue to note for feedback |

---

## 8. Post-Session Checklist

Complete this after the session ends, before closing the monitoring window.

- [ ] Safety Console still shows **`safe`** — no alerts
- [ ] `activeLockCount = 0` for this account (or confirm any lock was expected and intentional)
- [ ] No unexpected `GuardianIntervention` rows were created during the session
- [ ] No `broker_lock_failed` status for any intervention during the session
- [ ] Confirm `BROKER_ENFORCEMENT_ENABLED` is still `false` in both web and listener-worker env
- [ ] Take a screenshot or export: dashboard state, account detail, rules/trading plan, Safety Console summary
- [ ] Collect verbal or written feedback from the user (what was confusing, what was clear, what was missing)
- [ ] Note any copy or UI states that caused confusion (add to a patch list)
- [ ] Decide: **continue beta / pause for patches / expand to next user**

---

## 9. Go / Pause Criteria

### Go criteria (safe to continue or expand beta)

- [ ] Safety Console shows `safe` throughout the session
- [ ] Demo account connected and data updated in real time
- [ ] User completed the full flow (connect → rules → dashboard → account detail) without admin-unplanned intervention
- [ ] User understands current protection mode (monitoring only, no broker writes)
- [ ] No unexpected warnings, locks, or data mismatches
- [ ] No copy confusion that would cause a user to misunderstand enforcement state

### Pause criteria (stop and resolve before continuing)

- [ ] Any critical Safety Console alert during the session
- [ ] Any evidence of a broker write attempt (check listener-worker logs and `GuardianIntervention.brokerLockStatus`)
- [ ] Listener instability (disconnected for > 5 min, repeated closes)
- [ ] Account data mismatch (P&L, trade count, or loss budget doesn't match expected values)
- [ ] User cannot complete setup without admin intervention that was not part of the planned flow
- [ ] User misunderstands enforcement risk (believes broker writes are active when they are not, or vice versa)
- [ ] Any database error or unhandled exception related to the beta account

---

## 10. Rollback / Shutdown

If you need to abort the session or roll back to a clean state:

1. **Verify env vars are safe** — confirm `BROKER_ENFORCEMENT_ENABLED=false`, `ENFORCEMENT_DRY_RUN=true`, `TRADOVATE_LISTENER_ENABLE_LIVE=false` in Railway listener-worker service. Do not change them unless an abort condition explicitly requires it.
2. **Stop the listener-worker if needed** — redeploy the listener-worker service via Railway to force a clean reconnect. This does not affect any user data.
3. **Disconnect the account if needed** — from the account detail page, use the disconnect/deactivate option. The `ConnectedAccount` row will be set to `isActive=false`. No broker action is taken.
4. **Verify Safety Console returns to `safe`** — reload `/debug/safety-console` and confirm no residual alerts.
5. **No data cleanup is required** — `TradingEvent` and `GuardianIntervention` rows are internal records. They do not affect the user's Tradovate account.

---

## 11. Related Docs

| Document | What it covers |
|----------|---------------|
| `docs/PHASE_2E_ROLLOUT_READINESS.md` | Safety Console rollout readiness checklist — the source of truth for pre-canary/pre-beta safety state |
| `docs/PHASE_2D_LISTENER_RELIABILITY.md` | Reconnect, reconciliation, and listener-worker reliability design |
| `docs/PHASE_2C_D_DEMO_CANARY_RUNBOOK.md` | Internal canary execution log — first broker write, rollback procedure, abort conditions |
| `docs/PHASE_2C_BROKER_ENFORCEMENT_DESIGN.md` | Full broker enforcement architecture and 10-gate safety model |

For Safety Console env flag definitions and alert severity levels, see `docs/PHASE_2E_ROLLOUT_READINESS.md`.
For listener reconnect behavior and reconciliation guarantees, see `docs/PHASE_2D_LISTENER_RELIABILITY.md`.
