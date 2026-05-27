// Trading Rules — 5 desktop wireframe variations + 2 mobile.
// All variations share the same data so comparison stays honest.

const ACCOUNTS = [
  { id: 'eval50', label: 'Eval $50K', tv: 'TV4128', status: 'warn' },
  { id: 'fund100', label: 'Funded $100K', tv: 'TV9102', status: 'ok' },
  { id: 'fund50', label: 'Funded $50K', tv: 'TV7715', status: 'ok' },
  { id: 'pers', label: 'Personal', tv: 'TV2200', status: 'ok' },
];

const RULES = [
  { id: 'daily-loss', name: 'Daily Loss Limit', val: '$1,200', curr: '$840 used', pct: 70, status: 'warn', on: true, group: 'Risk' },
  { id: 'max-dd', name: 'Max Drawdown', val: '$2,500', curr: 'trailing $1,150', pct: 46, status: 'ok', on: true, group: 'Risk' },
  { id: 'risk-trade', name: 'Risk per Trade', val: '1% · $500', curr: 'auto-SL', pct: 100, status: 'ok', on: true, group: 'Risk' },
  { id: 'pos-size', name: 'Position Size', val: '5 contracts', curr: 'NQ, ES capped', pct: 100, status: 'ok', on: true, group: 'Position' },
  { id: 'max-open', name: 'Max Open Positions', val: '3', curr: '2 open now', pct: 67, status: 'ok', on: true, group: 'Position' },
  { id: 'profit-tgt', name: 'Daily Profit Target', val: '$3,000', curr: '$1,840 today', pct: 61, status: 'ok', on: true, group: 'Goals' },
  { id: 'hours', name: 'Trading Hours', val: '08:30→16:00 ET', curr: 'Mon–Fri', pct: 100, status: 'ok', on: true, group: 'Schedule' },
  { id: 'consistency', name: 'Consistency', val: '≤ 40% best day', curr: 'within range', pct: 100, status: 'ok', on: true, group: 'Goals' },
  { id: 'news', name: 'News Blackout', val: '5 min ±', curr: 'CPI Thu 8:30', pct: 0, status: 'bad', on: false, group: 'Schedule' },
];

