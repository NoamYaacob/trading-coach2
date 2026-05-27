// Guardrail · refined design tokens.
// Primary UI font is a clean modern sans. Serif is reserved for ONE
// editorial moment per page (the Overview hero). Numbers always mono.

const GR = {
  // Surfaces
  bg:        '#f3ece0',   // warm cream paper (slightly less saturated)
  bgElev:    '#f9f4ea',
  surface:   '#ffffff',   // pure white cards on warm bg = premium feel
  surface2:  '#ede5d4',
  surfaceHi: '#dfd4bd',
  surfaceWarm: '#f8f0dc',
  border:    '#dcd0b7',
  borderHi:  '#b6a585',
  borderSub: '#ebe1cb',

  // Ink (charcoal, not pure black)
  ink:       '#1b1812',
  text:      '#26211a',
  textMid:   '#615847',
  textMute:  '#8b8270',
  textFaint: '#b6ab94',

  // Primary — copper
  copper:    '#a23d10',
  copperHi:  '#b9481a',
  copperBg:  'rgba(162,61,16,0.10)',
  copperBd:  'rgba(162,61,16,0.30)',

  // Enforcement palette
  // broker-backed = strongest (green)
  brokerC:   '#2f7a2a',
  brokerBg:  'rgba(47,122,42,0.12)',
  brokerBd:  'rgba(47,122,42,0.30)',

  // app-lock = strong (indigo)
  lockC:     '#3949ab',
  lockBg:    'rgba(57,73,171,0.10)',
  lockBd:    'rgba(57,73,171,0.28)',

  // monitor = informational (amber)
  monC:      '#b1771a',
  monBg:     'rgba(177,119,26,0.12)',
  monBd:     'rgba(177,119,26,0.32)',

  // saved = neutral
  savedC:    '#615847',
  savedBg:   'rgba(97,88,71,0.08)',
  savedBd:   'rgba(97,88,71,0.20)',

  // planned = ghosted
  planC:     '#8b8270',
  planBg:    'rgba(139,130,112,0.06)',
  planBd:    'rgba(139,130,112,0.30)',

  // Status (state, not enforcement)
  ok:        '#3f7c2a',
  okBg:      'rgba(63,124,42,0.12)',
  okBd:      'rgba(63,124,42,0.30)',
  warn:      '#b87618',
  warnBg:    'rgba(184,118,24,0.14)',
  warnBd:    'rgba(184,118,24,0.34)',
  bad:       '#a72d1f',
  badBg:     'rgba(167,45,31,0.10)',
  badBd:     'rgba(167,45,31,0.30)',
};

