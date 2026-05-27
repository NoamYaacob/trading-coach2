// Warm hi-fi tokens — cream paper + terracotta + Instrument Serif display.

const WTOKENS = {
  // surfaces
  bg:        '#f4ede0',   // warm cream paper
  bgElev:    '#faf6ec',
  surface:   '#fffdf7',
  surface2:  '#ede4d2',
  surfaceHi: '#e3d8c2',
  surfaceWarm: '#f7eed8',
  border:    '#d9cdb1',
  borderHi:  '#b8a988',
  borderSub: '#e8dec7',

  // text
  ink:       '#1f1a12',
  text:      '#2a241a',
  textMid:   '#665b48',
  textMute:  '#8d8270',
  textFaint: '#b6ab95',

  // semantic
  primary:   '#9c3a14',   // deep terracotta
  primaryHi: '#b54719',
  primaryBg: 'rgba(156,58,20,0.10)',
  primaryBd: 'rgba(156,58,20,0.30)',

  ok:        '#3f7c2a',
  okBg:      'rgba(63,124,42,0.12)',
  okBd:      'rgba(63,124,42,0.32)',
  warn:      '#b8761a',
  warnBg:    'rgba(184,118,26,0.14)',
  warnBd:    'rgba(184,118,26,0.34)',
  bad:       '#a72d1f',
  badBg:     'rgba(167,45,31,0.10)',
  badBd:     'rgba(167,45,31,0.30)',
  info:      '#1c4e80',
  infoBg:    'rgba(28,78,128,0.10)',
};

