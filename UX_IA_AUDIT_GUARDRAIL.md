# Guardrail UX / IA QA Audit (Brutally Honest)

Date: 2026-05-01  
Scope: Live site UX + app information architecture review from code structure and page copy.

## A) Executive summary — why this feels confusing

Guardrail currently **looks like a SaaS app with trading terminology**, not a trader operating system.

The critical confusion is this: users cannot instantly answer the 12 core trading-state questions (permission, account, mode, enforcement, reset, next action). Those answers are scattered across Dashboard, Guardian, Rules, Journal, Accounts, and Alerts.

Top issues:
1. **State fragmentation**: “Can I trade right now?” and “Why?” are not clearly singular and persistent.
2. **Mode ambiguity**: Manual Mode vs broker-connected is explained repeatedly but not made a dominant always-visible system state.
3. **Entity ambiguity**: active account context is not globally pinned (account identity/type/live/demo/prop/read-only freshness should be top-level context).
4. **Navigation debt**: Dashboard + Guardian overlap; Accounts + Tradovate verify + Settings “Broker connections” overlap.
5. **Trust gap**: marketing headline implies strong enforcement; detailed copy later clarifies in-app lock/read-only. This can feel like overpromising.
6. **Action ambiguity**: users often get status text but not an explicit “Do this now” command.

If a trader is stressed or down money, this structure increases cognitive load and churn risk.

## B) Recommended new Information Architecture

### Primary product objects (in trader priority order)
1. **Today’s Trading State** (single source of truth)
2. **Trading Plan** (rules + lock status)
3. **Account Connection** (broker, account identity, sync health)
4. **Execution Log** (journal/manual inputs + broker events)
5. **Alerts & Coaching** (secondary channels)
6. **Account/Billing/Security settings** (administrative)

### Proposed top-level app IA
- **Home (Today)** — merged Dashboard + Guardian
- **Trading Plan** (rename Rules)
- **Broker Connections** (rename Accounts)
- **Trade Log (Manual Mode)** (rename Journal)
- **Alerts** (Telegram + notification triggers)
- **Settings** (security, subscription, account management only)

### Structural rule
If a page cannot answer one of the 12 core trading-state questions, it should not be top-level.

## C) Suggested navigation structure

### Desktop
- Left to right: **Today | Trading Plan | Broker Connections | Trade Log | Alerts | Settings**
- Persistent top context bar on every trading page:
  - Active account: `Apex-Combine-1234 (Prop / Demo)`
  - Mode: `Broker-connected` or `Manual Mode`
  - Permission: `Allowed / Warning / Locked / Setup Needed`
  - Data freshness: `Last broker sync 12:04:33 ET`

### Mobile
- Bottom nav (5 icons max): Today, Plan, Accounts, Log, More
- Sticky status pill at top: permission + account + mode

Current “More” dropdown plus dense option labels (“Status details”, “Setup guide”) adds recall burden.

## D) Page-by-page UX report

### 1) Landing page
- Strength: clear problem framing and strong discipline positioning.
- Problems:
  - Enforcement nuance is buried in FAQ/legal; headline implies harder enforcement than currently shipped.
  - Too many repeated CTAs without progressive detail.
- Fix direction: add one explicit above-the-fold badge: “Current enforcement: In-app lock + alerts. Broker-side blocking: not yet enabled.”

### 2) Signup
- Good: concise.
- Problem: post-signup expectation mismatch (“prepare broker connection”) vs optional/manual path.
- Needs a fork immediately after account creation: “Start in Manual Mode” vs “Connect Tradovate now”.

### 3) Login
- Fine mechanically.
- Missing: “last active mode/account” preview for returning users.

### 4) Onboarding
- Current messaging still abstract and step-based rather than state-based.
- Should output a final “Trading readiness card” with binary items and one next action.

### 5) Dashboard
- Overloaded with components (readiness, activity, manual events, economic events, review).
- Critical status can be buried below fold.
- Should become **Today (command center)** with top 4 cards only: Permission, Account/Mode, Limits proximity, Next action.