// ─────────────────────────────────────────────────────────────────
// V1 · Accordion list (sparse → expandable, view-then-edit)
// ─────────────────────────────────────────────────────────────────
const V1Accordion = () => {
  const expandedId = 'daily-loss';
  return (
    <div className="wf-board" style={{ padding: 28 }}>
      {/* Header */}
      <div className="wf-row wf-between" style={{ marginBottom: 18 }}>
        <div>
          <h1 className="wf-h1">Trading Rules</h1>
          <div className="wf-mute wf-small" style={{ marginTop: 4 }}>
            9 rules · synced with Tradovate · last change 2 min ago
          </div>
        </div>
        <div className="wf-row wf-gap-2">
          <Btn ghost>discard</Btn>
          <Btn primary>save 2 changes</Btn>
        </div>
      </div>

      {/* Account row */}
      <div className="wf-row wf-gap-2" style={{ marginBottom: 8, alignItems: 'center' }}>
        <span className="wf-mute wf-small">editing for —</span>
        {ACCOUNTS.map((a, i) => (
          <Chip key={a.id} active={i === 0}>
            <span className="wf-dot" style={{ color: a.status === 'warn' ? WFCOLORS.warn : WFCOLORS.ok }} />
            {a.label} <span className="wf-mute wf-tiny" style={{ marginLeft: 4 }}>{a.tv}</span>
          </Chip>
        ))}
        <span style={{ marginLeft: 'auto' }}>
          <Chip ghost>+ apply to all 4</Chip>
        </span>
      </div>

      <div className="wf-divider" style={{ margin: '14px 0 18px' }} />

      {/* Accordion */}
      <SB style={{ padding: 0 }}>
        {RULES.map((r, i) => {
          const open = r.id === expandedId;
          return (
            <div key={r.id}>
              <div className="wf-row" style={{ padding: '14px 20px', alignItems: 'center', gap: 16 }}>
                <span className="wf-mono wf-mute wf-tiny" style={{ width: 22 }}>{String(i + 1).padStart(2, '0')}</span>
                <Toggle on={r.on} bad={!r.on} />
                <span className="wf-h3" style={{ width: 200 }}>{r.name}</span>
                <span className="wf-mute wf-tiny" style={{ width: 70 }}>{r.group}</span>
                <span className="wf-grow wf-mono wf-small" style={{ textAlign: 'right' }}>{r.val}</span>
                <span style={{ width: 100, textAlign: 'right' }}>
                  <Badge type={r.status}>{r.status === 'ok' ? 'on track' : r.status === 'warn' ? '70%' : 'off'}</Badge>
                </span>
                <span className="wf-mute" style={{ width: 18, textAlign: 'center' }}>{open ? '▾' : '▸'}</span>
              </div>

              {open && (
                <div style={{ padding: '4px 24px 22px 70px', background: WFCOLORS.paper2, borderTop: `1.5px dashed ${WFCOLORS.ink}22`, borderBottom: `1.5px dashed ${WFCOLORS.ink}22` }}>
                  <div className="wf-row wf-gap-6" style={{ marginTop: 16, alignItems: 'flex-start' }}>
                    <div className="wf-col wf-gap-3" style={{ flex: 1 }}>
                      <div className="wf-row wf-gap-4">
                        <label className="wf-col wf-gap-1">
                          <span className="wf-mute wf-tiny">loss limit ($)</span>
                          <input className="wf-input wf-input--solid" defaultValue="1200" style={{ width: 110 }} />
                        </label>
                        <label className="wf-col wf-gap-1">
                          <span className="wf-mute wf-tiny">resets at</span>
                          <input className="wf-input wf-input--solid" defaultValue="17:00 ET" style={{ width: 110 }} />
                        </label>
                        <label className="wf-col wf-gap-1">
                          <span className="wf-mute wf-tiny">warn at</span>
                          <input className="wf-input wf-input--solid" defaultValue="80%" style={{ width: 80 }} />
                        </label>
                      </div>
                      <div className="wf-col wf-gap-2" style={{ marginTop: 6 }}>
                        <span className="wf-mute wf-tiny">when triggered →</span>
                        <div className="wf-row wf-gap-2" style={{ flexWrap: 'wrap' }}>
                          <Chip active>close all positions</Chip>
                          <Chip active>cancel pending orders</Chip>
                          <Chip active>lock account till reset</Chip>
                          <Chip ghost>+ add action</Chip>
                        </div>
                      </div>
                    </div>

                    <div className="wf-col wf-gap-2" style={{ width: 240 }}>
                      <span className="wf-mute wf-tiny">today's usage</span>
                      <SB shadow={false} style={{ padding: 12, background: WFCOLORS.paper }}>
                        <div className="wf-row wf-between" style={{ marginBottom: 6 }}>
                          <span className="wf-mono" style={{ fontSize: 18, color: WFCOLORS.warn }}>−$840</span>
                          <span className="wf-mute wf-tiny">of $1,200</span>
                        </div>
                        <Progress pct={70} type="warn" />
                        <div className="wf-mute wf-tiny" style={{ marginTop: 6 }}>resets in 4h 12m</div>
                      </SB>
                    </div>
                  </div>
                </div>
              )}

              {i < RULES.length - 1 && !open && (
                <div className="wf-hdiv" style={{ marginLeft: 20, marginRight: 20 }} />
              )}
            </div>
          );
        })}
      </SB>

      <div className="wf-row wf-center" style={{ marginTop: 14 }}>
        <Btn ghost>+ add custom rule</Btn>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// V2 · Dashboard cards (status-forward, dense)
// ─────────────────────────────────────────────────────────────────
const V2Dashboard = () => {
  return (
    <div className="wf-board" style={{ padding: 26 }}>
      {/* Header strip with global compliance */}
      <div className="wf-row wf-between" style={{ marginBottom: 18 }}>
        <div className="wf-row wf-gap-4" style={{ alignItems: 'flex-end' }}>
          <h1 className="wf-h1">Rules · Eval $50K</h1>
          <span className="wf-mute wf-small" style={{ marginBottom: 4 }}>TV4128 · live</span>
        </div>
        <div className="wf-row wf-gap-2">
          <Btn ghost sm>↻ sync</Btn>
          <Btn ghost sm>copy from…</Btn>
          <Btn primary>edit rules</Btn>
        </div>
      </div>

      {/* Account tabs */}
      <div className="wf-row" style={{ borderBottom: `1.5px solid ${WFCOLORS.ink}22`, marginBottom: 20 }}>
        {ACCOUNTS.map((a, i) => (
          <button key={a.id} className={`wf-tab ${i === 0 ? 'wf-tab--active' : ''}`}>
            <span className="wf-dot" style={{ display: 'inline-block', marginRight: 6, color: a.status === 'warn' ? WFCOLORS.warn : WFCOLORS.ok }} />
            {a.label}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', alignSelf: 'center' }} className="wf-row wf-gap-2">
          <span className="wf-mute wf-small">overall:</span>
          <Badge type="warn">1 warning · 1 disabled</Badge>
        </span>
      </div>

      {/* Card grid 3x3 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {RULES.map((r, i) => (
          <SB key={r.id} className={i % 4 === 1 ? 'wf-rot-r' : i % 4 === 3 ? 'wf-rot-l' : ''} style={{ padding: 16 }}>
            <div className="wf-row wf-between" style={{ marginBottom: 10 }}>
              <span className="wf-h3">{r.name}</span>
              <Badge type={r.status}>
                {r.status === 'ok' ? 'on track' : r.status === 'warn' ? '70% used' : 'disabled'}
              </Badge>
            </div>
            <div className="wf-row wf-between" style={{ alignItems: 'flex-end', marginBottom: 12 }}>
              <span className="wf-mono" style={{ fontSize: 26, lineHeight: 1, color: r.status === 'bad' ? WFCOLORS.muted : WFCOLORS.ink }}>{r.val}</span>
              <span className="wf-mute wf-tiny" style={{ textAlign: 'right', maxWidth: 110 }}>{r.curr}</span>
            </div>
            <Progress pct={r.status === 'bad' ? 0 : r.pct} type={r.status} />
            <div className="wf-row wf-between" style={{ marginTop: 10 }}>
              <span className="wf-mute wf-tiny">{r.group}</span>
              <span className="wf-row wf-gap-2">
                <Toggle on={r.on} />
                <span className="wf-tiny" style={{ textDecoration: 'underline', textDecorationStyle: 'dashed' }}>edit</span>
              </span>
            </div>
          </SB>
        ))}
      </div>

      <div className="wf-row wf-center wf-gap-2" style={{ marginTop: 18 }}>
        <Btn ghost>+ add custom rule</Btn>
        <span className="wf-mute wf-tiny">⌘N</span>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// V3 · Split view (master/detail, focused inline edit)
// ─────────────────────────────────────────────────────────────────
const V3Split = () => {
  const selectedId = 'daily-loss';
  return (
    <div className="wf-board" style={{ padding: 0, display: 'flex' }}>
      {/* Left rail */}
      <div style={{ width: 280, padding: '24px 18px', borderRight: `1.5px dashed ${WFCOLORS.ink}33`, background: WFCOLORS.paper2 }}>
        <h1 className="wf-h1" style={{ fontSize: 22, marginBottom: 4 }}>Rules</h1>
        <div className="wf-mute wf-tiny" style={{ marginBottom: 16 }}>Guardrail · v2</div>

        <SB shadow={false} style={{ padding: 10, marginBottom: 18, background: WFCOLORS.paper }}>
          <div className="wf-mute wf-tiny" style={{ marginBottom: 6 }}>account</div>
          <div className="wf-row wf-between" style={{ alignItems: 'center' }}>
            <div>
              <div className="wf-h3">Eval $50K</div>
              <div className="wf-mute wf-tiny wf-mono">TV4128</div>
            </div>
            <span className="wf-mute">▾</span>
          </div>
        </SB>

        {['Risk', 'Position', 'Goals', 'Schedule'].map(grp => (
          <div key={grp} style={{ marginBottom: 14 }}>
            <div className="wf-mute wf-tiny" style={{ textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, paddingLeft: 4 }}>{grp}</div>
            <div className="wf-col" style={{ gap: 2 }}>
              {RULES.filter(r => r.group === grp).map(r => {
                const sel = r.id === selectedId;
                return (
                  <div key={r.id} className="wf-row wf-between" style={{
                    padding: '8px 10px',
                    background: sel ? WFCOLORS.ink : 'transparent',
                    color: sel ? WFCOLORS.paper : WFCOLORS.ink,
                    borderRadius: '7px 11px 6px 12px',
                    cursor: 'pointer',
                  }}>
                    <span className="wf-row wf-gap-2" style={{ alignItems: 'center' }}>
                      <span className="wf-dot" style={{ color: r.status === 'ok' ? WFCOLORS.ok : r.status === 'warn' ? WFCOLORS.warn : WFCOLORS.bad }} />
                      <span className="wf-small">{r.name}</span>
                    </span>
                    {!r.on && <span className="wf-tiny" style={{ opacity: 0.7 }}>off</span>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <div className="wf-hdiv" style={{ margin: '14px 0' }} />
        <Btn ghost sm style={{ width: '100%' }}>+ add custom rule</Btn>
      </div>

      {/* Detail pane */}
      <div className="wf-grow" style={{ padding: 32, overflow: 'hidden' }}>
        {/* Breadcrumb + actions */}
        <div className="wf-row wf-between" style={{ marginBottom: 18 }}>
          <div className="wf-mute wf-small">
            Rules <span className="wf-arrow" /> Risk <span className="wf-arrow" /> <span style={{ color: WFCOLORS.ink, fontWeight: 600 }}>Daily Loss Limit</span>
          </div>
          <div className="wf-row wf-gap-2">
            <Btn ghost sm>history</Btn>
            <Btn ghost sm>duplicate to →</Btn>
            <Btn primary sm>apply</Btn>
          </div>
        </div>

        <div className="wf-row wf-between" style={{ alignItems: 'flex-start', marginBottom: 22 }}>
          <div>
            <h1 className="wf-h1">Daily Loss Limit</h1>
            <p className="wf-mute wf-small" style={{ margin: '6px 0 0', maxWidth: 480 }}>
              Stops trading for the day if realized + unrealized P&L drops below this threshold. Required by most prop firms.
            </p>
          </div>
          <div className="wf-row wf-gap-2" style={{ alignItems: 'center' }}>
            <span className="wf-small">enabled</span>
            <Toggle on />
          </div>
        </div>

        {/* Main form columns */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 28 }}>
          <SB style={{ padding: 22 }}>
            <ScribbleTitle>Threshold</ScribbleTitle>
            <div className="wf-row wf-gap-4" style={{ marginTop: 16, alignItems: 'flex-end' }}>
              <label className="wf-col wf-gap-1" style={{ flex: 1 }}>
                <span className="wf-mute wf-tiny">amount ($)</span>
                <input className="wf-input wf-input--solid" defaultValue="1,200" style={{ fontSize: 22 }} />
              </label>
              <label className="wf-col wf-gap-1" style={{ flex: 1 }}>
                <span className="wf-mute wf-tiny">or % of balance</span>
                <input className="wf-input wf-input--solid" defaultValue="2.4%" style={{ fontSize: 22 }} />
              </label>
            </div>

            <div style={{ marginTop: 24 }}>
              <div className="wf-row wf-between" style={{ marginBottom: 6 }}>
                <span className="wf-mute wf-tiny">resets at</span>
                <span className="wf-mute wf-tiny">timezone: ET</span>
              </div>
              <div className="wf-row wf-gap-2">
                {['00:00', '17:00', '18:00', 'custom…'].map((t, i) => (
                  <Chip key={t} active={i === 1}>{t}</Chip>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 24 }}>
              <div className="wf-mute wf-tiny" style={{ marginBottom: 8 }}>warn me when P&L hits</div>
              <div className="wf-row wf-gap-3" style={{ alignItems: 'center' }}>
                <span className="wf-mono wf-small">50%</span>
                <SB shadow={false} style={{ flex: 1, height: 12, padding: 0, position: 'relative', background: WFCOLORS.paper2 }}>
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '80%', background: WFCOLORS.warn + '55', borderRadius: 'inherit' }} />
                  <div style={{ position: 'absolute', left: '80%', top: -4, width: 12, height: 18, background: WFCOLORS.ink, borderRadius: 3, transform: 'translateX(-6px)' }} />
                </SB>
                <span className="wf-mono wf-small">100%</span>
                <span className="wf-mono" style={{ fontSize: 16, minWidth: 50, textAlign: 'right' }}>80%</span>
              </div>
            </div>
          </SB>

          <SB style={{ padding: 22 }}>
            <ScribbleTitle color={WFCOLORS.bad}>When triggered</ScribbleTitle>
            <div className="wf-col wf-gap-2" style={{ marginTop: 14 }}>
              {[
                ['close all open positions', true],
                ['cancel pending orders', true],
                ['lock account until reset', true],
                ['notify by email + push', true],
                ['send Discord webhook', false],
              ].map(([txt, on]) => (
                <div key={txt} className="wf-row wf-gap-3" style={{ padding: '6px 0' }}>
                  <Toggle on={on} />
                  <span className="wf-small">{txt}</span>
                </div>
              ))}
            </div>
            <div className="wf-hdiv" style={{ margin: '16px 0' }} />
            <div className="wf-mute wf-tiny" style={{ marginBottom: 6 }}>cooldown after trigger</div>
            <div className="wf-row wf-gap-2">
              {['none', '1 hr', 'till reset', 'next day'].map((t, i) => (
                <Chip key={t} active={i === 2}>{t}</Chip>
              ))}
            </div>
          </SB>
        </div>

        {/* Live status bar */}
        <SB style={{ marginTop: 22, padding: 18 }}>
          <div className="wf-row wf-between" style={{ alignItems: 'center' }}>
            <div className="wf-row wf-gap-4" style={{ alignItems: 'center' }}>
              <div>
                <div className="wf-mute wf-tiny">right now</div>
                <div className="wf-mono" style={{ fontSize: 24, color: WFCOLORS.warn }}>−$840 / $1,200</div>
              </div>
              <div className="wf-vdiv" style={{ height: 36 }} />
              <div className="wf-col wf-gap-1">
                <Spark vals={[3, 5, 4, 6, 8, 7, 10, 9, 12, 14, 13, 16]} />
                <span className="wf-mute wf-tiny">P&L · last 12 trades</span>
              </div>
            </div>
            <Btn ghost sm>open positions ↗</Btn>
          </div>
        </SB>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// V4 · Matrix table (power-user, rules × accounts, dense)
// ─────────────────────────────────────────────────────────────────
const V4Matrix = () => {
  const cellVals = {
    'daily-loss':  ['$1,200', '$2,500', '$1,200', '—'],
    'max-dd':      ['$2,500', '$5,000', '$2,500', '—'],
    'risk-trade':  ['1%',    '0.5%',   '1%',    '2%'],
    'pos-size':    ['5',     '10',     '5',     '20'],
    'max-open':    ['3',     '5',      '3',     '∞'],
    'profit-tgt':  ['$3,000','$5,000', '$3,000','—'],
    'hours':       ['8:30-16','8:30-16','8:30-16','24/5'],
    'consistency': ['40%',   '40%',    '40%',   '—'],
    'news':        ['off',   '5min ±', '5min ±','off'],
  };
  const statuses = {
    'daily-loss':  ['warn', 'ok', 'ok', 'neutral'],
    'max-dd':      ['ok', 'ok', 'ok', 'neutral'],
    'risk-trade':  ['ok', 'ok', 'ok', 'ok'],
    'pos-size':    ['ok', 'ok', 'ok', 'ok'],
    'max-open':    ['ok', 'ok', 'ok', 'ok'],
    'profit-tgt':  ['ok', 'ok', 'ok', 'neutral'],
    'hours':       ['ok', 'ok', 'ok', 'ok'],
    'consistency': ['ok', 'ok', 'ok', 'neutral'],
    'news':        ['bad', 'ok', 'ok', 'neutral'],
  };
  const tone = s => s === 'ok' ? WFCOLORS.ok : s === 'warn' ? WFCOLORS.warn : s === 'bad' ? WFCOLORS.bad : WFCOLORS.faint;

  return (
    <div className="wf-board" style={{ padding: 26 }}>
      <div className="wf-row wf-between" style={{ marginBottom: 14 }}>
        <div>
          <h1 className="wf-h1">Rules matrix</h1>
          <div className="wf-mute wf-small" style={{ marginTop: 4 }}>9 rules · 4 accounts · click any cell to edit · ⇧-click for bulk</div>
        </div>
        <div className="wf-row wf-gap-2">
          <Btn ghost sm>⇩ export csv</Btn>
          <Btn ghost sm>↻ pull from broker</Btn>
          <Btn primary>save all</Btn>
        </div>
      </div>

      {/* Toolbar */}
      <div className="wf-row wf-gap-3" style={{ marginBottom: 14, alignItems: 'center' }}>
        <span className="wf-mute wf-small">filter:</span>
        {['all', 'enabled', 'violations', 'warnings', 'risk', 'schedule'].map((t, i) => (
          <Chip key={t} active={i === 0}>{t}</Chip>
        ))}
        <span style={{ marginLeft: 'auto' }} className="wf-row wf-gap-2 wf-mute wf-tiny">
          <span><span className="wf-dot" style={{ color: WFCOLORS.ok, display: 'inline-block', marginRight: 4 }} />ok</span>
          <span><span className="wf-dot" style={{ color: WFCOLORS.warn, display: 'inline-block', marginRight: 4 }} />near limit</span>
          <span><span className="wf-dot" style={{ color: WFCOLORS.bad, display: 'inline-block', marginRight: 4 }} />violation</span>
          <span><span className="wf-dot" style={{ color: WFCOLORS.faint, display: 'inline-block', marginRight: 4 }} />n/a</span>
        </span>
      </div>

      {/* Matrix */}
      <SB style={{ padding: 0, overflow: 'hidden' }}>
        {/* Column header */}
        <div className="wf-row" style={{ background: WFCOLORS.paper2, borderBottom: `1.5px solid ${WFCOLORS.ink}` }}>
          <div style={{ width: 230, padding: '12px 16px', borderRight: `1.5px solid ${WFCOLORS.ink}22` }} className="wf-mute wf-tiny">rule</div>
          {ACCOUNTS.map((a, i) => (
            <div key={a.id} className="wf-col" style={{ flex: 1, padding: '10px 14px', borderRight: i < ACCOUNTS.length - 1 ? `1.5px solid ${WFCOLORS.ink}22` : 'none' }}>
              <span className="wf-h3" style={{ fontSize: 14 }}>{a.label}</span>
              <span className="wf-mono wf-tiny wf-mute">{a.tv} · {a.status}</span>
            </div>
          ))}
          <div style={{ width: 80, padding: 12 }} className="wf-mute wf-tiny" >actions</div>
        </div>

        {RULES.map((r, ri) => (
          <div key={r.id} className="wf-row" style={{ borderBottom: ri < RULES.length - 1 ? `1px solid ${WFCOLORS.ink}15` : 'none', minHeight: 56 }}>
            <div style={{ width: 230, padding: '12px 16px', borderRight: `1.5px solid ${WFCOLORS.ink}22`, background: WFCOLORS.paper }} className="wf-col wf-gap-1">
              <div className="wf-row wf-gap-2" style={{ alignItems: 'center' }}>
                <Toggle on={r.on} />
                <span className="wf-h3" style={{ fontSize: 14 }}>{r.name}</span>
              </div>
              <span className="wf-mute wf-tiny" style={{ marginLeft: 42 }}>{r.group.toLowerCase()}</span>
            </div>
            {cellVals[r.id].map((v, i) => {
              const st = statuses[r.id][i];
              return (
                <div key={i} style={{
                  flex: 1, padding: '14px', borderRight: i < ACCOUNTS.length - 1 ? `1.5px solid ${WFCOLORS.ink}22` : 'none',
                  background: st === 'warn' ? WFCOLORS.warn + '14' : st === 'bad' ? WFCOLORS.bad + '14' : 'transparent',
                  borderLeft: ri === 0 && i === 0 ? 'none' : undefined,
                  position: 'relative',
                  cursor: 'pointer',
                }}>
                  <div className="wf-row" style={{ alignItems: 'center', gap: 6 }}>
                    <span className="wf-dot" style={{ color: tone(st), flex: '0 0 auto' }} />
                    <span className="wf-mono wf-small">{v}</span>
                  </div>
                  {st !== 'neutral' && (
                    <Progress pct={r.pct} type={st} />
                  )}
                </div>
              );
            })}
            <div style={{ width: 80, padding: 12 }} className="wf-row wf-gap-1">
              <Btn ghost sm>⋯</Btn>
            </div>
          </div>
        ))}
      </SB>

      <div className="wf-row wf-between" style={{ marginTop: 14, alignItems: 'center' }}>
        <span className="wf-mute wf-tiny">
          tip: select column → <span className="wf-kbd">⌘C</span> / <span className="wf-kbd">⌘V</span> to copy rules between accounts
        </span>
        <Btn ghost sm>+ add rule row</Btn>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// V5 · Guided wizard (first-run / onboarding)
// ─────────────────────────────────────────────────────────────────
const V5Wizard = () => {
  const steps = ['Connect', 'Account', 'Daily Loss', 'Drawdown', 'Position', 'Schedule', 'News', 'Review'];
  const current = 2;
  return (
    <div className="wf-board" style={{ padding: 0, display: 'flex' }}>
      {/* Side step rail */}
      <div style={{ width: 240, padding: '32px 22px', background: WFCOLORS.paper3, borderRight: `1.5px solid ${WFCOLORS.ink}22` }}>
        <div className="wf-mono wf-mute wf-tiny" style={{ marginBottom: 6 }}>SET-UP / STEP 3 of 8</div>
        <h2 className="wf-h2" style={{ marginBottom: 22 }}>Build your<br />Trading Rules</h2>
        <div className="wf-col" style={{ gap: 4 }}>
          {steps.map((s, i) => {
            const done = i < current;
            const active = i === current;
            return (
              <div key={s} className="wf-row wf-gap-2" style={{ padding: '7px 6px', alignItems: 'center', opacity: i > current + 1 ? 0.55 : 1 }}>
                <span style={{
                  width: 22, height: 22, borderRadius: '50%',
                  border: `1.5px solid ${WFCOLORS.ink}`,
                  background: done ? WFCOLORS.ink : active ? WFCOLORS.highlight : WFCOLORS.paper,
                  color: done ? WFCOLORS.paper : WFCOLORS.ink,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: FONT_MONO, fontSize: 11,
                }}>{done ? '✓' : i + 1}</span>
                <span className="wf-small" style={{ fontWeight: active ? 700 : 400 }}>{s}</span>
              </div>
            );
          })}
        </div>
        <div className="wf-hdiv" style={{ margin: '24px 0' }} />
        <div className="wf-mute wf-tiny" style={{ lineHeight: 1.5 }}>
          You can change every rule later from the Rules page. This wizard just sets sensible defaults for your prop-firm eval.
        </div>
      </div>

      {/* Main area */}
      <div className="wf-grow wf-col" style={{ padding: '36px 56px', justifyContent: 'space-between' }}>
        <div>
          {/* Progress dots */}
          <div className="wf-row wf-gap-1" style={{ marginBottom: 18 }}>
            {steps.map((_, i) => (
              <div key={i} style={{
                flex: 1, height: 5,
                background: i <= current ? WFCOLORS.ink : WFCOLORS.faint + '66',
                borderRadius: 3,
              }} />
            ))}
          </div>

          <h1 className="wf-h1" style={{ fontSize: 36, marginBottom: 6 }}>
            <span className="wf-squig">Daily loss limit</span>
          </h1>
          <p className="wf-mute" style={{ fontSize: 15, maxWidth: 540, marginTop: 14, lineHeight: 1.55 }}>
            How much can you lose in a single day before Guardrail closes everything and locks the account? Most $50K evals require this to be at most <span className="wf-mono" style={{ color: WFCOLORS.ink }}>$1,250</span>.
          </p>

          {/* Big number input */}
          <div className="wf-row wf-gap-4" style={{ marginTop: 32, alignItems: 'flex-end' }}>
            <label className="wf-col wf-gap-2">
              <span className="wf-mute wf-tiny">stop trading after losing</span>
              <div className="wf-row" style={{ alignItems: 'baseline', gap: 4 }}>
                <span className="wf-mono" style={{ fontSize: 56, color: WFCOLORS.muted }}>$</span>
                <input className="wf-input" defaultValue="1,200" style={{
                  fontSize: 56, width: 200, fontFamily: FONT_MONO, fontWeight: 700,
                  borderBottom: `2px solid ${WFCOLORS.ink}`, padding: '0 8px',
                }} />
              </div>
            </label>
            <div className="wf-col wf-gap-2" style={{ marginBottom: 14 }}>
              <span className="wf-mute wf-tiny">or pick a preset</span>
              <div className="wf-row wf-gap-2">
                {['$500', '$1,000', '$1,200', '$2,000', 'custom'].map((t, i) => (
                  <Chip key={t} active={i === 2}>{t}</Chip>
                ))}
              </div>
            </div>
          </div>

          {/* Slider */}
          <div style={{ marginTop: 32, maxWidth: 620 }}>
            <div className="wf-row wf-between" style={{ marginBottom: 6 }}>
              <span className="wf-mute wf-tiny">as % of account balance ($50,000)</span>
              <span className="wf-mono">2.4%</span>
            </div>
            <SB shadow={false} style={{ height: 14, padding: 0, position: 'relative', background: WFCOLORS.paper2 }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '24%', background: WFCOLORS.ink, borderRadius: 'inherit' }} />
              <div style={{ position: 'absolute', left: '24%', top: -5, width: 14, height: 22, background: WFCOLORS.ink, borderRadius: 4, transform: 'translateX(-7px)' }} />
              <div style={{ position: 'absolute', left: '40%', top: -2, bottom: -2, width: 1, background: WFCOLORS.bad, borderLeft: `2px dashed ${WFCOLORS.bad}` }} />
              <div style={{ position: 'absolute', left: '40%', top: -22, transform: 'translateX(-50%)', fontFamily: FONT_HAND, fontSize: 11, color: WFCOLORS.bad }}>prop firm cap</div>
            </SB>
            <div className="wf-row wf-between wf-mute wf-tiny" style={{ marginTop: 8 }}>
              <span>$0</span><span>$2,500</span><span>$5,000</span>
            </div>
          </div>

          {/* When triggered preview */}
          <SB style={{ marginTop: 28, padding: 16, background: WFCOLORS.paper2, maxWidth: 620 }}>
            <div className="wf-row wf-gap-2" style={{ alignItems: 'center', marginBottom: 8 }}>
              <span className="wf-stamp" style={{ color: WFCOLORS.bad }}>preview</span>
              <span className="wf-small">when you hit −$1,200, Guardrail will:</span>
            </div>
            <div className="wf-col wf-gap-1" style={{ paddingLeft: 8 }}>
              {['close all open positions', 'cancel pending orders', 'lock your Tradovate account until 5pm ET'].map((t, i) => (
                <div key={t} className="wf-row wf-gap-2 wf-small">
                  <span className="wf-mono wf-mute" style={{ width: 16 }}>{i + 1}.</span>
                  <span>{t}</span>
                </div>
              ))}
            </div>
            <div className="wf-mute wf-tiny" style={{ marginTop: 8, fontStyle: 'italic' }}>(you can change these in the next step)</div>
          </SB>
        </div>

        {/* Footer nav */}
        <div className="wf-row wf-between" style={{ marginTop: 24, paddingTop: 18, borderTop: `1.5px dashed ${WFCOLORS.ink}22` }}>
          <Btn ghost>← back to Account</Btn>
          <div className="wf-row wf-gap-2 wf-mute wf-small" style={{ alignItems: 'center' }}>
            <span className="wf-kbd">⏎</span> to continue
          </div>
          <div className="wf-row wf-gap-2">
            <Btn ghost>skip step</Btn>
            <Btn primary>continue →</Btn>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// Mobile · two screens
// ─────────────────────────────────────────────────────────────────
const M1Mobile = () => (
  <div className="wf-board" style={{ padding: 14 }}>
    <div className="wf-row wf-between" style={{ marginBottom: 12 }}>
      <span className="wf-mono wf-tiny wf-mute">9:41</span>
      <span className="wf-mono wf-tiny wf-mute">●●● 5G ▮</span>
    </div>
    <div className="wf-row wf-between" style={{ marginBottom: 14 }}>
      <span className="wf-h2">Rules</span>
      <Btn ghost sm>edit</Btn>
    </div>
    <div className="wf-row wf-gap-2" style={{ marginBottom: 14, overflow: 'hidden' }}>
      <Chip active>Eval $50K</Chip>
      <Chip>Funded $100K</Chip>
      <Chip>+2</Chip>
    </div>
    <SB style={{ padding: 12, marginBottom: 12 }}>
      <div className="wf-row wf-between" style={{ marginBottom: 8 }}>
        <span className="wf-mute wf-tiny">today</span>
        <Badge type="warn">1 near limit</Badge>
      </div>
      <div className="wf-mono" style={{ fontSize: 22, color: WFCOLORS.warn }}>−$840 / $1,200</div>
      <Progress pct={70} type="warn" />
    </SB>
    <div className="wf-col wf-gap-2">
      {RULES.slice(0, 6).map(r => (
        <SB key={r.id} shadow={false} style={{ padding: 12 }}>
          <div className="wf-row wf-between">
            <div className="wf-col wf-gap-1">
              <span className="wf-h3" style={{ fontSize: 14 }}>{r.name}</span>
              <span className="wf-mono wf-tiny wf-mute">{r.val}</span>
            </div>
            <div className="wf-row wf-gap-2" style={{ alignItems: 'center' }}>
              <Badge type={r.status}>{r.status === 'ok' ? 'ok' : r.status === 'warn' ? '70%' : 'off'}</Badge>
              <span className="wf-mute">›</span>
            </div>
          </div>
        </SB>
      ))}
    </div>
    <div className="wf-row" style={{
      position: 'absolute', bottom: 0, left: 0, right: 0,
      padding: 10, justifyContent: 'space-around',
      borderTop: `1.5px solid ${WFCOLORS.ink}22`, background: WFCOLORS.paper,
    }}>
      {['home', 'rules', 'trades', 'me'].map((t, i) => (
        <div key={t} className="wf-col" style={{ alignItems: 'center', gap: 2 }}>
          <div style={{ width: 18, height: 18, border: `1.5px solid ${WFCOLORS.ink}`, borderRadius: 4, opacity: i === 1 ? 1 : 0.4 }} />
          <span className="wf-tiny" style={{ opacity: i === 1 ? 1 : 0.5 }}>{t}</span>
        </div>
      ))}
    </div>
  </div>
);

const M2MobileEdit = () => (
  <div className="wf-board" style={{ padding: 14 }}>
    <div className="wf-row wf-between" style={{ marginBottom: 12 }}>
      <span className="wf-mono wf-tiny wf-mute">9:41</span>
      <span className="wf-mono wf-tiny wf-mute">●●● 5G ▮</span>
    </div>
    <div className="wf-row wf-between" style={{ marginBottom: 14, alignItems: 'center' }}>
      <span className="wf-mute">‹</span>
      <span className="wf-h3">Daily Loss</span>
      <span className="wf-mute"> </span>
    </div>

    <SB style={{ padding: 14, marginBottom: 14 }}>
      <div className="wf-mute wf-tiny" style={{ marginBottom: 4 }}>limit</div>
      <div className="wf-row" style={{ alignItems: 'baseline', gap: 2 }}>
        <span className="wf-mono" style={{ fontSize: 32, color: WFCOLORS.muted }}>$</span>
        <input className="wf-input" defaultValue="1,200" style={{ fontSize: 32, width: 120, fontFamily: FONT_MONO, fontWeight: 700 }} />
      </div>
      <div className="wf-row wf-gap-1" style={{ marginTop: 10, flexWrap: 'wrap' }}>
        {['$500', '$1k', '$1.2k', '$2k'].map((t, i) => <Chip key={t} active={i === 2}>{t}</Chip>)}
      </div>
    </SB>

    <SB style={{ padding: 14, marginBottom: 14 }}>
      <div className="wf-row wf-between" style={{ marginBottom: 6 }}>
        <span className="wf-mute wf-tiny">today's usage</span>
        <span className="wf-mono wf-tiny">70%</span>
      </div>
      <Progress pct={70} type="warn" />
      <div className="wf-mute wf-tiny" style={{ marginTop: 6 }}>−$840 · resets in 4h 12m</div>
    </SB>

    <SB style={{ padding: 14, marginBottom: 14 }}>
      <div className="wf-h3" style={{ fontSize: 14, marginBottom: 10 }}>when triggered</div>
      <div className="wf-col wf-gap-2">
        {[['close positions', true], ['cancel orders', true], ['lock account', true], ['push notify', true]].map(([t, on]) => (
          <div key={t} className="wf-row wf-between" style={{ alignItems: 'center' }}>
            <span className="wf-small">{t}</span>
            <Toggle on={on} />
          </div>
        ))}
      </div>
    </SB>

    <div className="wf-row wf-gap-2" style={{ marginTop: 14 }}>
      <Btn ghost style={{ flex: 1 }}>cancel</Btn>
      <Btn primary style={{ flex: 2 }}>save</Btn>
    </div>
  </div>
);

Object.assign(window, { V1Accordion, V2Dashboard, V3Split, V4Matrix, V5Wizard, M1Mobile, M2MobileEdit });
