# Trading Plan field matrix — default vs account, broker enforcement

Single canonical reference for every field on the Trading Plan rules form.
Source-of-truth for which fields are editable on which page, which DB
column they live in, and what broker enforcement (if any) Guardrail
performs when the value is saved.

For the broker-call mechanics see [`docs/broker-enforcement-matrix.md`](./broker-enforcement-matrix.md).

## Legend

- **Default** — the per-user `RiskRules` table; one row per user.
- **Account** — the per-account `AccountRiskRules` table; one row per
  connected broker account.
- **Editable on default** — the field is exposed in the default-template
  Trading Plan form (`src/app/rules/_components/rules-form.tsx`).
- **Editable on account** — the field is exposed in the account-specific
  Trading Plan form (`src/app/rules/_components/account-rules-form.tsx`).
- **Inherited** — when account override is null, the form's effective
  active baseline falls back to the default template's value.

## Matrix

| Rule | UI label | RiskRules column | AccountRiskRules column | Editable on default | Editable on account | If not editable on account, behaviour | Broker enforcement |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Account size | "Account size ($)" | `accountSize` | — | yes | no | inherited (read-only context inside Money limits) | n/a (display only) |
| Daily loss limit | "Daily loss limit ($)" | `maxDailyLoss` | `maxDailyLoss` | yes | yes | inherited when override empty | broker-enforced (reactive) via `userAccountAutoLiq` |
| Daily profit target | "Daily profit target ($)" | `dailyProfitTarget` | — | yes | no | inherited | broker-enforced (reactive) via `userAccountAutoLiq` — live QA pending |
| Risk per trade | "Risk per trade ($)" | `maxRiskPerTrade` (legacy) + `riskPerTrade` | `riskPerTrade` | yes | yes | inherited when override empty | warning only (no broker call) |
| Max trades per day | "Max trades per day" | `maxTradesPerDay` | `maxTradesPerDay` | yes | yes | inherited when override empty | internal-only (no Tradovate field) |
| Stop after consecutive losses | "Stop after consecutive losses" | `stopAfterLosses` | `stopAfterLosses` | yes | yes | inherited when override empty | internal-only (no Tradovate field) |
| Max position size | "Max position size" | `maxContracts` | `maxContracts` | yes | yes | inherited when override empty | broker-enforced (pre-emptive cap) via `userAccountPositionLimit` + `userAccountRiskParameter.hardLimit=true` — **live reject pending demo** ([`docs/ops/tradovate-position-limit-demo.md`](./ops/tradovate-position-limit-demo.md)) |
| Daily cutoff | "Stop trading at (CME hour)" | `sessionEndHour` | `allowedEndHour` | yes | yes | inherited when override empty | internal-only — scheduler not wired (`flattenTimestamp` unverified) |
| Cutoff behavior | "At cutoff" radios | `sessionEndBehavior` | `sessionEndBehavior` | yes | yes | inherited when override empty | internal-only |
| Notifications (alert on breach) | "Send alert when a rule is triggered" | `onBreachWarn` | — | yes | no | inherited (Notifications card is read-only) | n/a (alert delivery, not broker) |
| Trading session window | preset chips + custom hours | `sessionPresetsJson`, `sessionStartTime`, `sessionEndTime`, `sessionTimezone`, `sessionPreset` | same | yes | yes | independent override per account | internal-only |
| Rule edit lock buffer | "Rule edit lock buffer (minutes)" | `ruleEditLockBufferMinutes` | `ruleEditLockBufferMinutes` | yes | yes | inherited when override empty | internal-only (governs Guardrail edit gate, not the broker) |
| Guardian toggle | "Guardian protection" | (per-user `GuardianStatus` row) | (per-user) | yes (page-level toggle, not the form) | no | per-user only | internal-only |

## Section structure (after Trading Plan parity refactor)

Both the default-template form and the account-specific form expose the
same five top-level sections in the same order:

1. **Money limits** — Daily loss limit, Risk per trade. The default form
   additionally exposes Account size and Daily profit target as editable
   fields; the account form surfaces them as small "Inherited" rows in a
   mini-table at the top of the section.
2. **Trading limits** — Max trades per day, Stop after consecutive losses,
   Max position size. Identical fields on both forms.
3. **Daily cutoff** — Cutoff CME hour + cutoff-behavior radios, in the
   same card. (The behavior radios used to live in a separate "At cutoff"
   card on the account form — that card has been folded back in.)
4. **Notifications** — On the default form this is the editable
   "Send alert when a rule is triggered" checkbox; on the account form
   this is a single read-only "Inherited" card explaining that breach
   alerts are configured on the default template.
5. **Trading Session** — `<TradingSessionSelector>` component, identical
   on both forms.

The pending changes panel and submit row sit below all five sections.
The account form additionally renders, above the submit row, a
"Pending changes saved" panel with a 3-column diff (Rule | Active now |
Pending next) when there are deferred changes.

The "Inherited" / "Override" / "Not set" tags next to active values
are produced by `renderActiveSourceTag(activeSource)` consuming the
`activeSource` field from `computePendingFieldRowsWithSource`. Logic
lives in `src/app/rules/_components/account-rules-form-logic.ts` and
is fully covered by `account-rules-form-logic.test.ts`.

## Save-state copy after a pending save

When the save was deferred (account or user is in active trading), the
form button label flips to **"Saved as pending"** and a status line
reads:

> Saved as pending — these rules will activate at the next safe window.

This avoids the previous ambiguous wording (the raw `pendingMessage`
echo from the API) and matches the pending panel header. The button
re-enables immediately on the next edit so the user can continue
iterating.

## Suggested additions (deferred)

These Tradovate-supported fields are not currently exposed in the
Trading Plan form:

- Weekly loss limit (`userAccountAutoLiq.weeklyLossAutoLiq`)
- Weekly profit target (`userAccountAutoLiq.weeklyProfitAutoLiq`)
- Trailing max drawdown (`trailingMaxDrawdown` + `trailingMaxDrawdownLimit`)
- Per-product position limits (`userAccountPositionLimit.totalBy = "PerProduct"`)
- Allowed products / symbols (Tradovate may expose this through risk
  settings — needs API audit)

Defer until after the Max Position Size demo verification is signed off.
