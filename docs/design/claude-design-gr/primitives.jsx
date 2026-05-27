// Sketchy wireframe primitives — hand-drawn aesthetic for Trading Rules wireframes.

const WFCOLORS = {
  ink: '#2a2620',
  paper: '#fdfbf4',
  paper2: '#f5efe0',
  paper3: '#efe7d2',
  muted: '#7a6e5e',
  faint: '#bfb39b',
  ok: '#3f7a36',
  warn: '#b87a1a',
  bad: '#b53a30',
  accent: '#2f5c8a',
  highlight: '#fff3b0',
};

const FONT_HAND = "'Patrick Hand', 'Bradley Hand', cursive";
const FONT_TITLE = "'Architects Daughter', 'Patrick Hand', cursive";
const FONT_MONO = "'JetBrains Mono', 'Courier New', monospace";

if (typeof document !== 'undefined' && !document.getElementById('wf-styles')) {
  const s = document.createElement('style');
  s.id = 'wf-styles';
  s.textContent = `
    .wf-board { font-family: ${FONT_HAND}; color: ${WFCOLORS.ink}; background: ${WFCOLORS.paper}; height: 100%; box-sizing: border-box; position: relative; overflow: hidden; }
    .wf-board::before { content:''; position:absolute; inset:0; background-image: radial-gradient(circle, ${WFCOLORS.faint}55 0.8px, transparent 0.8px); background-size: 22px 22px; opacity: .35; pointer-events: none; }
    .wf-board > * { position: relative; }

    .wf-sb { border: 1.5px solid ${WFCOLORS.ink}; border-radius: 9px 12px 7px 14px; background: ${WFCOLORS.paper}; position: relative; }
    .wf-sb-2 { border-radius: 12px 8px 13px 10px; }
    .wf-sb-3 { border-radius: 7px 14px 9px 12px; }
    .wf-sb-pill { border-radius: 999px; }
    .wf-shadow { box-shadow: 2px 3px 0 -1px ${WFCOLORS.ink}; }
    .wf-shadow-sm { box-shadow: 1.5px 2px 0 -1px ${WFCOLORS.ink}; }
    .wf-rot-l { transform: rotate(-0.4deg); }
    .wf-rot-r { transform: rotate(0.3deg); }

    .wf-h1 { font-family: ${FONT_TITLE}; font-size: 30px; margin: 0; letter-spacing: 0.3px; line-height: 1.05; }
    .wf-h2 { font-family: ${FONT_TITLE}; font-size: 20px; margin: 0; letter-spacing: 0.2px; }
    .wf-h3 { font-family: ${FONT_HAND}; font-size: 16px; margin: 0; font-weight: 700; }
    .wf-mono { font-family: ${FONT_MONO}; font-weight: 600; letter-spacing: -0.3px; }
    .wf-mute { color: ${WFCOLORS.muted}; }
    .wf-tiny { font-size: 11px; }
    .wf-small { font-size: 13px; }

    .wf-row { display: flex; align-items: center; }
    .wf-col { display: flex; flex-direction: column; }
    .wf-gap-1 { gap: 4px; } .wf-gap-2 { gap: 8px; } .wf-gap-3 { gap: 12px; } .wf-gap-4 { gap: 16px; } .wf-gap-5 { gap: 20px; } .wf-gap-6 { gap: 24px; } .wf-gap-8 { gap: 32px; }
    .wf-grow { flex: 1 1 auto; min-width: 0; }
    .wf-between { justify-content: space-between; }
    .wf-center { justify-content: center; }
    .wf-end { justify-content: flex-end; }

    .wf-input { font-family: ${FONT_MONO}; font-size: 14px; background: transparent; border: none; border-bottom: 1.5px dashed ${WFCOLORS.ink}; padding: 2px 6px; color: ${WFCOLORS.ink}; outline: none; min-width: 0; }
    .wf-input:focus { border-bottom-style: solid; background: ${WFCOLORS.highlight}66; }
    .wf-input--solid { border: 1.5px solid ${WFCOLORS.ink}; border-radius: 6px 9px 7px 11px; padding: 4px 8px; }

    .wf-badge { display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px 3px; font-size: 12px; font-family: ${FONT_HAND}; border: 1.5px solid currentColor; border-radius: 999px; background: ${WFCOLORS.paper}; line-height: 1.2; }
    .wf-badge--ok { color: ${WFCOLORS.ok}; }
    .wf-badge--warn { color: ${WFCOLORS.warn}; }
    .wf-badge--bad { color: ${WFCOLORS.bad}; }
    .wf-badge--neutral { color: ${WFCOLORS.muted}; }
    .wf-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }

    .wf-toggle { width: 34px; height: 19px; border: 1.5px solid ${WFCOLORS.ink}; border-radius: 999px; position: relative; background: ${WFCOLORS.paper}; flex: 0 0 auto; }
    .wf-toggle--on { background: ${WFCOLORS.ok}; }
    .wf-toggle--bad { background: ${WFCOLORS.bad}33; }
    .wf-toggle::after { content: ''; position: absolute; top: 1px; left: 1px; width: 13px; height: 13px; border-radius: 50%; background: ${WFCOLORS.paper}; border: 1.5px solid ${WFCOLORS.ink}; }
    .wf-toggle--on::after { left: auto; right: 1px; }

    .wf-btn { font-family: ${FONT_HAND}; font-size: 14px; padding: 5px 13px; border: 1.5px solid ${WFCOLORS.ink}; background: ${WFCOLORS.paper}; border-radius: 8px 11px 7px 13px; cursor: pointer; color: ${WFCOLORS.ink}; box-shadow: 1.5px 2px 0 -1px ${WFCOLORS.ink}; }
    .wf-btn--primary { background: ${WFCOLORS.ink}; color: ${WFCOLORS.paper}; }
    .wf-btn--ghost { box-shadow: none; background: transparent; }
    .wf-btn--sm { font-size: 12px; padding: 3px 9px; }

    .wf-chip { padding: 3px 10px 4px; font-size: 13px; border: 1.5px solid ${WFCOLORS.ink}; border-radius: 999px; background: ${WFCOLORS.paper}; font-family: ${FONT_HAND}; display: inline-flex; align-items: center; gap: 6px; line-height: 1.2; cursor: pointer; }
    .wf-chip--active { background: ${WFCOLORS.ink}; color: ${WFCOLORS.paper}; }
    .wf-chip--ghost { border-style: dashed; color: ${WFCOLORS.muted}; }

    .wf-divider { height: 4px; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 4'><path d='M0 2 Q 5 0 10 2 T 20 2 T 30 2 T 40 2 T 50 2 T 60 2 T 70 2 T 80 2 T 90 2 T 100 2' stroke='%232a2620' stroke-width='1.2' fill='none' opacity='0.55'/></svg>"); background-size: 100px 4px; background-repeat: repeat-x; background-position: 0 50%; }
    .wf-vdiv { width: 1.5px; background: ${WFCOLORS.ink}; opacity: 0.18; }
    .wf-hdiv { height: 1.5px; background: ${WFCOLORS.ink}; opacity: 0.18; }

    .wf-slot { background: repeating-linear-gradient(135deg, ${WFCOLORS.paper2}, ${WFCOLORS.paper2} 7px, transparent 7px, transparent 14px); border: 1.5px dashed ${WFCOLORS.ink}; border-radius: 8px 11px 7px 12px; display: flex; align-items: center; justify-content: center; font-family: ${FONT_MONO}; font-size: 11px; color: ${WFCOLORS.muted}; text-transform: uppercase; letter-spacing: 0.5px; }

    .wf-progress { height: 8px; border: 1.5px solid ${WFCOLORS.ink}; border-radius: 999px; background: ${WFCOLORS.paper}; overflow: hidden; position: relative; }
    .wf-progress > i { display:block; height: 100%; background: ${WFCOLORS.ink}; }
    .wf-progress--ok > i { background: ${WFCOLORS.ok}; }
    .wf-progress--warn > i { background: ${WFCOLORS.warn}; }
    .wf-progress--bad > i { background: ${WFCOLORS.bad}; }

    .wf-tab { font-family: ${FONT_HAND}; font-size: 14px; padding: 6px 14px; border: none; background: transparent; cursor: pointer; color: ${WFCOLORS.muted}; border-bottom: 2px dashed transparent; }
    .wf-tab--active { color: ${WFCOLORS.ink}; border-bottom-color: ${WFCOLORS.ink}; border-bottom-style: solid; }

    .wf-kbd { font-family: ${FONT_MONO}; font-size: 11px; padding: 1px 5px; border: 1.5px solid ${WFCOLORS.ink}; border-radius: 4px; background: ${WFCOLORS.paper2}; }

    .wf-stamp { display: inline-block; padding: 2px 8px; border: 2px solid currentColor; border-radius: 4px; font-family: ${FONT_TITLE}; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; transform: rotate(-4deg); }

    /* Squiggly underline for headings */
    .wf-squig { background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 6'><path d='M0 4 Q 4 1 8 4 T 16 4 T 24 4 T 32 4 T 40 4 T 48 4 T 56 4 T 64 4 T 72 4 T 80 4' stroke='%23b87a1a' stroke-width='1.6' fill='none'/></svg>"); background-size: 80px 6px; background-repeat: repeat-x; background-position: 0 100%; padding-bottom: 5px; }

    /* arrow */
    .wf-arrow::after { content: '→'; font-family: ${FONT_TITLE}; opacity: 0.7; }

    /* tally for sparkline-ish */
    .wf-spark { display: flex; align-items: flex-end; gap: 2px; height: 24px; }
    .wf-spark > span { width: 4px; background: ${WFCOLORS.ink}; border-radius: 1px; opacity: 0.65; }
  `;
  document.head.appendChild(s);
}

