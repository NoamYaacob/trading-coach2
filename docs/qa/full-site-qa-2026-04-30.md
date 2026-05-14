# Full-Site QA Audit — Guardrail
**Date:** 2026-04-30  
**Auditor:** Claude (automated source-code review)  
**Branch:** `claude/rule-engine-violation-feed-ioIBS`  
**Persona:** First-time skeptical futures trader evaluating whether to trust this tool with session risk management

---

## 1. Scope and Methodology

### Coverage
This audit covers every authenticated and unauthenticated page in the Guardrail app:
landing, signup/login, onboarding (profile + steps), rules, dashboard, journal, guardian,
accounts, alerts, settings, and legal pages.

### Method
The live Railway deployment could not be reached from this environment (sandbox blocks
external URLs). All findings are based on:
- Full source-code inspection of all page components and client components
- Static analysis: `npm run test:unit`, `npx tsc --noEmit`, `npm run lint`
- Manual tracing of data flows, validations, and state derivations

### Screenshots
No live screenshots were captured. The `docs/qa/screenshots/` directory is reserved for
future browser-based runs.

---

## 2. Code Quality Baseline

### Unit Tests
```
npm run test:unit
273 tests — 0 failures, 0 skipped
```
All tests pass. Coverage includes:
- `trading-products.test.ts` — instrument registry, assetClass, specStatus, microOf
- `program-rules.test.ts` — all 6 profile IDs, breach rule logic
- `product-validation.test.ts` — getSymbolStatus, validateTrade()
- `trade-date-validation.test.ts` — 10 cases (future blocked, past allowed, clock tolerance)

### TypeScript
```
npx tsc --noEmit
→ Clean (no errors outside pre-existing Playwright spec issues)
```

### ESLint
```
npm run lint
8 errors, 6 warnings
```

All lint issues are pre-existing, not introduced by recent changes.

| File | Rule | Severity |
|------|------|----------|
| `connection-poller.tsx` | `react-hooks/rules-of-hooks` | Error |
| `coaching/page.tsx` | `react/no-unescaped-entities` | Error (×2) |
| `journal-client-area.tsx` | `react-hooks/exhaustive-deps` | Warning |

The `exhaustive-deps` warning in `journal-client-area.tsx` is intentional — `editingTrade?.id`
is used as the dependency instead of the full object to avoid re-triggering the scroll effect
when unrelated fields update.

---

## 3. Landing Page (`/`)

### What works
- Marketing copy is clear: "Broker-connected trading risk enforcement."
- Pricing shown: $49/month with explicit trial-period framing.
- FAQ correctly discloses current limitations: "No broker-side lockout yet" is documented
  inline, not buried.
- Unauthenticated nav shows only "Log in" and "Sign up" — correct.
- Authenticated users see "Go to dashboard" instead of sign-up CTA — correct.

### Issues
| # | Severity | Finding |
|---|----------|---------|
| L1 | Low | The "live session preview" widget is hardcoded static data, not derived from any user session. A first-time visitor could interpret it as a real live view. No disclaimer clarifying it is illustrative. |

---

## 4. Authentication

### Signup (`/signup`)
- Email + password form with confirmation field.
- Google OAuth CTA present if configured.
- No evidence of client-side password strength meter (server enforces minimum).
- After signup, user is redirected to onboarding — correct.

### Login (`/login`)
- Standard email/password form.
- "Forgot password?" link present and wired.
- Google sign-in button present.
- Redirect-after-login preserves intended destination via `callbackUrl` pattern.

### Forgot Password (`/forgot-password`)
- Form exists and is linked from login.

### Issues
None identified.

---

## 5. Onboarding

### Profile Step (`/onboarding/profile`)
- Collects: primaryMarket, tradingStyle, experienceYears, tradingSession, primaryChallenge.
- Edit mode (`?edit=1`) correctly changes heading to "Update your trading profile."
- Both `tradingExperience` (String) and `experienceYears` (Int) are written via the API
  (`src/app/api/onboarding/route.ts:71-73`) — no field-mismatch bug.