### 6) Guardian
- Valuable content, but duplicates Dashboard mission.
- Recommendation: **merge into Today page** as expandable “Why this status” section.

### 7) Rules
- Rename to **Trading Plan**.
- Must include lock policy/status area (daily/weekly/monthly, cutoff, next editable time) as first-class block.

### 8) Journal
- Rename to **Trade Log (Manual Mode)**.
- Manual mode warning is present but should be a hard banner at top every time.

### 9) Accounts
- Rename to **Broker Connections**.
- Current page mixes connection, status semantics, and roadmap language.
- Must display active account card with account type and freshness.

### 10) Connect Tradovate
- Strong: read-only scope and capability messaging.
- Improve: plain-language “what changes after connection today” and “what does NOT change yet”.

### 11) Tradovate verification
- Useful for ops/power users, too technical for average trader.
- Move under advanced diagnostics, hide by default.

### 12) Alerts / Telegram
- Clear enough.
- Should show whether alerts are safety-critical backup vs informational.

### 13) Coaching
- Naming split (“Telegram Bot”, “Coaching”) may confuse ownership.
- Keep as subsection inside Alerts/Coaching, not top-level for new users.

### 14) Settings
- Currently includes some connection visibility that overlaps Accounts.
- Keep Settings admin-only: auth, password, subscription, delete account.

### 15) Billing/paywall
- Not deeply assessed from authenticated flow.
- Risk: trial-to-paid transition copy must avoid surprise around enforcement capabilities.

### 16) Terms/Privacy/Risk
- Strong transparency, good security language.
- But critical operational limitations should appear in-product, not only legal pages.

### 17) Mobile nav
- Menu dropdown pattern increases taps and memory load.
- Bottom nav + sticky status recommended.

### 18) Desktop nav
- “More” menu hides frequently used safety pages (Guardian/Journal/Alerts).
- Flatten architecture around trader workflows.

### 19) Empty states
- Several setup-needed states exist, but not always with single decisive CTA.
- Every empty state must answer “what next in one click?”

### 20) Error states
- Some technical errors are explicit (good), but should map to trader consequences:
  - “Broker sync stale > X min => status downgraded to Warning/Setup Needed.”

## E) Trader journey map (target behavior)

1. **First visit**: Understand exactly what is enforced now vs later.  
2. **Signup**: Immediate mode choice (Manual vs Broker-connected).  
3. **Onboarding**: Set plan + confirm active account/mode + alerts.  
4. **Set rules**: Save Trading Plan with lock schedule and cutoff.  
5. **Connect broker**: Select account, classify type, verify freshness.  
6. **Start day**: One-screen permission verdict and next action.  
7. **Hit warning**: show exact approaching limit + required behavior.  
8. **Hit lock**: show rule fired, timestamp, reset time, non-editable state.  
9. **Next-day reset**: explicit rollover summary + confirmation to trade.

## F) Pages to merge/rename/hide/simplify

- Merge: **Dashboard + Guardian**.
- Rename: **Rules → Trading Plan**.
- Rename: **Journal → Trade Log (Manual Mode)**.
- Rename: **Accounts → Broker Connections**.
- Hide by default: **Tradovate verify diagnostics** behind advanced toggle.
- Keep Setup Guide but convert from page to checklist widget on Today.

## G) Copy issues and better wording

High-risk vague copy today:
- “Status details”, “Setup guide”, “Manual fallback”.

Replace with trader-explicit copy:
- “Trading Permission” (instead of status details)
- “Manual Mode (you enter trades)”
- “Broker-connected (auto-read from Tradovate)”
- “Enforced now: in-app lock + alerts”
- “Not enforced yet: broker order blocking/flatten”
- “Next action: [single imperative sentence]”

## H) Visual/UI issues

- Premium tone is decent, but functional hierarchy is weak under pressure.
- Too many similarly styled cards can hide the one thing that matters.
- Footer/disclaimer block may compete visually on app screens; keep but reduce salience during active trading workflows.

## I) Product trust issues

1. Potential perceived overpromise on enforcement (marketing vs capability reality).  
2. Read-only broker state needs persistent explicit label.  
3. Must show data freshness and stale-state behavior clearly.  
4. Must show account identity/type everywhere to prevent wrong-account assumptions.

