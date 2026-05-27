// Hi-fi design tokens — modern dark UI for trading platform.
// No gradients, no glow, restrained palette, generous type scale.

const TOKENS = {
  // surfaces
  bg:        '#0a0b0e',
  bgElev:    '#101216',
  surface:   '#13161c',
  surface2:  '#181c24',
  surfaceHi: '#1d222b',
  border:    '#23282f',
  borderHi:  '#2f3640',
  borderSub: '#1a1e25',

  // text
  text:      '#e7e9ee',
  textMid:   '#a8aebb',
  textMute:  '#6b7280',
  textFaint: '#454c57',

  // semantic
  ok:        '#22c55e',
  okBg:      'rgba(34,197,94,0.12)',
  okBorder:  'rgba(34,197,94,0.32)',
  warn:      '#f59e0b',
  warnBg:    'rgba(245,158,11,0.12)',
  warnBorder:'rgba(245,158,11,0.32)',
  bad:       '#ef4444',
  badBg:     'rgba(239,68,68,0.12)',
  badBorder: 'rgba(239,68,68,0.32)',
  info:      '#60a5fa',
  infoBg:    'rgba(96,165,250,0.12)',

  // light theme (mirror)
  L: {
    bg:        '#fafafa',
    bgElev:    '#ffffff',
    surface:   '#ffffff',
    surface2:  '#f5f5f4',
    surfaceHi: '#eeeeec',
    border:    '#e5e5e3',
    borderHi:  '#d4d4d2',
    borderSub: '#efefee',
    text:      '#0a0b0e',
    textMid:   '#52525b',
    textMute:  '#71717a',
    textFaint: '#a1a1aa',
  },
};

// Shared data
const ACCOUNTS = [
  { id: 'eval50',  label: 'Eval $50K',    tv: 'TV-4128', balance: '$49,160', status: 'warn',    pnl: -840  },
  { id: 'fund100', label: 'Funded $100K', tv: 'TV-9102', balance: '$103,420', status: 'ok',     pnl: +2340 },
  { id: 'fund50',  label: 'Funded $50K',  tv: 'TV-7715', balance: '$51,200',  status: 'ok',     pnl: +180  },
  { id: 'pers',    label: 'Personal',     tv: 'TV-2200', balance: '$22,840',  status: 'idle',   pnl: 0     },
];

const RULES = [
  { id: 'daily-loss', name: 'Daily Loss Limit', group: 'Risk', val: 1200, unit: '$', curr: 840, currLabel: '$840 used', pct: 70, status: 'warn', on: true, desc: 'Realized + unrealized P&L floor for the trading day.' },
  { id: 'max-dd',     name: 'Max Drawdown',     group: 'Risk', val: 2500, unit: '$', curr: 1150, currLabel: 'trailing $1,150', pct: 46, status: 'ok', on: true, desc: 'Trailing equity drawdown from highest balance.' },
  { id: 'risk-trade', name: 'Risk per Trade',   group: 'Risk', val: 1,    unit: '%', curr: 500, currLabel: '$500 auto-SL', pct: 100, status: 'ok', on: true, desc: 'Auto stop-loss placement at this % of balance.' },
  { id: 'pos-size',   name: 'Position Size',    group: 'Position', val: 5, unit: 'ct', curr: 2, currLabel: 'NQ, ES capped', pct: 40, status: 'ok', on: true, desc: 'Maximum contracts per instrument.' },
  { id: 'max-open',   name: 'Max Open Positions', group: 'Position', val: 3, unit: '', curr: 2, currLabel: '2 open now', pct: 67, status: 'ok', on: true, desc: 'Concurrent positions across all instruments.' },
  { id: 'profit-tgt', name: 'Daily Profit Target', group: 'Goals', val: 3000, unit: '$', curr: 1840, currLabel: '$1,840 today', pct: 61, status: 'ok', on: true, desc: 'Auto-flatten on hit. Optional.' },
  { id: 'hours',      name: 'Trading Hours',    group: 'Schedule', val: '08:30 – 16:00 ET', unit: '', curr: '', currLabel: 'Mon–Fri', pct: 100, status: 'ok', on: true, desc: 'Reject orders outside session.' },
  { id: 'consistency',name: 'Consistency Rule', group: 'Goals', val: 40, unit: '%', curr: 32, currLabel: 'within range', pct: 80, status: 'ok', on: true, desc: 'Best day ≤ % of total profit (Apex, TopStep…).' },
  { id: 'news',       name: 'News Blackout',    group: 'Schedule', val: '5 min ±', unit: '', curr: '', currLabel: 'CPI Thu 8:30 ET', pct: 0, status: 'bad', on: false, desc: 'Block orders around high-impact events.' },
];