if (typeof document !== 'undefined' && !document.getElementById('gr-styles')) {
  const s = document.createElement('style');
  s.id = 'gr-styles';
  s.textContent = `
    .gr {
      --bg: ${GR.bg}; --bg-elev: ${GR.bgElev};
      --surface: ${GR.surface}; --surface-2: ${GR.surface2}; --surface-hi: ${GR.surfaceHi}; --surface-warm: ${GR.surfaceWarm};
      --border: ${GR.border}; --border-hi: ${GR.borderHi}; --border-sub: ${GR.borderSub};
      --ink: ${GR.ink}; --text: ${GR.text}; --text-mid: ${GR.textMid}; --text-mute: ${GR.textMute}; --text-faint: ${GR.textFaint};
      --copper: ${GR.copper}; --copper-hi: ${GR.copperHi}; --copper-bg: ${GR.copperBg}; --copper-bd: ${GR.copperBd};
      --broker: ${GR.brokerC}; --broker-bg: ${GR.brokerBg}; --broker-bd: ${GR.brokerBd};
      --lock: ${GR.lockC}; --lock-bg: ${GR.lockBg}; --lock-bd: ${GR.lockBd};
      --mon: ${GR.monC}; --mon-bg: ${GR.monBg}; --mon-bd: ${GR.monBd};
      --saved: ${GR.savedC}; --saved-bg: ${GR.savedBg}; --saved-bd: ${GR.savedBd};
      --plan: ${GR.planC}; --plan-bg: ${GR.planBg}; --plan-bd: ${GR.planBd};
      --ok: ${GR.ok}; --ok-bg: ${GR.okBg}; --ok-bd: ${GR.okBd};
      --warn: ${GR.warn}; --warn-bg: ${GR.warnBg}; --warn-bd: ${GR.warnBd};
      --bad: ${GR.bad}; --bad-bg: ${GR.badBg}; --bad-bd: ${GR.badBd};

      font-family: 'Geist', 'Söhne', 'Inter', -apple-system, system-ui, sans-serif;
      font-feature-settings: 'cv11','ss03';
      background: var(--bg);
      color: var(--text);
      height: 100%;
      box-sizing: border-box;
      letter-spacing: -0.005em;
      -webkit-font-smoothing: antialiased;
      position: relative;
      overflow: hidden;
    }
    .gr *, .gr *::before, .gr *::after { box-sizing: border-box; }
    .gr-mono { font-family: 'Geist Mono', 'JetBrains Mono', ui-monospace, monospace; font-feature-settings: 'tnum','zero','ss01'; letter-spacing: -0.005em; }
    .gr-serif { font-family: 'Instrument Serif', 'Tiempos', Georgia, serif; }
    .gr-num { font-variant-numeric: tabular-nums; }

    /* paper grain */
    .gr::before {
      content: '';
      position: absolute; inset: 0;
      background-image:
        radial-gradient(ellipse 70% 50% at 15% 0%, rgba(180,160,120,0.08), transparent 60%),
        radial-gradient(ellipse 50% 40% at 85% 100%, rgba(180,160,120,0.07), transparent 60%);
      pointer-events: none; z-index: 0;
    }
    .gr > * { position: relative; z-index: 1; }

    /* typography */
    .gr-display    { font-family: 'Instrument Serif', Georgia, serif; font-size: 40px; line-height: 1.05; font-weight: 400; letter-spacing: -0.02em; margin: 0; color: var(--ink); }
    .gr-h1         { font-size: 22px; line-height: 1.25; font-weight: 600; letter-spacing: -0.015em; margin: 0; color: var(--ink); }
    .gr-h2         { font-size: 16px; line-height: 1.3; font-weight: 600; letter-spacing: -0.01em; margin: 0; color: var(--ink); }
    .gr-h3         { font-size: 14px; line-height: 1.35; font-weight: 600; letter-spacing: -0.005em; margin: 0; color: var(--ink); }
    .gr-label      { font-size: 11px; line-height: 1.3; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-mute); margin: 0; }
    .gr-body       { font-size: 14px; line-height: 1.55; color: var(--text-mid); margin: 0; }
    .gr-small      { font-size: 13px; line-height: 1.45; color: var(--text-mid); }
    .gr-tiny       { font-size: 11.5px; line-height: 1.4; color: var(--text-mute); }
    .gr-mute       { color: var(--text-mute); }

    /* layout */
    .gr-row { display: flex; align-items: center; }
    .gr-col { display: flex; flex-direction: column; }
    .gr-g-1 { gap: 4px; } .gr-g-2 { gap: 8px; } .gr-g-3 { gap: 12px; } .gr-g-4 { gap: 16px; } .gr-g-5 { gap: 20px; } .gr-g-6 { gap: 24px; } .gr-g-8 { gap: 32px; }
    .gr-grow { flex: 1 1 auto; min-width: 0; }
    .gr-between { justify-content: space-between; }

    /* cards */
    .gr-card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; transition: border-color .12s, box-shadow .12s, transform .08s; }
    .gr-card-soft { background: var(--surface-warm); border: 1px solid var(--border); border-radius: 14px; }
    .gr-card-flat { background: var(--bg-elev); border: 1px solid var(--border); border-radius: 14px; }

    /* button */
    .gr-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 7px;
      font-family: inherit; font-size: 13.5px; font-weight: 500; letter-spacing: -0.005em;
      padding: 8px 14px; border-radius: 9px; cursor: pointer;
      background: var(--surface); color: var(--text);
      border: 1px solid var(--border);
      transition: background .12s, border-color .12s, color .12s;
      line-height: 1; white-space: nowrap;
    }
    .gr-btn:hover { background: var(--surface-warm); border-color: var(--border-hi); }
    .gr-btn--primary { background: var(--copper); color: white; border-color: var(--copper); }
    .gr-btn--primary:hover { background: var(--copper-hi); border-color: var(--copper-hi); }
    .gr-btn--ink { background: var(--ink); color: var(--bg); border-color: var(--ink); }
    .gr-btn--ghost { background: transparent; border-color: transparent; color: var(--text-mid); }
    .gr-btn--ghost:hover { background: var(--surface-2); color: var(--ink); }
    .gr-btn--disabled { opacity: 0.5; cursor: not-allowed; }
    .gr-btn--disabled:hover { background: var(--surface); border-color: var(--border); }
    .gr-btn--sm { padding: 5px 10px; font-size: 12.5px; border-radius: 7px; gap: 5px; }
    .gr-btn--icon { padding: 7px; }

    /* badge / chip */
    .gr-badge { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 500; padding: 3px 9px; border-radius: 999px; line-height: 1.3; border: 1px solid transparent; white-space: nowrap; }
    .gr-badge--ok      { color: var(--ok);     background: var(--ok-bg);     border-color: var(--ok-bd); }
    .gr-badge--warn    { color: var(--warn);   background: var(--warn-bg);   border-color: var(--warn-bd); }
    .gr-badge--bad     { color: var(--bad);    background: var(--bad-bg);    border-color: var(--bad-bd); }
    .gr-badge--neutral { color: var(--text-mid); background: var(--surface-2); border-color: var(--border); }
    .gr-badge--broker  { color: var(--broker); background: var(--broker-bg); border-color: var(--broker-bd); }
    .gr-badge--lock    { color: var(--lock);   background: var(--lock-bg);   border-color: var(--lock-bd); }
    .gr-badge--mon     { color: var(--mon);    background: var(--mon-bg);    border-color: var(--mon-bd); }
    .gr-badge--saved   { color: var(--saved);  background: var(--saved-bg);  border-color: var(--saved-bd); }
    .gr-badge--plan    { color: var(--plan);   background: var(--plan-bg);   border-color: var(--plan-bd); border-style: dashed; }
    .gr-badge--copper  { color: var(--copper); background: var(--copper-bg); border-color: var(--copper-bd); }

    .gr-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: 0 0 auto; }
    .gr-dot-lg { width: 8px; height: 8px; }
    .gr-dot--pulse { box-shadow: 0 0 0 0 currentColor; animation: gr-pulse 2s infinite; }
    @keyframes gr-pulse { 0% { box-shadow: 0 0 0 0 currentColor; } 70% { box-shadow: 0 0 0 6px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }

    /* input */
    .gr-input {
      font-family: inherit; font-size: 14px; color: var(--ink);
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 9px; padding: 9px 12px; outline: none; width: 100%;
      transition: border-color .12s, box-shadow .12s;
    }
    .gr-input:hover { border-color: var(--border-hi); }
    .gr-input:focus { border-color: var(--copper); box-shadow: 0 0 0 3px var(--copper-bg); }
    .gr-input-affix { display: inline-flex; align-items: stretch; background: var(--surface); border: 1px solid var(--border); border-radius: 9px; overflow: hidden; transition: border-color .12s, box-shadow .12s; }
    .gr-input-affix:focus-within { border-color: var(--copper); box-shadow: 0 0 0 3px var(--copper-bg); }
    .gr-input-affix > .gr-input { border: none; background: transparent; box-shadow: none !important; }
    .gr-input-affix > .gr-affix { display: inline-flex; align-items: center; padding: 0 12px; color: var(--text-mute); font-size: 13px; background: var(--surface-warm); border-right: 1px solid var(--border); font-weight: 500; }
    .gr-input-affix > .gr-affix--right { border-right: none; border-left: 1px solid var(--border); }

    /* switch */
    .gr-switch { position: relative; width: 32px; height: 19px; background: var(--surface-2); border-radius: 999px; border: 1px solid var(--border); flex: 0 0 auto; cursor: pointer; transition: background .15s, border-color .15s; }
    .gr-switch::after { content: ''; position: absolute; top: 1px; left: 1px; width: 15px; height: 15px; background: white; border-radius: 50%; transition: transform .18s; box-shadow: 0 1px 2px rgba(0,0,0,0.15); }
    .gr-switch--on { background: var(--copper); border-color: var(--copper); }
    .gr-switch--on::after { transform: translateX(13px); }
    .gr-switch--disabled { opacity: 0.45; cursor: not-allowed; }

    /* segmented */
    .gr-seg { display: inline-flex; background: var(--surface-2); border: 1px solid var(--border); border-radius: 9px; padding: 2px; gap: 2px; }
    .gr-seg button { font-family: inherit; font-size: 12.5px; font-weight: 500; padding: 6px 11px; border: none; background: transparent; color: var(--text-mid); border-radius: 7px; cursor: pointer; }
    .gr-seg button.gr-seg--active { background: var(--surface); color: var(--ink); box-shadow: 0 1px 0 rgba(0,0,0,0.04); }

    /* chip (filter) */
    .gr-chip { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; font-size: 12.5px; font-weight: 500; background: var(--surface); color: var(--text-mid); border: 1px solid var(--border); border-radius: 999px; cursor: pointer; line-height: 1.2; }
    .gr-chip--active { background: var(--ink); color: var(--bg); border-color: var(--ink); }

    /* progress */
    .gr-bar { height: 6px; background: var(--surface-2); border-radius: 3px; overflow: hidden; }
    .gr-bar > i { display: block; height: 100%; background: var(--ink); border-radius: 3px; }
    .gr-bar--thin { height: 4px; }
    .gr-bar--thick { height: 8px; }
    .gr-bar--ok > i { background: var(--ok); }
    .gr-bar--warn > i { background: var(--warn); }
    .gr-bar--bad > i { background: var(--bad); }
    .gr-bar--copper > i { background: var(--copper); }

    /* tabs */
    .gr-tab { font-family: inherit; font-size: 13.5px; font-weight: 500; padding: 12px 2px; border: none; background: transparent; color: var(--text-mute); cursor: pointer; position: relative; }
    .gr-tab--active { color: var(--ink); }
    .gr-tab--active::after { content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: var(--copper); border-radius: 2px; }

    /* kbd */
    .gr-kbd { font-family: 'Geist Mono', monospace; font-size: 10.5px; padding: 1.5px 5px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--text-mid); }

    /* nav */
    .gr-nav-item { display: flex; align-items: center; gap: 10px; padding: 8px 11px; border-radius: 8px; font-size: 13.5px; color: var(--text-mid); cursor: pointer; transition: background .1s, color .1s; }
    .gr-nav-item:hover { background: var(--surface-2); color: var(--ink); }
    .gr-nav-item--active { background: var(--ink); color: var(--bg); }
    .gr-nav-item--active:hover { background: var(--ink); color: var(--bg); }

    /* spark */
    .gr-spark { display: flex; align-items: flex-end; gap: 3px; height: 32px; }
    .gr-spark > i { width: 4px; border-radius: 2px 2px 1px 1px; }
    .gr-spark > i.gr-spark--pos { background: var(--ok); }
    .gr-spark > i.gr-spark--neg { background: var(--bad); opacity: 0.85; }

    /* rule card states */
    .gr-rule {
      position: relative; background: var(--surface); border: 1px solid var(--border);
      border-radius: 14px; padding: 18px; cursor: pointer;
      transition: border-color .12s, background .12s, transform .08s, box-shadow .12s;
    }
    .gr-rule:hover { border-color: var(--border-hi); background: var(--bg-elev); }
    .gr-rule--selected { border-color: var(--copper); box-shadow: 0 0 0 4px var(--copper-bg); }
    .gr-rule--disabled { opacity: 0.55; }
    .gr-rule--disabled:hover { background: var(--surface); }
    .gr-rule--changed::before { content: ''; position: absolute; top: 10px; right: 10px; width: 8px; height: 8px; border-radius: 50%; background: var(--copper); border: 2px solid var(--surface); }
    .gr-rule--unsaved::before { content: ''; position: absolute; top: 10px; right: 10px; width: 8px; height: 8px; border-radius: 50%; background: var(--warn); border: 2px solid var(--surface); }

    /* checkbox */
    .gr-check { width: 16px; height: 16px; border-radius: 5px; border: 1.5px solid var(--border-hi); background: var(--surface); flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; }
    .gr-check--on { background: var(--copper); border-color: var(--copper); color: white; }

    /* underline soft (used sparingly on hero) */
    .gr-uline { position: relative; padding-bottom: 4px; display: inline-block; }
    .gr-uline::after {
      content: ''; position: absolute; left: 0; right: 0; bottom: -2px; height: 10px;
      background: var(--copper-bg); border-radius: 5px; z-index: -1;
    }

    /* avatar */
    .gr-avatar { width: 30px; height: 30px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; font-size: 11.5px; font-weight: 600; flex: 0 0 auto; }
  `;
  document.head.appendChild(s);
}

