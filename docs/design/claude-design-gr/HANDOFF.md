# Guardrail · Trading Plan — Claude Code Handoff

> **Scope:** UI-only refactor of the Trading Plan / Trading Rules page.
> No backend, schema, evaluator, broker integration, or submit-payload changes.

---

## 0. Design source of truth

The design lives in `Trading Plan.html`. Open it in a browser, switch between the
three sections in the canvas:

1. **Desktop** — Overview, Editor, Account-picker open
2. **Mobile** — Overview, Editor
3. **States** — every rule-card / save-button / enforcement-chip state on one screen

Pixel values, spacing, colors and radii are all expressed via CSS custom
properties in `gr-tokens.jsx`. Treat that file as the spec.

---

## 1. Visual direction

| | |
|---|---|
| Background | `#f3ece0` warm cream paper |
| Surface | `#ffffff` on warm bg |
| Ink | `#1b1812` (warm charcoal, not pure black) |
| Primary | `#a23d10` copper |
| OK · Warn · Bad | `#3f7c2a` · `#b87618` · `#a72d1f` |
| Broker · Lock · Monitor · Saved · Planned | green · indigo · amber · neutral · dashed neutral |
| Display serif (rare) | Instrument Serif |
| UI sans (default) | Geist (fallback: Söhne, Inter, system) |
| Numeric mono | Geist Mono with `font-variant-numeric: tabular-nums` |
| Radius | 14 (cards), 9 (inputs/buttons), 7 (small) |
| Card shadow | none in default state; selected uses `box-shadow: 0 0 0 4px var(--copper-bg)` halo |

The **only** place the serif appears today is the Overview hero h1.
Do **not** use it for rule names, numeric values, or labels.

---

## 2. Suggested file layout (Next/Vite app, Tailwind)

```
app/(authed)/trading-plan/
  page.tsx                   ← Overview (default)
  [ruleId]/page.tsx          ← Editor (focused)
  layout.tsx                 ← Shared shell (sidebar + breadcrumb)

components/trading-plan/
  RuleCard.tsx               ← all states from §4 below
  RuleRow.tsx                ← sidebar list item
  EnforcementChip.tsx        ← §3
  AccountSelector.tsx        ← grouped popover
  SaveBar.tsx                ← sticky bottom bar
  SaveButton.tsx             ← stateful button (§5)
  rules/
    DailyLossEditor.tsx
    RiskPerTradeEditor.tsx
    MaxTradesEditor.tsx
    TiltProtectionEditor.tsx
    MaxContractsEditor.tsx
    PerSymbolEditor.tsx
    SessionCutoffEditor.tsx
    NotificationsEditor.tsx
    BrokerActionsEditor.tsx  ← always read-only / Planned state

components/ui/                ← shared, reusable
  Badge.tsx Switch.tsx Segmented.tsx Chip.tsx Tabs.tsx
  Progress.tsx Sparkline.tsx Kbd.tsx
```

---

## 3. Enforcement chip (`EnforcementChip.tsx`)

The chip is the **honesty contract** of the page. Never render a chip whose
label doesn't match what the backend actually does on breach.

```ts
type Enforcement =
  | 'broker'        // broker-enforced (e.g. Tradovate-backed daily loss)
  | 'lock'          // Guardrail blocks order submission at the app layer
  | 'monitor'       // tracks + notifies; never blocks
  | 'mon-planned'   // monitor today, lock planned
  | 'saved'         // saved config, evaluation coming
  | 'planned'       // not active yet
  | 'utility';      // no chip rendered (notifications, etc.)
```

Chip colors map to enforcement strength (strongest → faintest):
broker (green) → lock (indigo) → monitor (amber) → saved (neutral) → planned (dashed).

**Tooltip text on each chip is required** — see `ENFORCEMENT[type].tip` in
`gr-data.jsx`. Copy verbatim.

---

## 4. Rule card states (`RuleCard.tsx`)

Single component; state derives from the rule object — no separate variants.

| State | Trigger | Visual marker |
|---|---|---|
| `clean` | default | base border |
| hover | `:hover` | `border-color: var(--border-hi)`, bg shifts to `--bg-elev` |
| `selected` | route param matches | copper border + `box-shadow: 0 0 0 4px var(--copper-bg)` halo |
| `disabled` (rule.on === false) | toggle off | `opacity: 0.55`, lock icon in footer |
| `changed` | dirty vs. template | small copper dot top-right, "Override" tag in footer |
| `unsaved` | dirty vs. server | small amber dot top-right, "Unsaved" tag in footer |
| `inherited` | matches template, not changed | copy-icon + "From template" tag in footer |
| `planned` | rule.enforcement === 'planned' | dashed chip, no usage bar, gray value |

Click handler:
- Card itself → navigate to `/trading-plan/[ruleId]` (Editor)
- "Configure" button inside footer → same; `stopPropagation` so the focus ring doesn't double-fire

---

## 5. Save button states (`SaveButton.tsx`)

```ts
type SaveState =
  | 'clean'      // no diff; render "Saved · 2m ago" ghost button
  | 'unsaved'    // primary button with count: "Save 3 changes"
  | 'disabled'   // visually muted, no changes possible
  | 'locked';    // session active — warn-tinted "Locked · session active" + lock icon
```

Sticky `<SaveBar />` only renders when `state === 'unsaved'`.

---

## 6. Account selector (`AccountSelector.tsx`)

- Trigger: compact row with broker badge ("AP" / "TS" / "TV"), name, ref, live/demo/expired chip
- Popover:
  - Search input at top
  - Accounts grouped by broker (Apex, TopStep, Tradovate, …)
  - Each account row shows: name + state chip + masked balance + checkmark when selected
  - **Expired** accounts show a `Reconnect` button in copper; dimmed otherwise
  - "Connect another account" link at bottom