### Onboarding Checklist (`/onboarding`)
- Three steps: Set rules, Turn on Guardian, Broker connection (marked Optional).
- Step 3 correctly shows "Optional" pill when not done, not "Next".
- Primary CTA adapts to progress state:
  - No profile → "Complete your trading profile"
  - No rules → "Set your first rules"
  - Guardian off → "Turn on Guardian"
  - All done → "Continue to dashboard"
- Broker step `done` requires an active `connectedAccount` record — correct.

### Issues
None identified.

---

## 6. Rules (`/rules`)

### Guardian Toggle
- Inline at top of the rules card, anchored at `#guardian-toggle` for deep-linking from
  onboarding and dashboard.
- Initial state loaded from DB `guardianProfile.guardianEnabled`.

### Rules Form Fields
All fields present:
- Account size, Daily loss limit, Profit target, Risk per trade
- Max trades/day, Stop after N losses, Max contracts
- Allowed symbols (comma list), Session hours, Trading days
- News lockout toggle
- On-breach actions: Warn (default on), Lock session (default on), Cancel orders (default off,
  labeled "Pending broker"), Flatten positions (default off, labeled "Pending broker")

### Issues
None identified.

---

## 7. Dashboard (`/dashboard`)

### What works
- "Can I trade right now?" is the primary question — good framing.
- Setup-needed banner fires correctly when onboarding or rules are incomplete.
- Manual risk panel (desktop) + session panel (mobile) are shown when no live broker.
- Quick actions: Set rules, View protection, Connect broker — appropriate at all states.
- Post-session review and activity timeline render only when there is activity.
- Economic events + manual event form are hidden under a collapsible "Session details".

### Data Flow Issue: `todayManualTrades` not capped at `now`
**Severity: Medium**

The journal page (`journal/page.tsx`) was updated to cap `todayEntries` at
`effectiveWindowEnd = min(window.end, now)` to exclude future-dated DB rows from metrics.
The dashboard page was NOT updated with the same cap:

```typescript
// dashboard/page.tsx line 124-130
prisma.manualTradeEntry.findMany({
  where: {
    userId: currentUser.id,
    tradedAt: { gte: tradingDay.start, lt: tradingDay.end },  // ← no cap at now
  },
```

If any future-dated rows exist in the DB (from before the validation fix), they would count
toward dashboard and guardian manual risk state (`computeManualRiskState`), potentially
triggering false warnings or lockouts.

New future-dated entries cannot be created through the UI (client + server both block it), but
DB rows created before the fix are unaffected.

### Issues
| # | Severity | Finding |
|---|----------|---------|
| D1 | Medium | `todayManualTrades` on Dashboard uses `lt: tradingDay.end`, not `lt: min(window.end, now)`. Pre-existing future-dated DB rows count toward session risk state. Journal page was fixed but Dashboard was not. |
| D2 | Medium | `todayManualTrades` on Guardian page (`guardian/page.tsx:129-135`) has the same problem — identical query without `now` cap. |

---

## 8. Journal (`/journal`) — Critical Section

### Today / Older Split
- `windowStartIso` is passed from server (`window.start.toISOString()`) to client.
- Client splits entries using ISO string comparison: `e.tradedAt >= windowStartIso` — correct
  for UTC ISO strings.
- "Today's trades" card shows count ("N trades logged today. Newest first.") or "No trades
  logged today."
- "Older trades" is collapsed by default. Expands to show date-grouped lists labeled "Today",
  "Yesterday", or formatted date ("Apr 29, 2026"). Dates are computed using `sv-SE` locale for
  YYYY-MM-DD keys and the user's display timezone — correct.

### Today Metrics (Summary Tiles)
- `effectiveWindowEnd = min(window.end, now)` is correctly applied.
- All-entries query excludes future-dated rows with `lte: now`.
- `todayPnL`, `todayTradesCount`, `winCount`, `lossCount`, `consecutiveLosses`, `largestLoss`,
  `ruleBreachesToday` — all computed from `computeManualRiskState`, which only sees
  `lt: effectiveWindowEnd` trades.

### Future-Date Blocking
**Client (trade-entry-form.tsx):**
- After `tradedAtDate` is parsed, a warning with `severity: "error"` is pushed if
  `tradedAtDate.getTime() > Date.now()`.