// Compact line-icon set
const GIcon = ({ name, size, style }) => {
  const paths = {
    plus: <><path d="M8 3v10"/><path d="M3 8h10"/></>,
    chevR: <path d="M6 4l4 4-4 4"/>,
    chevD: <path d="M4 6l4 4 4-4"/>,
    chevL: <path d="M10 4l-4 4 4 4"/>,
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
    cal: <><rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/></>,
    download: <><path d="M8 2v8"/><path d="M5 7l3 3 3-3"/><path d="M3 13h10"/></>,
    copy: <><rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M3 11V4a1 1 0 011-1h7"/></>,
    lock: <><rect x="3.5" y="7.5" width="9" height="6" rx="1"/><path d="M5.5 7.5V5a2.5 2.5 0 015 0v2.5"/></>,
    bolt: <path d="M9 1L3 9h4l-1 6 6-8H8z"/>,
    info: <><circle cx="8" cy="8" r="6"/><path d="M8 7.5v3.5M8 5.2v0.1"/></>,
    edit: <><path d="M11.5 2.5l2 2L5 13H3v-2z"/></>,
    more: <><circle cx="3" cy="8" r="1" fill="currentColor"/><circle cx="8" cy="8" r="1" fill="currentColor"/><circle cx="13" cy="8" r="1" fill="currentColor"/></>,
    home: <path d="M3 7l5-4 5 4v6.5a.5.5 0 01-.5.5H10v-4H6v4H3.5a.5.5 0 01-.5-.5z"/>,
    arrowR: <><path d="M3 8h10"/><path d="M9 4l4 4-4 4"/></>,
    sparkle: <><path d="M8 2v3M8 11v3M2 8h3M11 8h3M3.5 3.5l2 2M10.5 10.5l2 2M12.5 3.5l-2 2M5.5 10.5l-2 2"/></>,
    list: <><path d="M2 4h12M2 8h12M2 12h12"/></>,
    grid: <><rect x="2.5" y="2.5" width="4" height="4"/><rect x="9.5" y="2.5" width="4" height="4"/><rect x="2.5" y="9.5" width="4" height="4"/><rect x="9.5" y="9.5" width="4" height="4"/></>,
    pause: <><rect x="4" y="3" width="2.5" height="10" rx="0.5"/><rect x="9.5" y="3" width="2.5" height="10" rx="0.5"/></>,
    bookmark: <path d="M4 2.5h8v11l-4-2.5-4 2.5z"/>,
    menu: <><path d="M2 4h12M2 8h12M2 12h12"/></>,
    plug: <><path d="M5 3v3M11 3v3"/><rect x="3.5" y="6" width="9" height="3" rx="0.5"/><path d="M8 9v3M6 12h4"/></>,
    warn: <><path d="M8 2L1.5 13h13z"/><path d="M8 6v3.5M8 11v0.1"/></>,
  };
  const s = size === 'sm' ? 12 : size === 'lg' ? 16 : size === 'xl' ? 20 : 14;
  return (
    <svg viewBox="0 0 16 16" width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flex: '0 0 auto', ...style }}>
      {paths[name]}
    </svg>
  );
};

Object.assign(window, { GR, GIcon });