// Inject global CSS once
if (typeof document !== 'undefined' && !document.getElementById('warm-styles')) {
  const s = document.createElement('style');
  s.id = 'warm-styles';
  s.textContent = `
    .w-board {
      --bg: ${WTOKENS.bg};
      --bg-elev: ${WTOKENS.bgElev};
      --surface: ${WTOKENS.surface};
      --surface-2: ${WTOKENS.surface2};
      --surface-hi: ${WTOKENS.surfaceHi};
      --surface-warm: ${WTOKENS.surfaceWarm};
      --border: ${WTOKENS.border};
      --border-hi: ${WTOKENS.borderHi};
      --border-sub: ${WTOKENS.borderSub};
      --ink: ${WTOKENS.ink};
      --text: ${WTOKENS.text};
      --text-mid: ${WTOKENS.textMid};
      --text-mute: ${WTOKENS.textMute};
      --text-faint: ${WTOKENS.textFaint};
      --primary: ${WTOKENS.primary};
      --primary-hi: ${WTOKENS.primaryHi};
      --primary-bg: ${WTOKENS.primaryBg};
      --primary-bd: ${WTOKENS.primaryBd};
      --ok: ${WTOKENS.ok}; --ok-bg: ${WTOKENS.okBg}; --ok-bd: ${WTOKENS.okBd};
      --warn: ${WTOKENS.warn}; --warn-bg: ${WTOKENS.warnBg}; --warn-bd: ${WTOKENS.warnBd};
      --bad: ${WTOKENS.bad}; --bad-bg: ${WTOKENS.badBg}; --bad-bd: ${WTOKENS.badBd};
      --info: ${WTOKENS.info}; --info-bg: ${WTOKENS.infoBg};

      font-family: 'Söhne', 'Geist', 'IBM Plex Sans', system-ui, sans-serif;
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
    .w-board *, .w-board *::before, .w-board *::after { box-sizing: border-box; }
    .w-mono { font-family: 'JetBrains Mono', 'Geist Mono', ui-monospace, monospace; font-feature-settings: 'tnum'; letter-spacing: -0.01em; }
    .w-serif { font-family: 'Instrument Serif', 'Tiempos', 'Iowan Old Style', Georgia, serif; font-feature-settings: 'liga', 'ss01'; }
    .w-num { font-variant-numeric: tabular-nums; }

    /* paper grain */
    .w-board::before {
      content: '';
      position: absolute; inset: 0;
      background-image:
        radial-gradient(ellipse 80% 50% at 20% 0%, rgba(184,169,136,0.10), transparent 60%),
        radial-gradient(ellipse 60% 40% at 80% 100%, rgba(184,169,136,0.08), transparent 60%);
      pointer-events: none;
      z-index: 0;
    }
    .w-board > * { position: relative; z-index: 1; }

    /* typography */
    .w-display { font-family: 'Instrument Serif', Georgia, serif; font-size: 38px; line-height: 1.05; font-weight: 400; letter-spacing: -0.02em; margin: 0; color: var(--ink); }
    .w-display-sm { font-family: 'Instrument Serif', Georgia, serif; font-size: 28px; line-height: 1.1; font-weight: 400; letter-spacing: -0.015em; margin: 0; color: var(--ink); }
    .w-h1 { font-size: 20px; line-height: 1.25; font-weight: 600; letter-spacing: -0.015em; margin: 0; color: var(--ink); }
    .w-h2 { font-size: 15px; line-height: 1.3; font-weight: 600; letter-spacing: -0.01em; margin: 0; color: var(--ink); }
    .w-label { font-size: 11px; line-height: 1.3; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-mute); margin: 0; }
    .w-body { font-size: 14px; line-height: 1.55; color: var(--text-mid); margin: 0; }
    .w-small { font-size: 13px; line-height: 1.45; color: var(--text-mid); }
    .w-tiny { font-size: 11.5px; line-height: 1.4; color: var(--text-mute); }
    .w-mute { color: var(--text-mute); }

    /* layout */
    .w-row { display: flex; align-items: center; }
    .w-col { display: flex; flex-direction: column; }
    .w-g-1 { gap: 4px; } .w-g-2 { gap: 8px; } .w-g-3 { gap: 12px; } .w-g-4 { gap: 16px; } .w-g-5 { gap: 20px; } .w-g-6 { gap: 24px; } .w-g-8 { gap: 32px; }
    .w-grow { flex: 1 1 auto; min-width: 0; }
    .w-between { justify-content: space-between; }

    /* card */
    .w-card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; }
    .w-card-soft { background: var(--surface-warm); border: 1px solid var(--border); border-radius: 14px; }
    .w-card-primary { background: var(--surface); border: 1px solid var(--primary-bd); border-radius: 14px; box-shadow: 0 0 0 4px var(--primary-bg); }
    .w-divider { height: 1px; background: var(--border); }
    .w-vdiv { width: 1px; background: var(--border); align-self: stretch; }

    /* button */
    .w-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 7px;
      font-family: inherit; font-size: 13.5px; font-weight: 500; letter-spacing: -0.005em;
      padding: 8px 14px; border-radius: 9px; cursor: pointer;
      background: var(--surface); color: var(--text);
      border: 1px solid var(--border);
      transition: background .12s, border-color .12s, transform .08s;
      line-height: 1; white-space: nowrap;
    }
    .w-btn:hover { background: var(--surface-warm); border-color: var(--border-hi); }
    .w-btn--primary { background: var(--primary); color: white; border-color: var(--primary); }
    .w-btn--primary:hover { background: var(--primary-hi); border-color: var(--primary-hi); }
    .w-btn--ink { background: var(--ink); color: var(--bg); border-color: var(--ink); }
    .w-btn--ghost { background: transparent; border-color: transparent; color: var(--text-mid); }
    .w-btn--ghost:hover { background: var(--surface-2); color: var(--ink); }
    .w-btn--sm { padding: 5px 10px; font-size: 12.5px; border-radius: 7px; gap: 5px; }
    .w-btn--icon { padding: 7px; }

    /* badge */
    .w-badge { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 500; letter-spacing: 0.005em; padding: 3px 9px; border-radius: 999px; line-height: 1.3; border: 1px solid transparent; white-space: nowrap; }
    .w-badge--ok   { color: var(--ok); background: var(--ok-bg); border-color: var(--ok-bd); }
    .w-badge--warn { color: var(--warn); background: var(--warn-bg); border-color: var(--warn-bd); }
    .w-badge--bad  { color: var(--bad); background: var(--bad-bg); border-color: var(--bad-bd); }
    .w-badge--info { color: var(--info); background: var(--info-bg); border-color: rgba(28,78,128,0.30); }
    .w-badge--primary { color: var(--primary); background: var(--primary-bg); border-color: var(--primary-bd); }
    .w-badge--neutral { color: var(--text-mid); background: var(--surface-2); border-color: var(--border); }
    .w-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: 0 0 auto; }
    .w-dot-lg { width: 8px; height: 8px; }
    .w-dot--pulse { box-shadow: 0 0 0 0 currentColor; animation: w-pulse 2s infinite; }
    @keyframes w-pulse { 0% { box-shadow: 0 0 0 0 currentColor; } 70% { box-shadow: 0 0 0 6px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }

    /* input */
    .w-input {
      font-family: inherit; font-size: 14px; color: var(--ink);
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 9px; padding: 9px 12px; outline: none; width: 100%;
      transition: border-color .12s, background .12s, box-shadow .12s;
    }
    .w-input:hover { border-color: var(--border-hi); }
    .w-input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-bg); }
    .w-input-affix { display: inline-flex; align-items: stretch; background: var(--surface); border: 1px solid var(--border); border-radius: 9px; overflow: hidden; transition: border-color .12s, box-shadow .12s; }
    .w-input-affix:focus-within { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-bg); }
    .w-input-affix > .w-input { border: none; background: transparent; box-shadow: none !important; }
    .w-input-affix > .w-input:focus { box-shadow: none; }
    .w-input-affix > .w-affix { display: inline-flex; align-items: center; padding: 0 12px; color: var(--text-mute); font-size: 13px; background: var(--surface-warm); border-right: 1px solid var(--border); font-weight: 500; }
    .w-input-affix > .w-affix--right { border-right: none; border-left: 1px solid var(--border); }

    /* switch */
    .w-switch { position: relative; width: 32px; height: 19px; background: var(--surface-2); border-radius: 999px; border: 1px solid var(--border); flex: 0 0 auto; cursor: pointer; transition: background .15s, border-color .15s; }
    .w-switch::after { content: ''; position: absolute; top: 1px; left: 1px; width: 15px; height: 15px; background: white; border-radius: 50%; transition: transform .18s; box-shadow: 0 1px 2px rgba(0,0,0,0.15); }
    .w-switch--on { background: var(--ok); border-color: var(--ok); }
    .w-switch--on::after { transform: translateX(13px); }
    .w-switch--primary.w-switch--on { background: var(--primary); border-color: var(--primary); }

    /* segmented */
    .w-seg { display: inline-flex; background: var(--surface-2); border: 1px solid var(--border); border-radius: 9px; padding: 2px; gap: 2px; }
    .w-seg button { font-family: inherit; font-size: 12.5px; font-weight: 500; padding: 6px 11px; border: none; background: transparent; color: var(--text-mid); border-radius: 7px; cursor: pointer; }
    .w-seg button.w-seg--active { background: var(--surface); color: var(--ink); box-shadow: 0 1px 0 rgba(0,0,0,0.04); }

    /* chip */
    .w-chip { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; font-size: 12.5px; font-weight: 500; background: var(--surface); color: var(--text-mid); border: 1px solid var(--border); border-radius: 999px; cursor: pointer; line-height: 1.2; }
    .w-chip--active { background: var(--ink); color: var(--bg); border-color: var(--ink); }
    .w-chip--primary { background: var(--primary); color: white; border-color: var(--primary); }
    .w-chip--ghost { border-style: dashed; }

    /* progress */
    .w-bar { height: 6px; background: var(--surface-2); border-radius: 3px; overflow: hidden; position: relative; }
    .w-bar > i { display: block; height: 100%; background: var(--ink); border-radius: 3px; transition: width .35s; }
    .w-bar--thin { height: 4px; }
    .w-bar--thick { height: 8px; }
    .w-bar--ok > i { background: var(--ok); }
    .w-bar--warn > i { background: var(--warn); }
    .w-bar--bad > i { background: var(--bad); }
    .w-bar--primary > i { background: var(--primary); }

    /* tab */
    .w-tab { font-family: inherit; font-size: 13.5px; font-weight: 500; padding: 12px 2px; border: none; background: transparent; color: var(--text-mute); cursor: pointer; position: relative; }
    .w-tab--active { color: var(--ink); }
    .w-tab--active::after { content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: var(--primary); border-radius: 2px; }

    /* kbd */
    .w-kbd { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; padding: 1.5px 5px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--text-mid); }

    /* nav */
    .w-nav-item { display: flex; align-items: center; gap: 10px; padding: 8px 11px; border-radius: 8px; font-size: 13.5px; color: var(--text-mid); cursor: pointer; }
    .w-nav-item:hover { background: var(--surface-2); color: var(--ink); }
    .w-nav-item--active { background: var(--ink); color: var(--bg); }
    .w-nav-item--active .w-nav-i { color: var(--bg); }

    /* sparkline */
    .w-spark { display: flex; align-items: flex-end; gap: 3px; height: 32px; }
    .w-spark > i { width: 4px; border-radius: 2px 2px 1px 1px; }
    .w-spark > i.w-spark--pos { background: var(--ok); }
    .w-spark > i.w-spark--neg { background: var(--bad); opacity: 0.85; }

    /* underline accent (Instrument-Serif friendly) */
    .w-underline-soft { position: relative; padding-bottom: 4px; display: inline-block; }
    .w-underline-soft::after {
      content: ''; position: absolute; left: 0; right: 0; bottom: -2px; height: 8px;
      background: var(--primary-bg);
      border-radius: 4px;
      z-index: -1;
    }

    /* table */
    .w-table { width: 100%; border-collapse: separate; border-spacing: 0; }
    .w-table th { font-size: 11px; font-weight: 500; letter-spacing: 0.07em; text-transform: uppercase; color: var(--text-mute); text-align: left; padding: 12px 16px; border-bottom: 1px solid var(--border); background: var(--bg-elev); }
    .w-table td { padding: 14px 16px; border-bottom: 1px solid var(--border-sub); font-size: 13.5px; color: var(--text); }
    .w-table tr:last-child td { border-bottom: none; }
    .w-table tr:hover td { background: var(--surface-warm); }

    /* sticky save bar */
    .w-savebar {
      position: sticky; bottom: 0;
      padding: 14px 32px;
      background: ${WTOKENS.bg}ee;
      backdrop-filter: blur(8px);
      border-top: 1px solid var(--border);
      display: flex; align-items: center; justify-content: space-between;
    }

    /* checkbox */
    .w-check { width: 16px; height: 16px; border-radius: 5px; border: 1.5px solid var(--border-hi); background: var(--surface); flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; }
    .w-check--on { background: var(--primary); border-color: var(--primary); color: white; }
  `;
  document.head.appendChild(s);
}