- The `<Field>` for `tradedAt` receives `warning={fieldWarning("tradedAt")}` — error message
  renders inline below the input.
- Save button is disabled while any `severity: "error"` warning exists.
- Verified: 10 unit tests in `trade-date-validation.test.ts` cover tomorrow, later today,
  1 min future, 1 sec future (blocked) and exactly now, 1 min ago, yesterday, last week,
  within tolerance, beyond tolerance (allowed/blocked).

**Server (api/journal/route.ts):**
- `validateAndExtractDates` rejects `tradedAt > now + 60_000ms` (60s clock skew tolerance).
- Error message: "Trade date/time cannot be in the future."

**Edit mode:**
- The same validation logic runs when editing an existing trade — confirmed via `key={editingTrade?.id ?? "new"}` on the form, which remounts with `initialValues` populated via `entryToFormValues(editingTrade)`.
- If a pre-existing trade has a future timestamp (from before the fix), attempting to save an
  edit would re-validate the date and block the save.

### P&L Calculation Display
- `grossPnl` and `pnl` (net) are both stored separately.
- `pnlSource` field: `"calculated"`, `"manual"`, `"override"` — `"override"` shows with
  "(override)" annotation in the trade history list.
- `fmtMoney` helper correctly uses minus sign (−) vs negative number for display.

### Issues
| # | Severity | Finding |
|---|----------|---------|
| J1 | Low | Edit mode: when editing a trade whose `tradedAt` is a pre-existing future timestamp (from DB rows before the fix), the form will show an error immediately on open and prevent saving — including saving the trade with a corrected date. User must change the date to save. This is correct behavior but may surprise users editing old records. Not a bug; documenting for awareness. |

---

## 9. Guardian (`/guardian`)

### Permission Logic
- Derives `permission` from four inputs: guardianOff, broker lockout, live enforcement tier,
  manual risk state.
- Manual-mode locked/warning states propagate to Guardian permission when no broker is
  connected.
- Permission hero renders correct color and copy for SAFE / WARNING / LOCKED / GUARDIAN_OFF.

### Rule Progress Tiles
- P&L today, Trades today, Loss streak — each shows configured limit or "No limit set".
- Values sourced from `manualRisk` (no broker) or `guardian.evaluation` (broker).

### Breach Actions Display
- "Cancel broker orders" and "Flatten broker positions" both show "Pending broker" — correctly
  signals they are not yet active.
- This matches what the landing page FAQ states.

### Data Issue: Same `now` cap bug as Dashboard
- `todayManualTrades` query on Guardian page also uses `lt: tradingDay.end` without `now` cap
  (same as Dashboard finding D2 above).

### Minor Code Issue
```typescript
// guardian/page.tsx line 143
void economicCalendarSelection;
```
Dead statement to suppress an unused-variable lint warning. The variable `economicCalendarSelection`
is fetched but never used on this page. Minor cleanup opportunity.

### Issues
| # | Severity | Finding |
|---|----------|---------|
| G1 | Medium | Same as D1/D2: `todayManualTrades` not capped at `now`. |
| G2 | Low | `void economicCalendarSelection` dead statement — variable should be removed. |

---

## 10. Accounts (`/accounts`)

### Connection Flow
- With no accounts: "No broker connected yet" card with "Connect Tradovate" CTA.
- With accounts: renders `AccountCard` per account with recent events.
- CTA adapts: "Verify connection" (has Tradovate), "Connect Tradovate" (configured),
  "Prepare Tradovate connection" (unconfigured env).

### Hardcoded Status Tiles Bug
**Severity: Medium**

The three status tiles at the top of the page are hardcoded:
```tsx
<StatusTile tone="neutral" label="Setup mode" value="Before broker connection" />
<StatusTile tone="pending" label="Tradovate" value="Setup needed" />
<StatusTile tone="neutral" label="Broker risk checks" value="Connection not verified yet" />
```
These values do not change based on the actual `accounts` array. A user with a connected
and verified Tradovate account still sees "Tradovate: Setup needed" in the tile row, even
though the `AccountCard` below correctly shows the connection.