const SB = ({ children, style, className = '', shadow = true, ...rest }) => (
  <div className={`wf-sb ${shadow ? 'wf-shadow' : ''} ${className}`} style={style} {...rest}>{children}</div>
);

const Badge = ({ type = 'ok', children }) => (
  <span className={`wf-badge wf-badge--${type}`}>
    <span className="wf-dot" />
    {children}
  </span>
);

const Toggle = ({ on = false, bad = false }) => (
  <div className={`wf-toggle ${on ? 'wf-toggle--on' : ''} ${bad ? 'wf-toggle--bad' : ''}`} />
);

const Btn = ({ primary, ghost, sm, children, style }) => (
  <button className={`wf-btn ${primary ? 'wf-btn--primary' : ''} ${ghost ? 'wf-btn--ghost' : ''} ${sm ? 'wf-btn--sm' : ''}`} style={style}>{children}</button>
);

const Chip = ({ active, ghost, children, style }) => (
  <span className={`wf-chip ${active ? 'wf-chip--active' : ''} ${ghost ? 'wf-chip--ghost' : ''}`} style={style}>{children}</span>
);

const Slot = ({ label, h = 80, style }) => (
  <div className="wf-slot" style={{ height: h, ...style }}>{label}</div>
);

const Progress = ({ pct = 50, type = '' }) => (
  <div className={`wf-progress ${type ? 'wf-progress--' + type : ''}`}>
    <i style={{ width: pct + '%' }} />
  </div>
);

const Spark = ({ vals = [4, 7, 5, 9, 6, 11, 8, 14, 10, 13, 16, 12] }) => (
  <div className="wf-spark">
    {vals.map((v, i) => <span key={i} style={{ height: v * 1.5 + 'px' }} />)}
  </div>
);

const Divider = ({ style }) => <div className="wf-divider" style={style} />;

const ScribbleTitle = ({ children, color = WFCOLORS.ink }) => (
  <h2 className="wf-h2 wf-squig" style={{ color, display: 'inline-block' }}>{children}</h2>
);

Object.assign(window, {
  WFCOLORS, FONT_HAND, FONT_TITLE, FONT_MONO,
  SB, Badge, Toggle, Btn, Chip, Slot, Progress, Spark, Divider, ScribbleTitle,
});