- Selecting an account → updates URL search param `?accountId=…` and refetches rules
- No tiny meta text inside the trigger — keep it ≤ 2 lines

---

## 7. Overview vs Editor routing

| Route | Component | Notes |
|---|---|---|
| `/trading-plan` | `Overview` | All rule cards in grid, filter chips, KPI strip |
| `/trading-plan/[ruleId]` | `Editor` | Sidebar with rule list (selected highlighted) + focused editor on right; route is shareable |

Clicking a card on Overview navigates; closing the editor (or clicking breadcrumb) goes back.

### Editor modes

The same `<Editor />` component handles three runtime modes — derive them, don't fork:

| Mode | Trigger | Visual contract |
|---|---|---|
| `default` | clean, no dirty fields, session not locked | header shows `<SaveButton state="clean">`; no banner |
| `unsaved` | any field diverges from server state | **copper banner** under the header: "N unsaved changes · Threshold · Warning · …" with Discard + Save buttons; header SaveButton flips to `state="unsaved"`; the list rail shows a small copper dot on each changed rule (`gr-rule--changed`) |
| `locked` | session is in a locked window (e.g. daily-loss breach until reset) | **warn banner** under the header explaining why and when the reset is; inputs and switches are visually disabled (`opacity: 0.62, pointer-events: none`); header SaveButton flips to `state="locked"` |

The banner replaces the floating bottom save bar entirely. Floating bars read as
modals on this layout — they're not used in the final design.

---

## 8. Tailwind token direction

Map the CSS variables from `gr-tokens.jsx` to a Tailwind theme extension:

```js
// tailwind.config.ts (excerpt)
extend: {
  colors: {
    bg:        'var(--bg)',
    surface:   'var(--surface)',
    'surface-2': 'var(--surface-2)',
    border:    'var(--border)',
    ink:       'var(--ink)',
    'text-mid': 'var(--text-mid)',
    copper:    { DEFAULT: 'var(--copper)', hi: 'var(--copper-hi)' },
    broker:    { DEFAULT: 'var(--broker)', bg: 'var(--broker-bg)' },
    lock:      { DEFAULT: 'var(--lock)',   bg: 'var(--lock-bg)' },
    mon:       { DEFAULT: 'var(--mon)',    bg: 'var(--mon-bg)' },
    saved:     { DEFAULT: 'var(--saved)',  bg: 'var(--saved-bg)' },
    plan:      { DEFAULT: 'var(--plan)',   bg: 'var(--plan-bg)' },
    ok:   { DEFAULT: 'var(--ok)',   bg: 'var(--ok-bg)' },
    warn: { DEFAULT: 'var(--warn)', bg: 'var(--warn-bg)' },
    bad:  { DEFAULT: 'var(--bad)',  bg: 'var(--bad-bg)' },
  },
  borderRadius: { sm: '7px', md: '9px', lg: '14px' },
  fontFamily: {
    sans:    ['Geist', 'Söhne', 'Inter', 'system-ui'],
    mono:    ['Geist Mono', 'JetBrains Mono', 'ui-monospace'],
    display: ['Instrument Serif', 'Tiempos', 'Georgia'],
  },
  fontFeatureSettings: {
    nums: '"tnum","zero","ss01"',
  },
}
```

Inject the CSS variables in a `globals.css` once, exactly as in `gr-tokens.jsx`.

---

## 9. Mobile behaviour

- Side rail → hidden behind hamburger (`<Sheet />`)
- KPI strip → 2-up grid instead of 4-up
- Rule grid → single column
- Editor sections → stacked, full width
- Save → always pinned to bottom (safe-area inset), full-width primary
- Account selector → opens as full-height bottom sheet on mobile, popover on desktop

---

## 10. What to replace vs leave alone

**Replace:**
- Existing Trading Rules / Trading Plan page layout
- Any ad-hoc badge / button / switch that's not from the shared `components/ui` set
- Old enforcement copy that overstates capability (e.g. claiming "auto-flatten" is active when it isn't)

**Leave untouched:**
- Backend rule schemas
- Evaluator logic
- Broker / Tradovate API calls and reconnect flows
- Rule definitions and IDs (`daily-loss`, `risk-trade`, `max-trades`, `tilt`, `max-contracts`, `per-symbol`, `session`, `notifs`, `broker-actions`)
- Submit payload shape
- Auth, env, deployment

---

## 11. Copy rules

- Daily loss limit → **Broker-backed** when eligible; explainer card visible inside editor
- Risk per trade → **Monitor**
- Max trades per day → **App lock**
- Tilt protection → **App lock**
- Max contracts → **App lock**
- Per-symbol limits → **Saved** (evaluation in next release)
- Session cutoff → **Monitor · Lock planned**
- Notifications → utility (no enforcement chip)
- Advanced broker actions → **Planned** — show all sub-actions as `disabled` toggles inside the "Planned · not active" group; never as ON

**Forbidden phrasing in current release:**
- "Auto-flatten positions"
- "Cancel all open orders"
- "Lock account at broker"
- Any wording that implies Guardrail can act inside the broker before the broker integration ships

These strings may exist only inside the "Planned · not active" block.

---

## 12. Safety constraints

- **UI only** — no API, schema, evaluator, broker, env, or auth changes
- **Preserve all current rule logic and labels** — rule IDs, validation, units, ranges
- **Preserve current submit payload** — same fields, same shape
- **Do not invent rules** — only the 9 above
- **Do not invent enforcement** — chip label must match real backend behavior
- Use existing data hooks (`useRules`, `useAccounts`, etc.); only refactor presentation
- Tests covering rule evaluator behavior must continue to pass unchanged