const WIcon = ({ name, size, style }) => {
  const paths = {
    plus: <><path d="M8 3v10"/><path d="M3 8h10"/></>,
    chevR: <path d="M6 4l4 4-4 4"/>,
    chevD: <path d="M4 6l4 4 4-4"/>,
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
    edit: <><path d="M11.5 2.5l2 2L5 13H3v-2z"/></>,
    more: <><circle cx="3" cy="8" r="1" fill="currentColor"/><circle cx="8" cy="8" r="1" fill="currentColor"/><circle cx="13" cy="8" r="1" fill="currentColor"/></>,
    home: <path d="M3 7l5-4 5 4v6.5a.5.5 0 01-.5.5H10v-4H6v4H3.5a.5.5 0 01-.5-.5z"/>,
    arrowR: <><path d="M3 8h10"/><path d="M9 4l4 4-4 4"/></>,
    arrowUR: <><path d="M5 11l6-6"/><path d="M6 5h5v5"/></>,
    sparkle: <><path d="M8 2v3M8 11v3M2 8h3M11 8h3M3.5 3.5l2 2M10.5 10.5l2 2M12.5 3.5l-2 2M5.5 10.5l-2 2"/></>,
    coin: <><circle cx="8" cy="8" r="6"/><path d="M6.5 9.5c.4.8 1 1 1.5 1 .8 0 1.5-.4 1.5-1.2 0-1.6-3-.8-3-2.4 0-.8.7-1.2 1.5-1.2.5 0 1.1.2 1.5 1M8 4.5v7"/></>,
    list: <><path d="M2 4h12M2 8h12M2 12h12"/></>,
  };
  const s = size === 'sm' ? 12 : size === 'lg' ? 16 : 14;
  return (
    <svg viewBox="0 0 16 16" width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flex: '0 0 auto', ...style }}>
      {paths[name]}
    </svg>
  );
};

Object.assign(window, { WTOKENS, WIcon });