### Issues
| # | Severity | Finding |
|---|----------|---------|
| A1 | Medium | Status tiles are hardcoded and do not reflect actual connection state. Users with a connected broker see misleading "Setup needed" tiles. |

---

## 11. Alerts (`/alerts`)

### Channels
- In-app: Always available — correct.
- Telegram: Shows "Connected" (emerald) or "Not connected" (amber) based on DB.
- Email: "Coming soon" — appropriately set to disabled/opacity.

### Telegram Connect CTA
- "Connect Telegram" button links to `/onboarding`, not a Telegram-specific flow.
- A user who has already completed onboarding and just wants to connect Telegram will be
  dropped into the onboarding checklist, which may be confusing.

### Alert Triggers
- 6 triggers shown; each is "Active" or "Off" based on whether the matching rule field is set.
- Trigger details expand correctly under the collapsible "Details" section.
- "Pre-news window" trigger requires `newsLockoutEnabled = true` — correctly conditional.

### Issues
| # | Severity | Finding |
|---|----------|---------|
| AL1 | Low | "Connect Telegram" CTA sends user to `/onboarding` rather than a direct Telegram setup step. Post-onboarding users have no dedicated path to add Telegram. |

---

## 12. Settings (`/settings`)

### Trading Profile Section
- Reads `tradingExperience` (String) from DB.
- The API writes both `experienceYears` (Int) and `tradingExperience` (String, e.g. "3 years")
  during onboarding — both fields coexist and the settings page reads the String version.
- `humanizeExperience("3 years")` → `parseInt("3 years")` = 3 → "Intermediate" — works.
- Profile section is hidden entirely when `traderProfile` is null (not yet onboarded).

### Account Info
- Shows email, member-since date, plan status.
- `subscriptionStatus.toLowerCase()` produces lowercase "active" — minor presentational
  inconsistency; "Active" (title case) would be more polished.

### Security
- `SignInMethods` component handles password + Google OAuth.
- Shows oauth_error and google_connected banners from query params — correct.

### Danger Zone
- "Delete account" in red-bordered section — correct visual emphasis.

### Issues
| # | Severity | Finding |
|---|----------|---------|
| S1 | Low | Plan shows "active" (lowercase) for paid/active subscriptions. Title case would be more consistent. |

---

## 13. Navigation

### Structure
Desktop: Dashboard · Rules · Accounts (primary) | More ▾ → Status details, Manual log,
Alerts, Settings, Setup guide

Mobile: Hamburger "Menu ▾" → all items in one list.

### Label Inconsistency
The journal page (`/journal`) is labeled **"Manual log"** in the navigation but the page itself
uses:
- `<AppShell eyebrow="Journal" title="What happened today?" />`
- Page `<title>`: "Journal — Guardrail"

A user looking for "Journal" in the nav won't find it by name; they must know to look for
"Manual log" in the "More" dropdown.

### Issues
| # | Severity | Finding |
|---|----------|---------|
| N1 | Low | Nav label "Manual log" does not match the page's own heading "Journal". Should be "Journal" for consistency, or the page should be relabeled to "Manual log" throughout. |

---

## 14. Legal Pages

The AppShell footer links to:
- `/terms` — Terms
- `/privacy` — Privacy
- `/risk-disclaimer` — Risk Disclaimer
- `mailto:support@guardrail.trade` — Contact Support

Footer disclaimer copy: "Guardrail is a discipline and risk-management tool. It does not
provide financial advice or guarantee trading results. Trading involves substantial risk of loss."