// Inject global CSS once
if (typeof document !== 'undefined' && !document.getElementById('hifi-styles')) {
  const s = document.createElement('style');
  s.id = 'hifi-styles';
  s.textContent = `
    .hi-board {
      --bg: ${TOKENS.bg};
      --bg-elev: ${TOKENS.bgElev};
      --surface: ${TOKENS.surface};
      --surface-2: ${TOKENS.surface2};
      --surface-hi: ${TOKENS.surfaceHi};
      --border: ${TOKENS.border};
      --border-hi: ${TOKENS.borderHi};
      --border-sub: ${TOKENS.borderSub};
      --text: ${TOKENS.text};
      --text-mid: ${TOKENS.textMid};
      --text-mute: ${TOKENS.textMute};
      --text-faint: ${TOKENS.textFaint};
      --ok: ${TOKENS.ok}; --ok-bg: ${TOKENS.okBg}; --ok-bd: ${TOKENS.okBorder};
      --warn: ${TOKENS.warn}; --warn-bg: ${TOKENS.warnBg}; --warn-bd: ${TOKENS.warnBorder};
      --bad: ${TOKENS.bad}; --bad-bg: ${TOKENS.badBg}; --bad-bd: ${TOKENS.badBorder};
      --info: ${TOKENS.info}; --info-bg: ${TOKENS.infoBg};

      font-family: 'Geist', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      font-feature-settings: 'ss01', 'cv11';
      background: var(--bg);
      color: var(--text);
      height: 100%;
      box-sizing: border-box;
      letter-spacing: -0.005em;
      -webkit-font-smoothing: antialiased;
      position: relative;
      overflow: hidden;
    }
    .hi-board.hi--light {
      --bg: ${TOKENS.L.bg}; --bg-elev: ${TOKENS.L.bgElev};
      --surface: ${TOKENS.L.surface}; --surface-2: ${TOKENS.L.surface2}; --surface-hi: ${TOKENS.L.surfaceHi};
      --border: ${TOKENS.L.border}; --border-hi: ${TOKENS.L.borderHi}; --border-sub: ${TOKENS.L.borderSub};
      --text: ${TOKENS.L.text}; --text-mid: ${TOKENS.L.textMid}; --text-mute: ${TOKENS.L.textMute}; --text-faint: ${TOKENS.L.textFaint};
    }
    .hi-board *, .hi-board *::before, .hi-board *::after { box-sizing: border-box; }
    .hi-mono { font-family: 'Geist Mono', 'JetBrains Mono', ui-monospace, monospace; font-feature-settings: 'tnum', 'ss01', 'zero'; letter-spacing: -0.01em; }
    .hi-num { font-variant-numeric: tabular-nums; }

    /* typography */
    .hi-display { font-size: 28px; line-height: 1.15; font-weight: 600; letter-spacing: -0.025em; margin: 0; }
    .hi-h1 { font-size: 20px; line-height: 1.25; font-weight: 600; letter-spacing: -0.018em; margin: 0; }
    .hi-h2 { font-size: 15px; line-height: 1.3; font-weight: 600; letter-spacing: -0.012em; margin: 0; color: var(--text); }
    .hi-label { font-size: 11px; line-height: 1.3; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-mute); margin: 0; }
    .hi-body { font-size: 13px; line-height: 1.5; color: var(--text-mid); margin: 0; }
    .hi-small { font-size: 12px; line-height: 1.4; color: var(--text-mid); }
    .hi-tiny { font-size: 11px; line-height: 1.4; color: var(--text-mute); }
    .hi-meta { color: var(--text-mute); }

    /* layout */
    .hi-row { display: flex; align-items: center; }
    .hi-col { display: flex; flex-direction: column; }
    .hi-g-1 { gap: 4px; } .hi-g-2 { gap: 8px; } .hi-g-3 { gap: 12px; } .hi-g-4 { gap: 16px; } .hi-g-5 { gap: 20px; } .hi-g-6 { gap: 24px; } .hi-g-8 { gap: 32px; }
    .hi-grow { flex: 1 1 auto; min-width: 0; }
    .hi-between { justify-content: space-between; }
    .hi-end { justify-content: flex-end; }

    /* card */
    .hi-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; }
    .hi-card-flat { background: var(--surface); border-radius: 12px; }
    .hi-divider { height: 1px; background: var(--border); }
    .hi-vdiv { width: 1px; background: var(--border); align-self: stretch; }

    /* button */
    .hi-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      font-family: inherit; font-size: 13px; font-weight: 500; letter-spacing: -0.005em;
      padding: 7px 12px; border-radius: 8px; cursor: pointer;
      background: var(--surface-2); color: var(--text);
      border: 1px solid var(--border);
      transition: background .12s, border-color .12s;
      line-height: 1; white-space: nowrap;
    }
    .hi-btn:hover { background: var(--surface-hi); border-color: var(--border-hi); }
    .hi-btn--primary { background: ${TOKENS.text}; color: ${TOKENS.bg}; border-color: ${TOKENS.text}; }
    .hi-board.hi--light .hi-btn--primary { background: ${TOKENS.L.text}; color: ${TOKENS.L.bg}; border-color: ${TOKENS.L.text}; }
    .hi-btn--primary:hover { opacity: 0.92; }
    .hi-btn--ghost { background: transparent; border-color: transparent; color: var(--text-mid); }
    .hi-btn--ghost:hover { background: var(--surface-2); color: var(--text); }
    .hi-btn--danger { background: transparent; color: var(--bad); border-color: var(--bad-bd); }
    .hi-btn--sm { padding: 5px 9px; font-size: 12px; border-radius: 6px; }
    .hi-btn--lg { padding: 10px 16px; font-size: 14px; }
    .hi-btn--icon { padding: 6px; }

    /* badge */
    .hi-badge { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 500; letter-spacing: 0.01em; padding: 3px 8px; border-radius: 999px; line-height: 1.2; border: 1px solid transparent; white-space: nowrap; }
    .hi-badge--ok   { color: var(--ok); background: var(--ok-bg); border-color: var(--ok-bd); }
    .hi-badge--warn { color: var(--warn); background: var(--warn-bg); border-color: var(--warn-bd); }
    .hi-badge--bad  { color: var(--bad); background: var(--bad-bg); border-color: var(--bad-bd); }
    .hi-badge--info { color: var(--info); background: var(--info-bg); border-color: rgba(96,165,250,0.32); }
    .hi-badge--neutral { color: var(--text-mid); background: var(--surface-2); border-color: var(--border); }
    .hi-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: 0 0 auto; }
    .hi-dot-lg { width: 8px; height: 8px; }
    .hi-dot--pulse { box-shadow: 0 0 0 0 currentColor; animation: hi-pulse 2s infinite; }
    @keyframes hi-pulse { 0% { box-shadow: 0 0 0 0 currentColor; } 70% { box-shadow: 0 0 0 6px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }

    /* input */
    .hi-input {
      font-family: inherit; font-size: 14px; color: var(--text);
      background: var(--surface-2); border: 1px solid var(--border);
      border-radius: 8px; padding: 8px 12px; outline: none; width: 100%;
      transition: border-color .12s, background .12s;
    }
    .hi-input:hover { border-color: var(--border-hi); }
    .hi-input:focus { border-color: var(--text-mid); background: var(--surface); }
    .hi-input.hi-mono { font-feature-settings: 'tnum'; }
    .hi-input-affix { display: inline-flex; align-items: stretch; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
    .hi-input-affix:focus-within { border-color: var(--text-mid); }
    .hi-input-affix > .hi-input { border: none; background: transparent; }
    .hi-input-affix > .hi-affix { display: inline-flex; align-items: center; padding: 0 10px; color: var(--text-mute); font-size: 13px; background: var(--surface); border-right: 1px solid var(--border); }
    .hi-input-affix > .hi-affix--right { border-right: none; border-left: 1px solid var(--border); }

    /* toggle */
    .hi-switch { position: relative; width: 30px; height: 18px; background: var(--surface-hi); border-radius: 999px; border: 1px solid var(--border); flex: 0 0 auto; cursor: pointer; transition: background .15s; }
    .hi-switch::after { content: ''; position: absolute; top: 1px; left: 1px; width: 14px; height: 14px; background: var(--text-mid); border-radius: 50%; transition: transform .18s, background .15s; }
    .hi-switch--on { background: var(--ok); border-color: transparent; }
    .hi-switch--on::after { transform: translateX(12px); background: white; }

    /* segmented */
    .hi-seg { display: inline-flex; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 2px; gap: 2px; }
    .hi-seg button { font-family: inherit; font-size: 12px; font-weight: 500; padding: 5px 10px; border: none; background: transparent; color: var(--text-mid); border-radius: 6px; cursor: pointer; }
    .hi-seg button.hi-seg--active { background: var(--surface-hi); color: var(--text); }

    /* chip */
    .hi-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; font-size: 12px; font-weight: 500; background: var(--surface-2); color: var(--text-mid); border: 1px solid var(--border); border-radius: 999px; cursor: pointer; line-height: 1.2; }
    .hi-chip--active { background: var(--surface-hi); color: var(--text); border-color: var(--border-hi); }
    .hi-chip--ghost { border-style: dashed; }

    /* progress */
    .hi-bar { height: 4px; background: var(--surface-hi); border-radius: 2px; overflow: hidden; position: relative; }
    .hi-bar > i { display: block; height: 100%; background: var(--text); border-radius: 2px; }
    .hi-bar--thin { height: 3px; }
    .hi-bar--thick { height: 6px; }
    .hi-bar--ok > i { background: var(--ok); }
    .hi-bar--warn > i { background: var(--warn); }
    .hi-bar--bad > i { background: var(--bad); }

    /* status bg helpers */
    .hi-tone-warn { background: var(--warn-bg); }
    .hi-tone-bad { background: var(--bad-bg); }
    .hi-tone-ok { background: var(--ok-bg); }

    /* tab */
    .hi-tab { font-family: inherit; font-size: 13px; font-weight: 500; padding: 10px 2px; border: none; background: transparent; color: var(--text-mute); cursor: pointer; position: relative; }
    .hi-tab--active { color: var(--text); }
    .hi-tab--active::after { content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: var(--text); border-radius: 2px; }

    /* kbd */
    .hi-kbd { font-family: 'Geist Mono', ui-monospace, monospace; font-size: 10.5px; padding: 1px 5px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface-2); color: var(--text-mid); }

    /* table */
    .hi-table { width: 100%; border-collapse: separate; border-spacing: 0; }
    .hi-table th { font-size: 11px; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-mute); text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--border); }
    .hi-table td { padding: 12px 14px; border-bottom: 1px solid var(--border-sub); font-size: 13px; color: var(--text); }
    .hi-table tr:last-child td { border-bottom: none; }
    .hi-table tr:hover td { background: var(--surface-2); }

    /* sidebar nav items */
    .hi-nav-item { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 7px; font-size: 13px; color: var(--text-mid); cursor: pointer; }
    .hi-nav-item:hover { background: var(--surface-2); color: var(--text); }
    .hi-nav-item--active { background: var(--surface-hi); color: var(--text); }

    /* icons (svg stroke) */
    .hi-i { width: 14px; height: 14px; stroke: currentColor; stroke-width: 1.75; fill: none; stroke-linecap: round; stroke-linejoin: round; flex: 0 0 auto; }
    .hi-i--sm { width: 12px; height: 12px; }
    .hi-i--lg { width: 16px; height: 16px; }

    /* spark */
    .hi-spark { display: flex; align-items: flex-end; gap: 2px; height: 28px; }
    .hi-spark > i { width: 3px; background: var(--text-mid); border-radius: 1px; opacity: 0.55; }
    .hi-spark > i.hi-spark--pos { background: var(--ok); opacity: 0.8; }
    .hi-spark > i.hi-spark--neg { background: var(--bad); opacity: 0.8; }

    /* hairline outer for board edges */
    .hi-board::after { content:''; position: absolute; inset: 0; border-radius: inherit; border: 1px solid var(--border-sub); pointer-events: none; }
  `;
  document.head.appendChild(s);
}

