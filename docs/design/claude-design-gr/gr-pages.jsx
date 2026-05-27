// Guardrail · full app pages — Dashboard, Trades, Accounts, Alerts, Settings.
// All reuse GrShell + the same tokens/components.

// ─────────────────────────────────────────────────────────────────
// DASHBOARD
// Top strip shows ALL connected accounts as separate cards (no aggregation).
// The rest of the page is the deep-dive of whichever account is selected.
// ─────────────────────────────────────────────────────────────────
const GrDashboard = () => {
  // Per-account snapshot data — separate, never combined.
  const accountSnapshots = [
    { id: 'apex-1',  broker: 'Apex',      name: 'Eval $50K',     ref: 'APEX-50-12091',  balance: 49160,  todayPnl: -840,  status: 'warn',  compliance: 94, pulse: 'Daily loss at 70%', state: 'live',     selected: true },
    { id: 'apex-2',  broker: 'Apex',      name: 'PA $100K',      ref: 'APEX-100-30412', balance: 103420, todayPnl: 2340,  status: 'ok',    compliance: 100, pulse: 'On plan · 4 trades',  state: 'live' },
    { id: 'ts-1',    broker: 'TopStep',   name: 'Combine $50K',  ref: 'TS-77150',       balance: 51200,  todayPnl: 180,   status: 'ok',    compliance: 100, pulse: 'Idle · 0 trades',     state: 'live' },
    { id: 'tv-1',    broker: 'Tradovate', name: 'Personal',      ref: 'TV-2200',        balance: 22840,  todayPnl: 0,     status: 'idle',  compliance: 100, pulse: 'Outside session',     state: 'live' },
    { id: 'tv-2',    broker: 'Tradovate', name: 'Personal Demo', ref: 'TV-2201-DEMO',   balance: 100000, todayPnl: -120,  status: 'ok',    compliance: 100, pulse: 'Practising',           state: 'demo' },
    { id: 'tv-3',    broker: 'Tradovate', name: 'Sim Old',       ref: 'TV-1004',        balance: 0,      todayPnl: 0,     status: 'idle',  compliance: 0,   pulse: 'Connection expired',   state: 'expired' },
  ];
  const selected = accountSnapshots.find(a => a.selected);
  const liveAccounts = accountSnapshots.filter(a => a.state !== 'expired').length;

  const statusColor = s => s === 'ok' ? 'var(--ok)' : s === 'warn' ? 'var(--warn)' : s === 'bad' ? 'var(--bad)' : 'var(--text-faint)';
  const pnlColor = v => v > 0 ? 'var(--ok)' : v < 0 ? 'var(--warn)' : 'var(--text-mute)';
  const fmt$ = v => (v >= 0 ? '+' : '−') + '$' + Math.abs(v).toLocaleString();

  return (
    <div className="gr">
      <GrShellNav active="home" breadcrumb={['Dashboard', `${selected.broker} · ${selected.name}`]}>
        <div style={{ height: '100%', overflow: 'auto' }}>
          {/* Hero */}
          <section style={{ padding: '28px 36px 18px' }}>
            <div className="gr-row gr-between" style={{ alignItems: 'flex-start' }}>
              <div className="gr-col gr-g-2" style={{ maxWidth: 620 }}>
                <span className="gr-label">Good afternoon, Andrew</span>
                <h1 className="gr-display" style={{ fontSize: 36 }}>
                  Watching <span className="gr-mono gr-num" style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: 'italic', color: 'var(--ink)' }}>{liveAccounts}</span> live accounts.
                </h1>
              </div>
              <div className="gr-row gr-g-2">
                <button className="gr-btn"><GIcon name="refresh" size="sm" /> Sync all</button>
                <button className="gr-btn gr-btn--primary"><GIcon name="plus" size="sm" /> Connect account</button>
              </div>
            </div>
          </section>

          {/* ACCOUNT STRIP — every connected account, never aggregated */}
          <section style={{ padding: '8px 36px 22px' }}>
            <div className="gr-row gr-between" style={{ marginBottom: 12 }}>
              <span className="gr-label">Your accounts · {accountSnapshots.length}</span>
              <span className="gr-tiny">Each card is one account. Numbers are never combined.</span>
            </div>
            <div className="gr-row gr-g-3" style={{
              overflowX: 'auto', paddingBottom: 6,
              marginLeft: -2, marginRight: -2,
            }}>
              {accountSnapshots.map(a => {
                const isExp = a.state === 'expired';
                return (
                  <div
                    key={a.id}
                    style={{
                      flex: '0 0 268px',
                      padding: 16,
                      background: 'var(--surface)',
                      border: a.selected ? '1px solid var(--copper)' : '1px solid var(--border)',
                      boxShadow: a.selected ? '0 0 0 3px var(--copper-bg)' : 'none',
                      borderRadius: 12,
                      cursor: 'pointer',
                      opacity: isExp ? 0.78 : 1,
                      position: 'relative',
                    }}>
                    {/* Top: broker badge + state */}
                    <div className="gr-row gr-between" style={{ marginBottom: 12 }}>
                      <div className="gr-row gr-g-2" style={{ alignItems: 'center' }}>
                        <div style={{
                          width: 24, height: 24, borderRadius: 6,
                          background: 'var(--surface-2)', color: 'var(--text-mid)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em',
                        }}>{a.broker.slice(0, 2).toUpperCase()}</div>
                        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-mid)' }}>{a.broker}</span>
                      </div>
                      {a.state === 'demo'    && <span className="gr-badge gr-badge--neutral" style={{ padding: '1px 6px', fontSize: 10 }}>demo</span>}
                      {a.state === 'expired' && <span className="gr-badge gr-badge--bad" style={{ padding: '1px 6px', fontSize: 10 }}>reconnect</span>}
                      {a.state === 'live' && !a.selected && (
                        <span className="gr-dot gr-dot--pulse" style={{ color: statusColor(a.status), width: 8, height: 8 }} />
                      )}
                      {a.selected && <span className="gr-badge gr-badge--copper" style={{ padding: '1px 7px', fontSize: 10 }}>viewing</span>}
                    </div>

                    {/* Name + ref */}
                    <div className="gr-col gr-g-1" style={{ marginBottom: 14 }}>
                      <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{a.name}</span>
                      <span className="gr-mono gr-tiny">{a.ref}</span>
                    </div>

                    {/* Numbers */}
                    {!isExp ? (
                      <>
                        <div className="gr-row gr-between" style={{ alignItems: 'baseline' }}>
                          <div className="gr-col gr-g-1">
                            <span className="gr-tiny">Balance</span>
                            <span className="gr-mono gr-num" style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.1 }}>
                              ${a.balance.toLocaleString()}
                            </span>
                          </div>
                          <div className="gr-col gr-g-1" style={{ textAlign: 'right' }}>
                            <span className="gr-tiny">Today</span>
                            <span className="gr-mono gr-num" style={{ fontSize: 14, fontWeight: 600, color: pnlColor(a.todayPnl) }}>
                              {a.todayPnl === 0 ? '$0' : fmt$(a.todayPnl)}
                            </span>
                          </div>
                        </div>

                        {/* Pulse line */}
                        <div className="gr-row gr-g-2" style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border-sub)' }}>
                          <span className="gr-dot" style={{ color: statusColor(a.status) }} />
                          <span className="gr-tiny" style={{ color: 'var(--text-mid)' }}>{a.pulse}</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="gr-row gr-g-2" style={{ marginBottom: 8 }}>
                          <GIcon name="warn" style={{ color: 'var(--bad)' }} size="sm" />
                          <span className="gr-tiny">{a.pulse}</span>
                        </div>
                        <button className="gr-btn gr-btn--sm" style={{ width: '100%', padding: '6px 10px' }}>
                          <GIcon name="plug" size="sm" /> Reconnect
                        </button>
                      </>
                    )}
                  </div>
                );
              })}

              {/* Add account tile */}
              <button style={{
                flex: '0 0 200px',
                background: 'transparent',
                border: '1px dashed var(--border-hi)',
                borderRadius: 12,
                color: 'var(--text-mute)',
                cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 6, font: 'inherit',
              }}>
                <GIcon name="plus" />
                <span style={{ fontSize: 12.5, fontWeight: 500 }}>Connect another</span>
              </button>
            </div>
          </section>

          {/* SELECTED ACCOUNT — context bar */}
          <section style={{ padding: '4px 36px 18px' }}>
            <div style={{
              background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 12,
              padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
            }}>
              <div className="gr-row gr-g-2" style={{ alignItems: 'center' }}>
                <span className="gr-label">Now viewing</span>
                <span className="gr-h3">{selected.broker} · {selected.name}</span>
                <span className="gr-mono gr-tiny">{selected.ref}</span>
                <span className="gr-badge gr-badge--warn" style={{ marginLeft: 4 }}>
                  <span className="gr-dot gr-dot--pulse" />{selected.pulse}
                </span>
              </div>
              <div className="gr-grow" />
              <button className="gr-btn gr-btn--ghost gr-btn--sm">Compare accounts</button>
              <button className="gr-btn gr-btn--sm"><GIcon name="cal" size="sm" /> Today</button>
            </div>
          </section>

          {/* KPI strip — for the SELECTED account only */}
          <section style={{ padding: '0 36px 22px' }}>
            <div className="gr-row gr-g-3">
              {[
                { l: 'Balance',     v: '$' + selected.balance.toLocaleString(), s: fmt$(selected.todayPnl) + ' today', tone: selected.todayPnl < 0 ? 'warn' : 'ok' },
                { l: 'Today P&L',   v: selected.todayPnl === 0 ? '$0' : fmt$(selected.todayPnl), s: '7 trades · 3W 4L', tone: selected.todayPnl < 0 ? 'warn' : 'ok', highlight: true },
                { l: 'Win rate · 30d', v: '52%',  s: '↑ 4pts vs last 30d', tone: 'ok' },
                { l: 'Days to payout', v: '4 of 7', s: 'min P&L $1,500',  tone: 'mute' },
              ].map((k) => (
                <div key={k.l} className="gr-card" style={{ padding: 18, flex: 1 }}>
                  <span className="gr-label">{k.l}</span>
                  <div className="gr-mono gr-num" style={{
                    fontSize: 28, fontWeight: 600, lineHeight: 1, letterSpacing: '-0.02em',
                    marginTop: 8,
                    color: k.highlight && k.tone === 'warn' ? 'var(--warn)' : 'var(--ink)',
                  }}>{k.v}</div>
                  <span className="gr-tiny" style={{ marginTop: 6, display: 'inline-block', color: k.tone === 'warn' ? 'var(--warn)' : k.tone === 'ok' ? 'var(--ok)' : 'var(--text-mute)' }}>{k.s}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Two-up: rules at a glance + equity curve — for the selected account */}
          <section style={{ padding: '6px 36px 22px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="gr-card" style={{ padding: 22 }}>
              <div className="gr-row gr-between" style={{ marginBottom: 16 }}>
                <div className="gr-col gr-g-1">
                  <span className="gr-h2">Active rules</span>
                  <span className="gr-tiny">{selected.broker} · {selected.name}</span>
                </div>
                <button className="gr-btn gr-btn--ghost gr-btn--sm">View all <GIcon name="arrowR" size="sm" /></button>
              </div>
              <div className="gr-col gr-g-3">
                {GR_RULES.filter(r => r.on && r.enforcement !== 'planned').slice(0, 5).map((r, i, arr) => {
                  const tone = r.status === 'warn' ? 'warn' : r.status === 'bad' ? 'bad' : 'ok';
                  return (
                    <div key={r.id} className="gr-col gr-g-2">
                      <div className="gr-row gr-between" style={{ alignItems: 'center' }}>
                        <div className="gr-row gr-g-2">
                          <span className="gr-dot gr-dot-lg" style={{ color: r.status === 'ok' ? 'var(--ok)' : r.status === 'warn' ? 'var(--warn)' : 'var(--text-faint)' }} />
                          <span className="gr-h3">{r.name}</span>
                          <EnforcementChip type={r.enforcement} size="sm" />
                        </div>
                        <span className="gr-mono gr-num gr-small" style={{ color: 'var(--ink)', fontWeight: 600 }}>
                          {r.usageLabel}
                        </span>
                      </div>
                      {r.usagePct > 0 && r.usagePct < 100 && <div className={`gr-bar gr-bar--${tone}`}><i style={{ width: r.usagePct + '%' }} /></div>}
                      {i < arr.length - 1 && <div style={{ height: 1, background: 'var(--border-sub)', marginTop: 4 }} />}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="gr-card" style={{ padding: 22 }}>
              <div className="gr-row gr-between" style={{ marginBottom: 8 }}>
                <span className="gr-h2">Equity curve · last 14 days</span>
                <div className="gr-seg" style={{ padding: 1 }}>
                  <button style={{ padding: '4px 9px', fontSize: 11.5 }}>1D</button>
                  <button style={{ padding: '4px 9px', fontSize: 11.5 }} className="">7D</button>
                  <button style={{ padding: '4px 9px', fontSize: 11.5 }} className="gr-seg--active">14D</button>
                  <button style={{ padding: '4px 9px', fontSize: 11.5 }}>30D</button>
                </div>
              </div>
              <div className="gr-row gr-g-3" style={{ marginBottom: 14, alignItems: 'baseline' }}>
                <span className="gr-mono gr-num" style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em' }}>$49,160</span>
                <span className="gr-mono gr-tiny" style={{ color: 'var(--ok)' }}>+$1,840 (3.9%)</span>
              </div>

              {/* Simple SVG line chart */}
              <svg viewBox="0 0 600 180" style={{ width: '100%', height: 180, display: 'block' }}>
                <defs>
                  <linearGradient id="equityGrad" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={GR.copper} stopOpacity="0.22" />
                    <stop offset="100%" stopColor={GR.copper} stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[0, 1, 2, 3].map(i => (
                  <line key={i} x1="0" x2="600" y1={i * 45 + 5} y2={i * 45 + 5} stroke={GR.borderSub} strokeWidth="1" strokeDasharray="2 3" />
                ))}
                <path
                  d="M0,120 L40,110 L80,95 L120,100 L160,85 L200,90 L240,70 L280,75 L320,55 L360,80 L400,65 L440,85 L480,75 L520,60 L560,55 L600,65"
                  fill="none" stroke={GR.copper} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                />
                <path
                  d="M0,120 L40,110 L80,95 L120,100 L160,85 L200,90 L240,70 L280,75 L320,55 L360,80 L400,65 L440,85 L480,75 L520,60 L560,55 L600,65 L600,180 L0,180 Z"
                  fill="url(#equityGrad)"
                />
                {/* Last point */}
                <circle cx="600" cy="65" r="4" fill={GR.copper} stroke="white" strokeWidth="2" />
              </svg>

              <div className="gr-row gr-between gr-mono gr-tiny" style={{ marginTop: 8 }}>
                <span>May 12</span><span>May 19</span><span>May 26</span>
              </div>
            </div>
          </section>

          {/* Recent activity */}
          <section style={{ padding: '6px 36px 36px', display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16 }}>
            <div className="gr-card" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="gr-row gr-between" style={{ padding: '18px 22px 14px' }}>
                <span className="gr-h2">Today's trades</span>
                <button className="gr-btn gr-btn--ghost gr-btn--sm">All trades <GIcon name="arrowR" size="sm" /></button>
              </div>
              <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead>
                  <tr>
                    {['Time', 'Symbol', 'Side', 'Qty', 'Entry', 'Exit', 'P&L'].map(h => (
                      <th key={h} className="gr-label" style={{ textAlign: 'left', padding: '10px 16px', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', background: 'var(--bg-elev)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { t: '11:42', s: 'NQM26', side: 'short', q: 2, in: '21,840.25', out: '21,856.50', pnl: -650 },
                    { t: '10:18', s: 'ESM26', side: 'long',  q: 1, in: '5,914.50',  out: '5,907.75',  pnl: -340 },
                    { t: '10:02', s: 'NQM26', side: 'long',  q: 2, in: '21,795.00', out: '21,810.25', pnl: 610 },
                    { t: '09:34', s: 'ESM26', side: 'short', q: 1, in: '5,920.25',  out: '5,915.50',  pnl: 240 },
                    { t: '09:08', s: 'NQM26', side: 'long',  q: 1, in: '21,768.50', out: '21,755.75', pnl: -255 },
                  ].map((row, i) => (
                    <tr key={i}>
                      <td className="gr-mono gr-small" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-sub)', color: 'var(--text-mid)' }}>{row.t}</td>
                      <td className="gr-mono" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-sub)', fontWeight: 500, color: 'var(--ink)' }}>{row.s}</td>
                      <td style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-sub)' }}>
                        <span className={`gr-badge ${row.side === 'long' ? 'gr-badge--ok' : 'gr-badge--bad'}`} style={{ textTransform: 'uppercase', fontSize: 10.5, letterSpacing: 0.05 }}>{row.side}</span>
                      </td>
                      <td className="gr-mono gr-num" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-sub)' }}>{row.q}</td>
                      <td className="gr-mono gr-num" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-sub)', color: 'var(--text-mid)' }}>{row.in}</td>
                      <td className="gr-mono gr-num" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-sub)', color: 'var(--text-mid)' }}>{row.out}</td>
                      <td className="gr-mono gr-num" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-sub)', fontWeight: 600, color: row.pnl >= 0 ? 'var(--ok)' : 'var(--bad)' }}>
                        {row.pnl >= 0 ? '+' : '−'}${Math.abs(row.pnl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="gr-card-soft" style={{ padding: 22 }}>
              <div className="gr-row gr-between" style={{ marginBottom: 16 }}>
                <span className="gr-h2">Recent alerts</span>
                <button className="gr-btn gr-btn--ghost gr-btn--sm">All <GIcon name="arrowR" size="sm" /></button>
              </div>
              <div className="gr-col gr-g-3">
                {[
                  { ic: 'warn',   t: 'Daily loss at 70%', s: '11:42 ET · 4 min ago', tone: 'warn' },
                  { ic: 'lock',   t: 'Tilt protection armed', s: '10:18 ET · 1 hr ago · 2 losses in a row', tone: 'lock' },
                  { ic: 'info',   t: 'Session opened', s: '08:30 ET · 7 hr ago', tone: 'neutral' },
                  { ic: 'check',  t: 'Plan synced from Tradovate', s: 'Today 07:55 ET', tone: 'ok' },
                ].map((a, i) => (
                  <div key={i} className="gr-row gr-g-3" style={{ alignItems: 'flex-start' }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: 8,
                      background: a.tone === 'warn' ? 'var(--warn-bg)' : a.tone === 'lock' ? 'var(--lock-bg)' : a.tone === 'ok' ? 'var(--ok-bg)' : 'var(--surface)',
                      color: a.tone === 'warn' ? 'var(--warn)' : a.tone === 'lock' ? 'var(--lock)' : a.tone === 'ok' ? 'var(--ok)' : 'var(--text-mid)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto',
                      border: '1px solid var(--border)',
                    }}>
                      <GIcon name={a.ic} size="sm" />
                    </div>
                    <div className="gr-col gr-g-1">
                      <span className="gr-h3">{a.t}</span>
                      <span className="gr-tiny">{a.s}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </GrShellNav>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// TRADES
// ─────────────────────────────────────────────────────────────────
const GrTrades = () => {
  const trades = [
    { d: 'May 26', t: '11:42', s: 'NQM26', side: 'short', q: 2, in: '21,840.25', out: '21,856.50', pnl: -650, dur: '4m 12s', tag: 'tilt' },
    { d: 'May 26', t: '10:18', s: 'ESM26', side: 'long',  q: 1, in: '5,914.50',  out: '5,907.75',  pnl: -340, dur: '14m 3s', tag: null },
    { d: 'May 26', t: '10:02', s: 'NQM26', side: 'long',  q: 2, in: '21,795.00', out: '21,810.25', pnl: 610, dur: '6m 22s', tag: null },
    { d: 'May 26', t: '09:34', s: 'ESM26', side: 'short', q: 1, in: '5,920.25',  out: '5,915.50',  pnl: 240, dur: '8m 1s', tag: null },
    { d: 'May 26', t: '09:08', s: 'NQM26', side: 'long',  q: 1, in: '21,768.50', out: '21,755.75', pnl: -255, dur: '12m 44s', tag: null },
    { d: 'May 25', t: '15:24', s: 'NQM26', side: 'short', q: 2, in: '21,910.00', out: '21,894.25', pnl: 630, dur: '22m 8s', tag: null },
    { d: 'May 25', t: '14:08', s: 'ESM26', side: 'long',  q: 1, in: '5,902.25',  out: '5,917.00',  pnl: 740, dur: '18m 12s', tag: 'best' },
    { d: 'May 25', t: '11:55', s: 'NQM26', side: 'long',  q: 1, in: '21,820.50', out: '21,808.75', pnl: -235, dur: '6m 4s', tag: null },
  ];

  return (
    <div className="gr">
      <GrShellNav active="trades" breadcrumb={['Apex · Eval $50K', 'Trades']}>
        <div style={{ height: '100%', overflow: 'auto' }}>
          <section style={{ padding: '32px 36px 22px' }}>
            <div className="gr-row gr-between" style={{ alignItems: 'flex-start' }}>
              <div className="gr-col gr-g-2">
                <span className="gr-label">Trade log</span>
                <h1 className="gr-h1" style={{ fontSize: 28 }}>Trades</h1>
                <p className="gr-body">Synced from Tradovate · last sync 3 seconds ago.</p>
              </div>
              <div className="gr-row gr-g-2">
                <button className="gr-btn"><GIcon name="download" size="sm" /> Export</button>
                <button className="gr-btn"><GIcon name="refresh" size="sm" /> Resync</button>
              </div>
            </div>

            {/* KPI strip */}
            <div className="gr-row gr-g-3" style={{ marginTop: 24 }}>
              {[
                { l: 'Net P&L', v: '+$740',  s: 'last 7d',     tone: 'ok' },
                { l: 'Trades',  v: '38',     s: '21W · 17L',   tone: 'mute' },
                { l: 'Win rate',v: '55%',    s: 'avg 1.3R',    tone: 'mute' },
                { l: 'Largest loss', v: '−$1,200', s: 'May 19',   tone: 'bad' },
                { l: 'Largest win',  v: '+$740',   s: 'May 25',  tone: 'ok' },
              ].map(k => (
                <div key={k.l} className="gr-card" style={{ padding: 16, flex: 1 }}>
                  <span className="gr-label">{k.l}</span>
                  <div className="gr-mono gr-num" style={{ fontSize: 22, fontWeight: 600, marginTop: 6, color: k.tone === 'ok' ? 'var(--ok)' : k.tone === 'bad' ? 'var(--bad)' : 'var(--ink)' }}>{k.v}</div>
                  <span className="gr-tiny" style={{ marginTop: 4, display: 'inline-block' }}>{k.s}</span>
                </div>
              ))}
            </div>

            {/* Filter bar */}
            <div className="gr-row gr-between" style={{ marginTop: 22 }}>
              <div className="gr-row gr-g-2">
                <div className="gr-input-affix" style={{ width: 280 }}>
                  <span className="gr-affix" style={{ background: 'transparent', borderRight: 'none', paddingRight: 4 }}><GIcon name="search" size="sm" /></span>
                  <input className="gr-input" placeholder="Filter symbol, tag, side…" style={{ padding: '8px 12px 8px 0', fontSize: 13 }} />
                </div>
                <span className="gr-chip gr-chip--active">All</span>
                <span className="gr-chip">Winning</span>
                <span className="gr-chip">Losing</span>
                <span className="gr-chip">Tagged</span>
              </div>
              <div className="gr-row gr-g-2">
                <button className="gr-btn gr-btn--sm"><GIcon name="cal" size="sm" /> May 19 – May 26</button>
                <button className="gr-btn gr-btn--sm"><GIcon name="settings" size="sm" /> Columns</button>
              </div>
            </div>
          </section>

          {/* Table */}
          <section style={{ padding: '0 36px 36px' }}>
            <div className="gr-card" style={{ padding: 0, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead>
                  <tr>
                    {['', 'Time', 'Symbol', 'Side', 'Qty', 'Entry', 'Exit', 'Hold', 'P&L', ''].map((h, i) => (
                      <th key={i} className="gr-label" style={{ textAlign: 'left', padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-elev)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trades.map((row, i) => {
                    const prevDate = i > 0 ? trades[i - 1].d : null;
                    const isNewDay = row.d !== prevDate;
                    return (
                      <React.Fragment key={i}>
                        {isNewDay && (
                          <tr>
                            <td colSpan="10" style={{ padding: '14px 16px 6px', background: 'var(--bg-elev)' }}>
                              <div className="gr-row gr-between">
                                <span className="gr-h3">{row.d}</span>
                                <span className="gr-mono gr-tiny">
                                  {trades.filter(t => t.d === row.d).reduce((s, t) => s + t.pnl, 0) >= 0
                                    ? '+$' + trades.filter(t => t.d === row.d).reduce((s, t) => s + t.pnl, 0)
                                    : '−$' + Math.abs(trades.filter(t => t.d === row.d).reduce((s, t) => s + t.pnl, 0))}
                                  · {trades.filter(t => t.d === row.d).length} trades
                                </span>
                              </div>
                            </td>
                          </tr>
                        )}
                        <tr style={{ borderBottom: '1px solid var(--border-sub)' }}>
                          <td style={{ padding: '14px 16px' }}>
                            <span className="gr-dot gr-dot-lg" style={{ color: row.pnl >= 0 ? 'var(--ok)' : 'var(--bad)' }} />
                          </td>
                          <td className="gr-mono gr-small" style={{ padding: '14px 16px', color: 'var(--text-mid)' }}>{row.t}</td>
                          <td className="gr-mono" style={{ padding: '14px 16px', fontWeight: 500, color: 'var(--ink)' }}>{row.s}</td>
                          <td style={{ padding: '14px 16px' }}>
                            <span className={`gr-badge ${row.side === 'long' ? 'gr-badge--ok' : 'gr-badge--bad'}`} style={{ textTransform: 'uppercase', fontSize: 10.5 }}>{row.side}</span>
                          </td>
                          <td className="gr-mono gr-num" style={{ padding: '14px 16px' }}>{row.q}</td>
                          <td className="gr-mono gr-num" style={{ padding: '14px 16px', color: 'var(--text-mid)' }}>{row.in}</td>
                          <td className="gr-mono gr-num" style={{ padding: '14px 16px', color: 'var(--text-mid)' }}>{row.out}</td>
                          <td className="gr-mono gr-small" style={{ padding: '14px 16px', color: 'var(--text-mid)' }}>{row.dur}</td>
                          <td className="gr-mono gr-num" style={{ padding: '14px 16px', fontWeight: 600, color: row.pnl >= 0 ? 'var(--ok)' : 'var(--bad)' }}>
                            {row.pnl >= 0 ? '+' : '−'}${Math.abs(row.pnl)}
                          </td>
                          <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                            {row.tag === 'tilt' && <span className="gr-badge gr-badge--lock">tilt</span>}
                            {row.tag === 'best' && <span className="gr-badge gr-badge--ok">best</span>}
                            {!row.tag && <button className="gr-btn gr-btn--ghost gr-btn--sm gr-btn--icon"><GIcon name="more" size="sm" /></button>}
                          </td>
                        </tr>
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </GrShellNav>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// ACCOUNTS
// ─────────────────────────────────────────────────────────────────
const GrAccounts = () => {
  return (
    <div className="gr">
      <GrShellNav active="accounts" breadcrumb={['Accounts']}>
        <div style={{ height: '100%', overflow: 'auto' }}>
          <section style={{ padding: '32px 36px 22px' }}>
            <div className="gr-row gr-between">
              <div className="gr-col gr-g-2">
                <span className="gr-label">Connected brokers · 3</span>
                <h1 className="gr-h1" style={{ fontSize: 28 }}>Accounts</h1>
                <p className="gr-body">Manage broker connections, propfirm passes, and demo accounts.</p>
              </div>
              <div className="gr-row gr-g-2">
                <button className="gr-btn"><GIcon name="refresh" size="sm" /> Sync all</button>
                <button className="gr-btn gr-btn--primary"><GIcon name="plus" size="sm" /> Connect broker</button>
              </div>
            </div>
          </section>

          {/* Account groups */}
          <section style={{ padding: '6px 36px 36px' }}>
            {GR_ACCOUNT_GROUPS.map(grp => (
              <div key={grp.broker} style={{ marginBottom: 28 }}>
                <div className="gr-row gr-between" style={{ marginBottom: 12, alignItems: 'center' }}>
                  <div className="gr-row gr-g-3" style={{ alignItems: 'center' }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 9, flex: '0 0 auto',
                      background: 'var(--ink)', color: 'var(--bg)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 600, letterSpacing: '-0.02em',
                    }}>{grp.short.slice(0, 2).toUpperCase()}</div>
                    <div className="gr-col">
                      <span className="gr-h2">{grp.broker}</span>
                      <span className="gr-tiny">{grp.accounts.length} account{grp.accounts.length > 1 ? 's' : ''}</span>
                    </div>
                  </div>
                  <button className="gr-btn gr-btn--sm"><GIcon name="settings" size="sm" /> Manage</button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 14 }}>
                  {grp.accounts.map(a => {
                    const isExp = a.state === 'expired';
                    const isDemo = a.state === 'demo';
                    return (
                      <div key={a.id} className="gr-card" style={{
                        padding: 18, position: 'relative',
                        opacity: isExp ? 0.78 : 1,
                        borderColor: a.selected ? 'var(--copper)' : 'var(--border)',
                        boxShadow: a.selected ? '0 0 0 4px var(--copper-bg)' : 'none',
                      }}>
                        <div className="gr-row gr-between" style={{ marginBottom: 10 }}>
                          <div className="gr-row gr-g-2" style={{ alignItems: 'center' }}>
                            <span className="gr-h2">{a.name}</span>
                            {a.state === 'live' && <span className="gr-badge gr-badge--ok"><span className="gr-dot gr-dot--pulse" />live</span>}
                            {isDemo && <span className="gr-badge gr-badge--neutral">demo</span>}
                            {isExp && <span className="gr-badge gr-badge--bad">reconnect</span>}
                          </div>
                          <button className="gr-btn gr-btn--ghost gr-btn--sm gr-btn--icon"><GIcon name="more" size="sm" /></button>
                        </div>
                        <div className="gr-mono gr-tiny" style={{ marginBottom: 14 }}>{a.ref}</div>

                        {!isExp ? (
                          <>
                            <div className="gr-row gr-between" style={{ marginBottom: 12, alignItems: 'baseline' }}>
                              <div className="gr-col">
                                <span className="gr-tiny">Balance</span>
                                <span className="gr-mono gr-num" style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)' }}>${a.balance.toLocaleString()}</span>
                              </div>
                              <div className="gr-col" style={{ textAlign: 'right' }}>
                                <span className="gr-tiny">Today P&L</span>
                                <span className="gr-mono gr-num" style={{ fontSize: 16, fontWeight: 600, color: a.todayPnl > 0 ? 'var(--ok)' : a.todayPnl < 0 ? 'var(--warn)' : 'var(--text-mid)' }}>
                                  {a.todayPnl > 0 ? '+' : a.todayPnl < 0 ? '−' : ''}${Math.abs(a.todayPnl).toLocaleString()}
                                </span>
                              </div>
                            </div>

                            <div className="gr-row gr-between gr-tiny" style={{ paddingTop: 12, borderTop: '1px solid var(--border-sub)' }}>
                              <span>9 rules · 8 active</span>
                              <span className="gr-row gr-g-2">
                                {a.selected
                                  ? <span style={{ color: 'var(--copper)', fontWeight: 600 }}><GIcon name="check" size="sm" style={{ verticalAlign: 'middle' }} /> Selected</span>
                                  : <button className="gr-btn gr-btn--ghost gr-btn--sm" style={{ padding: '2px 6px', color: 'var(--copper)' }}>Switch to <GIcon name="arrowR" size="sm" /></button>
                                }
                              </span>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="gr-row gr-g-2" style={{ marginBottom: 14 }}>
                              <GIcon name="warn" style={{ color: 'var(--bad)' }} />
                              <span className="gr-small">Connection expired May 18. Re-authorize to resume sync.</span>
                            </div>
                            <button className="gr-btn gr-btn--primary gr-btn--sm" style={{ width: '100%' }}>
                              <GIcon name="plug" size="sm" /> Reconnect to {grp.short}
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })}

                  {/* "Add account" tile */}
                  <button style={{
                    background: 'transparent',
                    border: '1px dashed var(--border-hi)',
                    borderRadius: 14,
                    padding: 18,
                    color: 'var(--text-mute)',
                    cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    minHeight: 140, gap: 6,
                    font: 'inherit',
                  }}>
                    <GIcon name="plus" size="lg" />
                    <span style={{ fontSize: 13, fontWeight: 500 }}>Add a {grp.short} account</span>
                  </button>
                </div>
              </div>
            ))}

            {/* Available brokers row */}
            <div className="gr-card-flat" style={{ padding: 22, marginTop: 8 }}>
              <div className="gr-row gr-between" style={{ marginBottom: 14 }}>
                <span className="gr-h2">More brokers</span>
                <span className="gr-tiny">Coming soon · vote on what we ship next</span>
              </div>
              <div className="gr-row gr-g-2" style={{ flexWrap: 'wrap' }}>
                {['NinjaTrader', 'AMP Futures', 'Earn2Trade', 'My Funded Futures', 'Bulenox', 'FundedNext'].map(b => (
                  <span key={b} className="gr-chip">
                    <GIcon name="sparkle" size="sm" /> {b}
                  </span>
                ))}
              </div>
            </div>
          </section>
        </div>
      </GrShellNav>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// ALERTS
// ─────────────────────────────────────────────────────────────────
const GrAlerts = () => {
  const alerts = [
    { sev: 'warn', ic: 'warn',  t: 'Daily loss at 70%', sub: 'Apex · Eval $50K · $840 of $1,200 used', time: '11:42 ET · 4 min ago', read: false },
    { sev: 'lock', ic: 'lock',  t: 'Tilt protection armed', sub: '2 consecutive losses · pauses on a 3rd', time: '10:18 ET · 1 hr ago', read: false },
    { sev: 'info', ic: 'info',  t: 'Session opened', sub: 'Apex · Eval $50K · 08:30 ET', time: 'Today 08:30 ET', read: true },
    { sev: 'ok',   ic: 'check', t: 'Plan synced from Tradovate', sub: 'No drift detected · 9 rules synced', time: 'Today 07:55 ET', read: true },
    { sev: 'bad',  ic: 'warn',  t: 'Daily loss reached · session closed', sub: 'Apex · Eval $50K · auto-flatten not yet active, 3 positions still open', time: 'Mon May 19 · 14:08 ET', read: true },
    { sev: 'info', ic: 'plug',  t: 'Tradovate API reconnected', sub: 'Sync resumed after 12 min outage', time: 'Sun May 18 · 09:32 ET', read: true },
  ];
  const tone = s => s === 'warn' ? 'warn' : s === 'lock' ? 'lock' : s === 'bad' ? 'bad' : s === 'ok' ? 'ok' : 'neutral';
  const toneColor = s => s === 'warn' ? 'var(--warn)' : s === 'lock' ? 'var(--lock)' : s === 'bad' ? 'var(--bad)' : s === 'ok' ? 'var(--ok)' : 'var(--text-mid)';
  const toneBg = s => s === 'warn' ? 'var(--warn-bg)' : s === 'lock' ? 'var(--lock-bg)' : s === 'bad' ? 'var(--bad-bg)' : s === 'ok' ? 'var(--ok-bg)' : 'var(--surface-2)';

  return (
    <div className="gr">
      <GrShellNav active="alerts" breadcrumb={['Alerts']}>
        <div style={{ height: '100%', overflow: 'auto' }}>
          <section style={{ padding: '32px 36px 22px' }}>
            <div className="gr-row gr-between">
              <div className="gr-col gr-g-2">
                <span className="gr-label">2 unread</span>
                <h1 className="gr-h1" style={{ fontSize: 28 }}>Alerts</h1>
                <p className="gr-body">Everything Guardrail noticed about your trading plan and broker connections.</p>
              </div>
              <div className="gr-row gr-g-2">
                <button className="gr-btn gr-btn--sm"><GIcon name="check" size="sm" /> Mark all read</button>
                <button className="gr-btn gr-btn--sm"><GIcon name="settings" size="sm" /> Notification settings</button>
              </div>
            </div>

            <div className="gr-row gr-g-2" style={{ marginTop: 22 }}>
              <span className="gr-chip gr-chip--active">All 6</span>
              <span className="gr-chip">Rule alerts 3</span>
              <span className="gr-chip">System 2</span>
              <span className="gr-chip">Broker 1</span>
              <span className="gr-chip" style={{ marginLeft: 'auto', display: 'inline-flex' }}>Today only</span>
            </div>
          </section>

          <section style={{ padding: '6px 36px 36px' }}>
            <div className="gr-card" style={{ padding: 0, overflow: 'hidden' }}>
              {alerts.map((a, i, arr) => (
                <div key={i} className="gr-row gr-g-3" style={{
                  padding: '16px 22px',
                  borderBottom: i < arr.length - 1 ? '1px solid var(--border-sub)' : 'none',
                  background: a.read ? 'transparent' : 'var(--bg-elev)',
                  alignItems: 'flex-start',
                  position: 'relative',
                }}>
                  {!a.read && <div style={{ position: 'absolute', left: 8, top: 22, width: 6, height: 6, borderRadius: 999, background: 'var(--copper)' }} />}
                  <div style={{
                    width: 36, height: 36, borderRadius: 9,
                    background: toneBg(a.sev),
                    color: toneColor(a.sev),
                    border: `1px solid ${a.sev === 'info' ? 'var(--border)' : `var(--${tone(a.sev)}-bd)`}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto',
                  }}>
                    <GIcon name={a.ic} />
                  </div>
                  <div className="gr-col gr-g-1 gr-grow">
                    <div className="gr-row gr-between">
                      <span className="gr-h3">{a.t}</span>
                      <span className="gr-tiny gr-mono">{a.time}</span>
                    </div>
                    <span className="gr-small">{a.sub}</span>
                  </div>
                  <button className="gr-btn gr-btn--ghost gr-btn--sm">View <GIcon name="arrowR" size="sm" /></button>
                </div>
              ))}
            </div>
          </section>
        </div>
      </GrShellNav>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// SETTINGS
// ─────────────────────────────────────────────────────────────────
const GrSettings = () => {
  return (
    <div className="gr">
      <GrShellNav active="settings" breadcrumb={['Settings', 'Profile & billing']}>
        <div className="gr-row" style={{ height: '100%', alignItems: 'stretch' }}>
          {/* Settings nav */}
          <div style={{ width: 240, flex: '0 0 240px', borderRight: '1px solid var(--border)', background: 'var(--bg-elev)', padding: '24px 14px' }}>
            <span className="gr-label" style={{ padding: '0 10px 10px', display: 'block' }}>Settings</span>
            <div className="gr-col" style={{ gap: 2 }}>
              {[
                { id: 'profile', l: 'Profile', i: 'user', active: true },
                { id: 'notifs',  l: 'Notifications', i: 'bell' },
                { id: 'plan',    l: 'Default plan', i: 'shield' },
                { id: 'billing', l: 'Billing & plan', i: 'coin' },
                { id: 'team',    l: 'Team & access', i: 'user' },
                { id: 'api',     l: 'API & integrations', i: 'plug' },
                { id: 'security',l: 'Security', i: 'lock' },
              ].map(n => (
                <div key={n.id} className={`gr-nav-item ${n.active ? 'gr-nav-item--active' : ''}`} style={{ fontSize: 13 }}>
                  <GIcon name={n.i} />
                  <span>{n.l}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="gr-grow" style={{ overflow: 'auto' }}>
            <section style={{ padding: '32px 36px 22px', maxWidth: 800 }}>
              <span className="gr-label">Profile</span>
              <h1 className="gr-h1" style={{ fontSize: 28, marginTop: 8 }}>Andrew Naftalovich</h1>
              <p className="gr-body" style={{ marginTop: 6 }}>This is what teammates and Guardrail support will see.</p>

              {/* Profile card */}
              <div className="gr-card" style={{ padding: 24, marginTop: 24 }}>
                <div className="gr-row gr-g-4" style={{ alignItems: 'flex-start' }}>
                  <div className="gr-avatar" style={{ width: 64, height: 64, fontSize: 22, background: 'var(--copper)', color: 'white' }}>AN</div>
                  <div className="gr-col gr-g-2 gr-grow">
                    <div className="gr-row gr-g-3" style={{ flexWrap: 'wrap' }}>
                      <label className="gr-col gr-g-2" style={{ flex: 1, minWidth: 200 }}>
                        <span className="gr-label">Display name</span>
                        <input className="gr-input" defaultValue="Andrew Naftalovich" />
                      </label>
                      <label className="gr-col gr-g-2" style={{ flex: 1, minWidth: 200 }}>
                        <span className="gr-label">Timezone</span>
                        <input className="gr-input" defaultValue="America/New York (ET)" />
                      </label>
                    </div>
                    <label className="gr-col gr-g-2">
                      <span className="gr-label">Email</span>
                      <input className="gr-input" defaultValue="andrew@guardrail.io" />
                    </label>
                    <button className="gr-btn gr-btn--ghost gr-btn--sm" style={{ alignSelf: 'flex-start', color: 'var(--copper)' }}>
                      <GIcon name="edit" size="sm" /> Change avatar
                    </button>
                  </div>
                </div>
              </div>

              {/* Subscription card */}
              <div className="gr-card" style={{ padding: 24, marginTop: 16 }}>
                <div className="gr-row gr-between" style={{ marginBottom: 18 }}>
                  <div className="gr-col gr-g-1">
                    <span className="gr-h2">Subscription</span>
                    <span className="gr-tiny">Renews June 18, 2026</span>
                  </div>
                  <span className="gr-badge gr-badge--copper" style={{ fontSize: 11.5 }}>Pro · monthly</span>
                </div>
                <div className="gr-row gr-g-3" style={{ marginBottom: 18 }}>
                  <div className="gr-card-soft" style={{ padding: 14, flex: 1 }}>
                    <span className="gr-tiny">Connected accounts</span>
                    <div className="gr-mono gr-num" style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>4 / 10</div>
                  </div>
                  <div className="gr-card-soft" style={{ padding: 14, flex: 1 }}>
                    <span className="gr-tiny">Active rules</span>
                    <div className="gr-mono gr-num" style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>8 / unlimited</div>
                  </div>
                  <div className="gr-card-soft" style={{ padding: 14, flex: 1 }}>
                    <span className="gr-tiny">Members</span>
                    <div className="gr-mono gr-num" style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>1 / 3</div>
                  </div>
                </div>
                <div className="gr-row gr-g-2">
                  <button className="gr-btn">Manage billing</button>
                  <button className="gr-btn gr-btn--ghost" style={{ color: 'var(--copper)' }}>Upgrade plan <GIcon name="arrowR" size="sm" /></button>
                </div>
              </div>

              {/* Danger zone */}
              <div className="gr-card" style={{ padding: 24, marginTop: 16, borderColor: 'var(--bad-bd)' }}>
                <div className="gr-row gr-between">
                  <div className="gr-col gr-g-1">
                    <span className="gr-h3" style={{ color: 'var(--bad)' }}>Delete account</span>
                    <span className="gr-tiny">Permanently delete your Guardrail account and all account data.</span>
                  </div>
                  <button className="gr-btn" style={{ color: 'var(--bad)', borderColor: 'var(--bad-bd)' }}>Delete account</button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </GrShellNav>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// ONBOARDING · Connect broker
// ─────────────────────────────────────────────────────────────────
const GrOnboarding = () => {
  return (
    <div className="gr" style={{ background: 'var(--bg)' }}>
      {/* Minimal top bar */}
      <header className="gr-row gr-between" style={{
        height: 64, padding: '0 36px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg)',
      }}>
        <div className="gr-row gr-g-3" style={{ alignItems: 'center' }}>
          <GrLogo size={28} />
          <span style={{ fontSize: 15.5, fontWeight: 600, color: 'var(--ink)' }}>Guardrail</span>
        </div>
        <div className="gr-row gr-g-3 gr-tiny">
          <span>Step 1 of 3</span>
          <span>·</span>
          <span style={{ color: 'var(--copper)' }}>Skip for now</span>
        </div>
      </header>

      <div style={{ maxWidth: 760, margin: '0 auto', padding: '56px 32px 64px', height: 'calc(100% - 64px)', overflow: 'auto' }}>
        {/* Hero */}
        <div className="gr-col gr-g-2" style={{ marginBottom: 36, textAlign: 'center' }}>
          <span className="gr-label" style={{ margin: '0 auto' }}>Welcome to Guardrail</span>
          <h1 className="gr-display" style={{ fontSize: 44 }}>Connect <span className="gr-uline" style={{ fontStyle: 'italic' }}>your first broker</span>.</h1>
          <p className="gr-body" style={{ maxWidth: 520, margin: '6px auto 0' }}>
            Guardrail watches your account in real time and steps in when your plan says so. We start with read-only access — you can grant trading permissions later.
          </p>
        </div>

        {/* Broker grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          {[
            { n: 'Tradovate', s: 'Direct API · live & demo', tag: 'Recommended', live: true },
            { n: 'Apex Trader Funding', s: 'Eval, PA, Live funded', tag: null, live: true },
            { n: 'TopStep', s: 'Combine & Express', tag: null, live: true },
            { n: 'NinjaTrader', s: 'NT8 connector', tag: 'Beta', live: false },
            { n: 'AMP Futures', s: 'Coming soon', tag: 'Planned', live: false },
            { n: 'Other broker', s: 'CSV import · manual sync', tag: null, live: false },
          ].map((b, i) => (
            <button key={b.n} style={{
              padding: 20,
              background: i === 0 ? 'var(--surface)' : 'var(--surface)',
              border: i === 0 ? '1px solid var(--copper-bd)' : '1px solid var(--border)',
              boxShadow: i === 0 ? '0 0 0 4px var(--copper-bg)' : 'none',
              borderRadius: 14,
              textAlign: 'left',
              cursor: 'pointer',
              font: 'inherit',
              display: 'flex', flexDirection: 'column', gap: 10,
              minHeight: 138,
              opacity: !b.live ? 0.7 : 1,
            }}>
              <div className="gr-row gr-between" style={{ width: '100%' }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 9,
                  background: i === 0 ? 'var(--copper-bg)' : 'var(--surface-2)',
                  color: i === 0 ? 'var(--copper)' : 'var(--text-mid)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 600,
                }}>{b.n.split(' ').map(w => w[0]).slice(0, 2).join('')}</div>
                {b.tag === 'Recommended' && <span className="gr-badge gr-badge--copper">Recommended</span>}
                {b.tag === 'Beta' && <span className="gr-badge gr-badge--neutral">Beta</span>}
                {b.tag === 'Planned' && <EnforcementChip type="planned" />}
              </div>
              <div className="gr-col gr-g-1 gr-grow">
                <span className="gr-h2">{b.n}</span>
                <span className="gr-tiny">{b.s}</span>
              </div>
              {b.live && (
                <span className="gr-row gr-g-2 gr-tiny" style={{ color: 'var(--copper)' }}>
                  <span>Connect</span><GIcon name="arrowR" size="sm" />
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Footer reassurance */}
        <div className="gr-card-flat" style={{ padding: 18, marginTop: 28, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--ok-bg)', color: 'var(--ok)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
            <GIcon name="shield" />
          </div>
          <div className="gr-col gr-g-1">
            <span className="gr-h3">Read-only by default</span>
            <span className="gr-small">Initial connection only reads positions and orders. To enable app-layer locks or future broker actions, you'll explicitly grant trading permissions.</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// SIGN IN
// ─────────────────────────────────────────────────────────────────
const GrSignIn = () => {
  return (
    <div className="gr" style={{ display: 'flex', alignItems: 'stretch' }}>
      {/* Left · form */}
      <div style={{ width: '52%', display: 'flex', flexDirection: 'column', padding: '36px 56px' }}>
        <div className="gr-row gr-g-3" style={{ alignItems: 'center' }}>
          <GrLogo size={32} />
          <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>Guardrail</span>
        </div>

        <div className="gr-col" style={{ flex: 1, justifyContent: 'center', maxWidth: 400, width: '100%', alignSelf: 'center' }}>
          <span className="gr-label">Welcome back</span>
          <h1 className="gr-display" style={{ fontSize: 40, marginTop: 8 }}>
            Trade your <span className="gr-uline" style={{ fontStyle: 'italic' }}>plan</span>, not your impulse.
          </h1>
          <p className="gr-body" style={{ marginTop: 12, marginBottom: 32 }}>Sign in to your Guardrail account.</p>

          <div className="gr-col gr-g-3">
            <label className="gr-col gr-g-2">
              <span className="gr-label">Email</span>
              <input className="gr-input" type="email" defaultValue="andrew@guardrail.io" />
            </label>
            <label className="gr-col gr-g-2">
              <div className="gr-row gr-between">
                <span className="gr-label">Password</span>
                <span className="gr-tiny" style={{ color: 'var(--copper)' }}>Forgot?</span>
              </div>
              <input className="gr-input" type="password" defaultValue="••••••••••••" />
            </label>
            <button className="gr-btn gr-btn--primary" style={{ padding: '11px 14px', marginTop: 8, fontSize: 14 }}>
              Sign in <GIcon name="arrowR" size="sm" />
            </button>

            <div className="gr-row gr-g-3" style={{ margin: '14px 0' }}>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <span className="gr-tiny">or</span>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>

            <button className="gr-btn"><span style={{ fontWeight: 600 }}>G</span> Continue with Google</button>
            <button className="gr-btn">Continue with TradingView</button>
          </div>

          <p className="gr-tiny" style={{ marginTop: 32, textAlign: 'center' }}>
            Don't have an account? <span style={{ color: 'var(--copper)', fontWeight: 500 }}>Sign up</span>
          </p>
        </div>

        <div className="gr-row gr-between gr-tiny" style={{ marginTop: 'auto' }}>
          <span>© 2026 Guardrail</span>
          <span className="gr-row gr-g-3">
            <span>Privacy</span><span>Terms</span><span>Status · all systems live</span>
          </span>
        </div>
      </div>

      {/* Right · marketing panel */}
      <div style={{
        width: '48%',
        background: 'var(--ink)',
        color: 'var(--bg)',
        padding: '56px 56px',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse 60% 40% at 80% 20%, ${GR.copper}33, transparent 60%)` }} />

        <div className="gr-row gr-between" style={{ position: 'relative' }}>
          <span className="gr-label" style={{ color: 'rgba(255,255,255,0.5)' }}>Today · live</span>
          <span className="gr-badge gr-badge--ok" style={{ background: 'rgba(63,124,42,0.25)', borderColor: 'rgba(63,124,42,0.55)' }}><span className="gr-dot gr-dot--pulse" />4 accounts watched</span>
        </div>

        <div style={{ position: 'relative' }}>
          <h2 className="gr-serif" style={{ fontSize: 36, lineHeight: 1.15, fontWeight: 400, letterSpacing: '-0.02em', color: 'var(--bg)', margin: 0 }}>
            "It's the only thing standing between me and a blown eval. Once you wire it up, you stop thinking about your daily loss."
          </h2>
          <div className="gr-row gr-g-3" style={{ marginTop: 24 }}>
            <div className="gr-avatar" style={{ background: 'rgba(255,255,255,0.12)', color: 'var(--bg)', fontWeight: 500 }}>JR</div>
            <div className="gr-col gr-g-1">
              <span style={{ fontSize: 14, fontWeight: 500 }}>James Reeve</span>
              <span className="gr-tiny" style={{ color: 'rgba(255,255,255,0.55)' }}>Funded · Apex $150K</span>
            </div>
          </div>
        </div>

        {/* Mini KPIs */}
        <div className="gr-row gr-g-3" style={{ position: 'relative' }}>
          {[
            { l: 'Avg breach prevented', v: '3.2 / wk' },
            { l: 'Active traders', v: '1,840' },
            { l: 'Avg setup time', v: '4 min' },
          ].map(k => (
            <div key={k.l} style={{ flex: 1, padding: 14, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 }}>
              <span className="gr-tiny" style={{ color: 'rgba(255,255,255,0.5)' }}>{k.l}</span>
              <div className="gr-mono gr-num" style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{k.v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { GrDashboard, GrTrades, GrAccounts, GrAlerts, GrSettings, GrOnboarding, GrSignIn });