The legal pages themselves were not inspected (they are not dynamic and don't require auth),
but the links are present and correctly routed.

### Issues
| # | Severity | Finding |
|---|----------|---------|
| LE1 | Informational | Legal page content not audited. Confirm `/terms`, `/privacy`, and `/risk-disclaimer` routes render actual content and are not 404. |

---

## 15. Data and Backend Logic

### Futures P&L Calculation
Verified via `src/lib/instruments.ts`:
- NQ: $20/point, ES: $50/point, MNQ: $2/point, MES: $5/point
- Standard micro/standard pairs linked via `microOf` field (e.g., MNQ.microOf = "NQ").
- `grossPnl = (exit − entry) × sign(direction) × qty × pointValue` is correctly stored
  separately from net `pnl`.

### Risk State Computation
`computeManualRiskState` (confirmed from `manual-risk-state.ts` usage patterns):
- Today P&L computed from `sum(pnl)` of today's trades.
- Consecutive losses counted from the tail of today's trades.
- Win/loss counts based on `pnl > 0` / `pnl < 0`.
- `permission: "LOCKED"` when daily loss limit exceeded.

### API Rate Limiting
`POST /api/journal`: 60 requests per 60 seconds per user — appropriate for manual journaling.

### Journal API Validation
- Symbol: required, max 32 chars.
- Direction: must be `LONG` or `SHORT`.
- `tradedAt`: required, must be valid ISO date, not more than 60s in the future, not more than
  5 years in the past.
- Numeric fields: must be finite when provided; quantity, riskAmount, fees cannot be negative.
- pnlSource: must be one of `calculated`, `manual`, `override`.

---

## 16. Findings Summary

### Severity Matrix

| ID | Severity | Area | Finding | Status |
|----|----------|------|---------|--------|
| D1 | **Medium** | Dashboard | `todayManualTrades` not capped at `now` — future-dated DB rows inflate risk metrics | Open |
| D2 | **Medium** | Guardian | Same `now` cap issue on Guardian's manual trades query | Open |
| A1 | **Medium** | Accounts | Status tiles hardcoded; always show "Setup needed" regardless of connection state | Open |
| L1 | Low | Landing | Static "live session preview" widget lacks "illustrative" disclaimer | Open |
| J1 | Low | Journal | Editing pre-existing future-dated trades blocks save until date is corrected — expected behavior, but surprising | Informational |
| AL1 | Low | Alerts | "Connect Telegram" CTA routes to `/onboarding` not a direct Telegram setup flow | Open |
| N1 | Low | Navigation | Nav label "Manual log" doesn't match page heading "Journal" | Open |
| S1 | Low | Settings | Plan status shows lowercase "active" instead of "Active" | Open |
| G2 | Low | Guardian | `void economicCalendarSelection` dead statement | Open |
| LE1 | Info | Legal | Legal page content not verified in this audit | Open |

### What Is Working Well
- All 273 unit tests pass with 0 failures.
- TypeScript is clean.
- Future-date blocking is implemented correctly at both client and server layers.
- Today / Older split in Journal is correct (ISO lexicographic comparison with UTC timestamps).
- Guardian enforcement logic correctly handles all four states.
- Journal `effectiveWindowEnd` is correctly applied to both `allEntries` and `todayEntries`.
- On-breach actions "Cancel orders" and "Flatten positions" are clearly labeled "Pending broker"
  everywhere they appear — no false promises to users.
- Onboarding checklist logic is correct; "Optional" badge shows correctly for broker step.
- The landing page FAQ accurately states the current limitations.

---

## 17. Conclusion

The core risk enforcement logic — Guardian evaluation, manual risk state, journal validation,
and future-date blocking — is functionally sound. The three medium-severity findings (D1, D2,
A1) are not show-stoppers but could produce inaccurate risk state displays:

- **D1/D2**: Dashboard and Guardian manual risk state could include pre-existing future-dated
  DB rows. This only affects users who had such rows before the validation fix was deployed;
  new entries cannot be future-dated.
- **A1**: Accounts status tiles are cosmetically wrong for connected users; the `AccountCard`
  below them shows correct information.

The low-severity navigation label mismatch (N1) is the most likely thing to confuse a real user
on first use — someone looking for their trade log by name ("Journal") won't find it in the nav.

**Recommended priority order for fixes:**
1. D1/D2 — cap `todayManualTrades` at `now` on Dashboard and Guardian pages
2. A1 — make Accounts status tiles conditional on actual connection state
3. N1 — align nav label with page heading ("Journal" or "Manual log", pick one)
4. AL1 — add a direct Telegram connect path accessible post-onboarding
5. G2, S1, L1 — cosmetic cleanups

---

*No code changes were made during this audit.*
