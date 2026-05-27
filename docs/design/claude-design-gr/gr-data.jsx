// Guardrail · real product data: grouped accounts + actual rules with
// honest enforcement labels.

// Enforcement types — keep in sync with backend:
//   broker      — Broker-backed (e.g. Tradovate-enforced daily loss limit)
//   lock        — App-layer lock (Guardrail blocks order submission)
//   monitor     — Monitor only (Guardrail tracks + notifies, never blocks)
//   saved       — Saved but evaluation/enforcement coming soon
//   mon-planned — Currently monitor-only; lock enforcement planned
//   planned     — Not yet implemented; visible as roadmap item
//   utility     — Cross-cutting setting (e.g. notifications)
const ENFORCEMENT = {
  broker:        { label: 'Broker-backed', short: 'Broker',    badge: 'broker', icon: 'shield',   tip: 'Enforced by the broker. Cannot be bypassed by the trader once live.' },
  lock:          { label: 'App lock',      short: 'Lock',      badge: 'lock',   icon: 'lock',     tip: 'Guardrail blocks order submission at the app layer before it reaches the broker.' },
  monitor:       { label: 'Monitor',       short: 'Monitor',   badge: 'mon',    icon: 'bell',     tip: 'Guardrail tracks and notifies. It does not block trades.' },
  saved:         { label: 'Saved',         short: 'Saved',     badge: 'saved',  icon: 'bookmark', tip: 'Configuration is stored. Evaluation coming in a future release.' },
  'mon-planned': { label: 'Monitor · Lock planned', short: 'Monitor', badge: 'mon', icon: 'bell', tip: 'Currently monitor only. Lock enforcement is on the roadmap.' },
  planned:       { label: 'Planned',       short: 'Planned',   badge: 'plan',   icon: 'sparkle',  tip: 'Not active yet. Listed as a roadmap item.' },
  utility:       { label: '',              short: '',          badge: 'neutral',icon: 'bell',     tip: '' },
};

// Accounts grouped by broker / prop firm
const GR_ACCOUNT_GROUPS = [
  {
    broker: 'Apex Trader Funding',
    short: 'Apex',
    accounts: [
      { id: 'apex-1', name: 'Eval $50K',     ref: 'APEX-50-12091', state: 'live',     balance: 49160,  todayPnl: -840,  selected: true },
      { id: 'apex-2', name: 'PA $100K',      ref: 'APEX-100-30412', state: 'live',    balance: 103420, todayPnl: 2340,  selected: false },
    ],
  },
  {
    broker: 'TopStep',
    short: 'TopStep',
    accounts: [
      { id: 'ts-1', name: 'Combine $50K',    ref: 'TS-77150',      state: 'live',     balance: 51200,  todayPnl: 180,   selected: false },
    ],
  },
  {
    broker: 'Tradovate',
    short: 'Tradovate',
    accounts: [
      { id: 'tv-1', name: 'Personal · Live', ref: 'TV-2200',       state: 'live',     balance: 22840,  todayPnl: 0,     selected: false },
      { id: 'tv-2', name: 'Personal · Demo', ref: 'TV-2201-DEMO',  state: 'demo',     balance: 100000, todayPnl: -120,  selected: false },
      { id: 'tv-3', name: 'Sim Old',         ref: 'TV-1004',       state: 'expired',  balance: 0,      todayPnl: 0,     selected: false },
    ],
  },
];