// ── Icon set (inline SVG, line-style) ────────────────────────────
const Icon = ({ name, size, style }) => {
  const paths = {
    plus: <><path d="M8 3v10"/><path d="M3 8h10"/></>,
    chevR: <path d="M6 4l4 4-4 4"/>,
    chevD: <path d="M4 6l4 4 4-4"/>,
    chevU: <path d="M4 10l4-4 4 4"/>,
    check: <path d="M3 8.5l3 3 7-7"/>,
    x: <><path d="M4 4l8 8"/><path d="M12 4l-8 8"/></>,
    search: <><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L13.5 13.5"/></>,
    settings: <><circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M3 13l1.5-1.5M11.5 4.5L13 3"/></>,
    refresh: <><path d="M3 8a5 5 0 019-3l1.5 1.5"/><path d="M13.5 3v3h-3"/><path d="M13 8a5 5 0 01-9 3l-1.5-1.5"/><path d="M2.5 13v-3h3"/></>,
    bell: <><path d="M4 11V7a4 4 0 018 0v4l1 1.5H3z"/><path d="M6.5 13.5a1.5 1.5 0 003 0"/></>,
    shield: <path d="M8 14s5-2 5-7V3l-5-1.5L3 3v4c0 5 5 7 5 7z"/>,
    clock: <><circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2 2"/></>,
    user: <><circle cx="8" cy="6" r="2.5"/><path d="M3 13c.5-2.5 2.5-4 5-4s4.5 1.5 5 4"/></>,
    chart: <><path d="M2 13h12"/><path d="M4 11V8M7 11V5M10 11V7M13 11V3"/></>,
    target: <><circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2.5"/></>,
    calendar: <><rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/></>,
    download: <><path d="M8 2v8"/><path d="M5 7l3 3 3-3"/><path d="M3 13h10"/></>,
    copy: <><rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M3 11V4a1 1 0 011-1h7"/></>,
    lock: <><rect x="3.5" y="7.5" width="9" height="6" rx="1"/><path d="M5.5 7.5V5a2.5 2.5 0 015 0v2.5"/></>,
    bolt: <path d="M9 1L3 9h4l-1 6 6-8H8z"/>,
    info: <><circle cx="8" cy="8" r="6"/><path d="M8 7.5v3.5M8 5.2v0.1"/></>,
    drag: <><circle cx="6" cy="4" r="0.6" fill="currentColor"/><circle cx="6" cy="8" r="0.6" fill="currentColor"/><circle cx="6" cy="12" r="0.6" fill="currentColor"/><circle cx="10" cy="4" r="0.6" fill="currentColor"/><circle cx="10" cy="8" r="0.6" fill="currentColor"/><circle cx="10" cy="12" r="0.6" fill="currentColor"/></>,
    edit: <><path d="M11.5 2.5l2 2L5 13H3v-2z"/></>,
    more: <><circle cx="3" cy="8" r="1" fill="currentColor"/><circle cx="8" cy="8" r="1" fill="currentColor"/><circle cx="13" cy="8" r="1" fill="currentColor"/></>,
    arrowR: <><path d="M3 8h10"/><path d="M9 4l4 4-4 4"/></>,
    arrowU: <><path d="M8 13V3"/><path d="M4 7l4-4 4 4"/></>,
    arrowD: <><path d="M8 3v10"/><path d="M4 9l4 4 4-4"/></>,
    filter: <path d="M2 3h12l-4.5 6v4l-3 1.5V9z"/>,
    grid: <><rect x="2.5" y="2.5" width="4" height="4"/><rect x="9.5" y="2.5" width="4" height="4"/><rect x="2.5" y="9.5" width="4" height="4"/><rect x="9.5" y="9.5" width="4" height="4"/></>,
    list: <><path d="M2 4h12M2 8h12M2 12h12"/></>,
    table: <><rect x="2" y="3" width="12" height="10" rx="1"/><path d="M2 7h12M6 3v10"/></>,
    home: <path d="M3 7l5-4 5 4v6.5a.5.5 0 01-.5.5H10v-4H6v4H3.5a.5.5 0 01-.5-.5z"/>,
  };
  const s = size === 'sm' ? 12 : size === 'lg' ? 16 : 14;
  return (
    <svg viewBox="0 0 16 16" width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ flex: '0 0 auto', ...style }}>
      {paths[name]}
    </svg>
  );
};

Object.assign(window, { TOKENS, ACCOUNTS, RULES, Icon });