## J) Security/privacy issues visible to user

Good signals:
- Explicit token encryption language in privacy docs.
- Read-only authorization framing.

Gaps in UX surface:
- Missing obvious “token connected/disconnected/expired” banner behavior standards.
- Missing visible audit trail of critical rule changes (needed for trust and support).

## K) Trader Operating System Gap Analysis

### 1) Data traders expect
- Active account identity/type, permission, P&L, limits proximity, open risk, sync freshness, exact lock reason/reset.

### 2) Data Guardrail appears to show now
- Permission states and some rule progress; manual journal signals; broker connection state; legal limitations.

### 3) Data likely in code but not consistently surfaced as global context
- Session state derivations, manual risk calculations, live-enforcement state, violation feeds, connection status, event timelines.

### 4) Data should pull from Tradovate (when available)
**A. Must-have now**
- Connected account list, selected active account, account label/ID/type (best-effort), realized/unrealized/daily P&L, open positions/orders, last sync time, token status, stale/disconnected warnings, read-only limitation.

**B. Should-have soon**
- Executions/fills timeline, position sizing summaries, margin/buying-power snapshot, commission-aware P&L when available.

**C. Nice-to-have later**
- Contract spec helpers (tick/point value), fee analytics, multi-account comparative risk.

**D. Not available / unclear**
- Broker-side hard blocking, cancel/flatten guarantees, some account-category certainty without broker metadata mapping.

### 5) Where each data class belongs
- **Today**: permission, reason, next action, active account, mode, sync freshness, top limits proximity.
- **Trading Plan**: full rule set, lock policy, cutoff, next editable time, audit log.
- **Broker Connections**: accounts, tokens, verification health, endpoint status, disconnected recovery.
- **Trade Log**: manual entries and annotations only, clearly isolated as manual input path.
- **Settings**: auth/billing/profile only.

### 6) Dashboard vs Rules vs Journal vs Broker Connections vs Settings
- Dashboard (Today) = decision surface.
- Trading Plan = configuration and lock governance.
- Trade Log = manual data input/review.
- Broker Connections = integration health and account selection.
- Settings = account administration.

## L) Prioritized issue list

### P0 (core-blocking confusion)
1. No single persistent “Can I trade now + why + next action” surface.
2. Account/mode context not pinned globally.
3. Dashboard/Guardian split causes decision fragmentation.
4. Enforcement scope (in-app vs broker-side) not persistently visible.

### P1 (serious UX/product)
1. Rules naming and structure not aligned to trader mental model (“Trading Plan”).
2. Accounts/Settings overlap and verification discoverability issues.
3. Mobile nav pattern increases cognitive overhead.
4. Stale/disconnected broker consequences not explicit enough.

### P2 (polish)
1. CTA rationalization and consistency of verb choices.
2. Improve empty-state single-action guidance.
3. Better warning/lock visual escalation consistency.

### P3 (later)
1. Advanced diagnostics UX for power users.
2. Additional analytics and contract metadata panels.

## M) Recommended first patch set (do NOT implement yet)

1. **IA rename/merge pass (copy + routing surface only)**
   - Dashboard+Guardian unify into Today.
   - Rules rename to Trading Plan.
   - Accounts rename to Broker Connections.
   - Journal relabel to Trade Log (Manual Mode).

2. **Persistent trader status bar**
   - account, mode, permission, sync freshness, reset timer, next action.

3. **Capability transparency module**
   - always-on badge: Enforced now vs Not enforced yet.

4. **Rule lock UX scaffolding**
   - lock period selector, cutoff time, lock state chip, next editable time, immutable view when locked, admin override badge, change audit log table.

5. **Navigation simplification**
   - remove/flatten “More” for high-frequency tasks.

6. **Error/empty-state rewrite**
   - each state maps to one clear action and one support fallback.

---
Bottom line: Guardrail has a strong concept and credible risk language, but currently distributes critical trading truth across too many places. Consolidate into a single “Today” operating surface with persistent account/mode/enforcement context, and churn risk should drop materially.