// Rules — match real Guardrail surface area
const GR_RULES = [
  {
    id: 'daily-loss',
    name: 'Daily loss limit',
    group: 'Capital',
    enforcement: 'broker',
    on: true,
    selected: true,
    status: 'warn',
    valueLabel: '$1,200',
    sub: 'Resets at 17:00 ET',
    usagePct: 70,
    usageLabel: '$840 used',
    desc: 'Stops trading when realised + unrealised P&L drops below the limit. Broker-backed when the account is eligible — otherwise enforced at the app layer.',
    state: 'changed', // changed | unsaved | inherited | clean
  },
  {
    id: 'risk-trade',
    name: 'Risk per trade',
    group: 'Capital',
    enforcement: 'monitor',
    on: true,
    status: 'ok',
    valueLabel: '1.0%',
    sub: '≈ $500 on $50K',
    usagePct: 70,
    usageLabel: 'avg 0.7% last 20 trades',
    desc: 'Warns when an order would risk more than this % of balance based on stop distance.',
    state: 'inherited',
  },
  {
    id: 'max-trades',
    name: 'Max trades per day',
    group: 'Discipline',
    enforcement: 'lock',
    on: true,
    status: 'ok',
    valueLabel: '12',
    sub: 'Trades counted at fill',
    usagePct: 58,
    usageLabel: '7 of 12 today',
    desc: 'Guardrail blocks the 13th order submission for the trading day.',
    state: 'clean',
  },
  {
    id: 'tilt',
    name: 'Tilt protection',
    group: 'Discipline',
    enforcement: 'lock',
    on: true,
    status: 'ok',
    valueLabel: '3 losses in a row',
    sub: 'Pause 30 min on trigger',
    usagePct: 33,
    usageLabel: '1 loss · streak resets on a win',
    desc: 'Pauses trading after N consecutive losing trades to interrupt tilt cycles.',
    state: 'clean',
  },
  {
    id: 'max-contracts',
    name: 'Max contracts',
    group: 'Sizing',
    enforcement: 'lock',
    on: true,
    status: 'ok',
    valueLabel: '5 standard-eq.',
    sub: 'Normalised to ES',
    usagePct: 40,
    usageLabel: '2 open · NQ counted ×2',
    desc: 'Caps total open size in standard-equivalent contracts, so micro and full-size are weighed correctly.',
    state: 'clean',
  },
  {
    id: 'per-symbol',
    name: 'Per-symbol limits',
    group: 'Sizing',
    enforcement: 'saved',
    on: true,
    status: 'idle',
    valueLabel: '4 symbols',
    sub: 'NQ · MNQ · ES · MES',
    usagePct: 0,
    usageLabel: 'Saved · evaluation in next release',
    desc: 'Per-instrument size caps. Saved configuration; evaluation is part of the next release.',
    state: 'clean',
  },
  {
    id: 'session',
    name: 'Session cutoff',
    group: 'Schedule',
    enforcement: 'mon-planned',
    on: true,
    status: 'ok',
    valueLabel: '08:30 – 16:00 ET',
    sub: 'Mon–Fri',
    usagePct: 100,
    usageLabel: 'In session · 4h 12m left',
    desc: 'Notifies when the session ends. Lock enforcement is planned.',
    state: 'clean',
  },
  {
    id: 'notifs',
    name: 'Notifications',
    group: 'Alerts',
    enforcement: 'utility',
    on: true,
    status: 'ok',
    valueLabel: 'Email + Push',
    sub: '3 channels active',
    usagePct: 100,
    usageLabel: 'Delivery for every active rule',
    desc: 'Where Guardrail sends warnings and breach notifications.',
    state: 'clean',
  },
  {
    id: 'broker-actions',
    name: 'Advanced broker actions',
    group: 'Enforcement',
    enforcement: 'planned',
    on: false,
    status: 'planned',
    valueLabel: 'Auto-flatten · Cancel orders · Lockout',
    sub: 'Pending broker integration',
    usagePct: 0,
    usageLabel: 'Planned · Q3 2026',
    desc: 'Direct broker actions on breach. Pending broker integration — not active today.',
    state: 'clean',
  },
];

const GR_GROUPS = ['Capital', 'Discipline', 'Sizing', 'Schedule', 'Alerts', 'Enforcement'];

Object.assign(window, { ENFORCEMENT, GR_ACCOUNT_GROUPS, GR_RULES, GR_GROUPS });
