// Hi-fi Trading Rules — three polished variations of the same product.
// All share the SAME app shell so they read as one product.

// ── App shell: top bar + side nav (used by all variations) ──────────
const Shell = ({ children, active = 'rules', breadcrumb }) => (
  <div className="hi-row" style={{ height: '100%', alignItems: 'stretch' }}>
    {/* Side nav */}
    <aside style={{
      width: 220, flex: '0 0 220px',
      borderRight: '1px solid var(--border)',
      background: 'var(--bg-elev)',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: '18px 16px', borderBottom: '1px solid var(--border)' }}>
        <div className="hi-row hi-g-2" style={{ alignItems: 'center' }}>
          <div style={{
            width: 24, height: 24, borderRadius: 7,
            background: 'var(--text)', color: 'var(--bg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 13, letterSpacing: '-0.04em',
          }}>G</div>
          <div className="hi-col">
            <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em' }}>Guardrail</span>
            <span className="hi-tiny">Eval $50K · live</span>
          </div>
        </div>
      </div>

      <nav className="hi-col" style={{ padding: 10, gap: 2 }}>
        {[
          { id: 'home', label: 'Overview', icon: 'home' },
          { id: 'rules', label: 'Trading Rules', icon: 'shield' },
          { id: 'trades', label: 'Trades', icon: 'chart' },
          { id: 'accounts', label: 'Accounts', icon: 'user' },
          { id: 'alerts', label: 'Alerts', icon: 'bell' },
          { id: 'settings', label: 'Settings', icon: 'settings' },
        ].map(n => (
          <div key={n.id} className={`hi-nav-item ${n.id === active ? 'hi-nav-item--active' : ''}`}>
            <Icon name={n.icon} />
            <span>{n.label}</span>
            {n.id === 'alerts' && <span className="hi-badge hi-badge--warn" style={{ marginLeft: 'auto', padding: '1px 6px' }}>2</span>}
          </div>
        ))}
      </nav>

      <div className="hi-grow" />

      <div style={{ padding: 14, borderTop: '1px solid var(--border)' }}>
        <div className="hi-card-flat" style={{ background: 'var(--surface-2)', padding: 12 }}>
          <div className="hi-row hi-between" style={{ marginBottom: 8 }}>
            <span className="hi-tiny">Tradovate</span>
            <span className="hi-badge hi-badge--ok"><span className="hi-dot hi-dot--pulse" />connected</span>
          </div>
          <div className="hi-tiny hi-mono" style={{ color: 'var(--text-mid)' }}>ping 42ms · last sync 3s</div>
        </div>
      </div>
    </aside>

    {/* Main */}
    <main className="hi-col hi-grow" style={{ minWidth: 0 }}>
      {/* Top bar */}
      <header className="hi-row" style={{
        height: 52, padding: '0 24px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg)', alignItems: 'center', gap: 16,
      }}>
        <div className="hi-row hi-g-2" style={{ color: 'var(--text-mute)', fontSize: 13 }}>
          {breadcrumb.map((b, i) => (
            <React.Fragment key={i}>
              {i > 0 && <Icon name="chevR" size="sm" style={{ opacity: 0.5 }} />}
              <span style={{ color: i === breadcrumb.length - 1 ? 'var(--text)' : 'var(--text-mute)', fontWeight: i === breadcrumb.length - 1 ? 500 : 400 }}>{b}</span>
            </React.Fragment>
          ))}
        </div>
        <div className="hi-grow" />
        <div className="hi-row hi-g-2" style={{ color: 'var(--text-mute)' }}>
          <div className="hi-row hi-g-2" style={{ padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface)', fontSize: 12, alignItems: 'center' }}>
            <Icon name="search" size="sm" />
            <span>Quick action…</span>
            <span className="hi-kbd" style={{ marginLeft: 24 }}>⌘K</span>
          </div>
          <button className="hi-btn hi-btn--ghost hi-btn--icon"><Icon name="bell" /></button>
          <div style={{ width: 28, height: 28, borderRadius: 999, background: 'var(--surface-hi)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600 }}>AN</div>
        </div>
      </header>

      <div className="hi-grow" style={{ overflow: 'hidden', position: 'relative' }}>
        {children}
      </div>
    </main>
  </div>
);

// ─────────────────────────────────────────────────────────────────
// V1 · Split view — sidebar of rules + focused editor
// ─────────────────────────────────────────────────────────────────
const HV1Split = () => {
  const sel = 'daily-loss';
  const r = RULES.find(x => x.id === sel);

  return (
    <Shell breadcrumb={['Eval $50K', 'Trading Rules', 'Daily Loss Limit']}>
      <div className="hi-row" style={{ height: '100%', alignItems: 'stretch' }}>
        {/* Rules list */}
        <div style={{ width: 320, flex: '0 0 320px', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '18px 18px 14px' }}>
            <div className="hi-row hi-between" style={{ marginBottom: 14 }}>
              <h2 className="hi-h1">Rules</h2>
              <button className="hi-btn hi-btn--sm hi-btn--ghost"><Icon name="plus" size="sm" /> New</button>
            </div>
            <div className="hi-input-affix" style={{ background: 'var(--surface-2)' }}>
              <span className="hi-affix" style={{ background: 'transparent', borderRight: 'none', paddingRight: 4 }}><Icon name="search" size="sm" /></span>
              <input className="hi-input" placeholder="Filter rules…" style={{ padding: '7px 10px 7px 4px', fontSize: 13 }} />
            </div>
          </div>

          <div className="hi-col" style={{ overflow: 'auto', padding: '0 10px 16px' }}>
            {['Risk', 'Position', 'Goals', 'Schedule'].map(grp => (
              <div key={grp} style={{ marginBottom: 14 }}>
                <div className="hi-row hi-between" style={{ padding: '6px 10px 4px' }}>
                  <span className="hi-label">{grp}</span>
                  <span className="hi-tiny hi-mono">{RULES.filter(x => x.group === grp).length}</span>
                </div>
                <div className="hi-col" style={{ gap: 1 }}>
                  {RULES.filter(x => x.group === grp).map(rr => {
                    const isSel = rr.id === sel;
                    return (
                      <div key={rr.id} style={{
                        padding: '10px 10px',
                        background: isSel ? 'var(--surface-hi)' : 'transparent',
                        borderRadius: 7,
                        cursor: 'pointer',
                        position: 'relative',
                      }}>
                        <div className="hi-row hi-g-3" style={{ alignItems: 'center' }}>
                          <span className="hi-dot hi-dot-lg" style={{
                            color: rr.status === 'ok' ? 'var(--ok)' : rr.status === 'warn' ? 'var(--warn)' : 'var(--bad)',
                          }} />
                          <div className="hi-col hi-grow" style={{ gap: 2, minWidth: 0 }}>
                            <span style={{ fontSize: 13, fontWeight: isSel ? 500 : 400, color: rr.on ? 'var(--text)' : 'var(--text-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rr.name}</span>
                            <span className="hi-mono hi-tiny" style={{ color: 'var(--text-mute)' }}>{rr.unit === '$' ? '$' + rr.val.toLocaleString() : `${rr.val}${rr.unit}`}</span>
                          </div>
                          {!rr.on && <Icon name="lock" size="sm" style={{ color: 'var(--text-faint)' }} />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Detail editor */}
        <div className="hi-grow hi-col" style={{ overflow: 'auto', minWidth: 0 }}>
          {/* Sticky header */}
          <div style={{ padding: '22px 32px', borderBottom: '1px solid var(--border)' }}>
            <div className="hi-row hi-between" style={{ alignItems: 'flex-start' }}>
              <div className="hi-col hi-g-2" style={{ maxWidth: 540 }}>
                <div className="hi-row hi-g-2">
                  <span className="hi-badge hi-badge--warn"><span className="hi-dot" />Near limit · 70%</span>
                  <span className="hi-badge hi-badge--neutral">Group · Risk</span>
                  <span className="hi-badge hi-badge--neutral">Required by Topstep</span>
                </div>
                <h1 className="hi-display" style={{ marginTop: 4 }}>{r.name}</h1>
                <p className="hi-body">{r.desc} Resets every trading day at the configured time and triggers configured actions when breached.</p>
              </div>
              <div className="hi-row hi-g-2">
                <button className="hi-btn hi-btn--sm"><Icon name="copy" size="sm" /> Duplicate</button>
                <button className="hi-btn hi-btn--sm"><Icon name="clock" size="sm" /> History</button>
                <div className="hi-vdiv" style={{ height: 24, margin: '0 4px' }} />
                <div className="hi-row hi-g-2" style={{ alignItems: 'center' }}>
                  <span className="hi-tiny">Enabled</span>
                  <div className="hi-switch hi-switch--on" />
                </div>
              </div>
            </div>
          </div>

          {/* Body */}
          <div style={{ padding: 32, display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 24 }}>
            {/* Left column */}
            <div className="hi-col hi-g-4">
              {/* Threshold card */}
              <section className="hi-card" style={{ padding: 22 }}>
                <div className="hi-row hi-between" style={{ marginBottom: 18 }}>
                  <div className="hi-col hi-g-1">
                    <h2 className="hi-h1">Threshold</h2>
                    <p className="hi-tiny">How much you can lose in a day before Guardrail intervenes.</p>
                  </div>
                  <div className="hi-seg">
                    <button className="hi-seg--active">Amount</button>
                    <button>% of balance</button>
                    <button>Multiple</button>
                  </div>
                </div>

                <div className="hi-row hi-g-3" style={{ alignItems: 'flex-end' }}>
                  <div className="hi-col hi-g-2" style={{ flex: 1 }}>
                    <label className="hi-label">Daily loss limit</label>
                    <div className="hi-input-affix">
                      <span className="hi-affix">USD</span>
                      <input className="hi-input hi-mono hi-num" defaultValue="1,200.00" style={{ fontSize: 22, fontWeight: 600, padding: '10px 14px' }} />
                    </div>
                  </div>
                  <div className="hi-col hi-g-2" style={{ width: 200 }}>
                    <label className="hi-label">Reset at</label>
                    <div className="hi-input-affix">
                      <input className="hi-input hi-mono" defaultValue="17:00" style={{ padding: '10px 14px' }} />
                      <span className="hi-affix hi-affix--right">ET</span>
                    </div>
                  </div>
                </div>

                {/* Slider with markers */}
                <div style={{ marginTop: 22 }}>
                  <div className="hi-row hi-between" style={{ marginBottom: 8 }}>
                    <span className="hi-tiny">2.4% of $50,000 balance</span>
                    <span className="hi-tiny">Topstep cap: $1,250</span>
                  </div>
                  <div style={{ position: 'relative', height: 6, background: 'var(--surface-hi)', borderRadius: 3 }}>
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '24%', background: 'var(--text)', borderRadius: 3 }} />
                    <div style={{ position: 'absolute', left: '24%', top: -5, width: 14, height: 16, transform: 'translateX(-7px)', background: 'var(--text)', borderRadius: 4, border: '2px solid var(--bg)' }} />
                    <div style={{ position: 'absolute', left: '25%', top: -3, bottom: -3, width: 2, background: 'var(--bad)' }} />
                  </div>
                  <div className="hi-row hi-between hi-tiny hi-mono" style={{ marginTop: 10 }}>
                    <span>$0</span><span>$1,250</span><span>$2,500</span><span>$5,000</span>
                  </div>
                </div>

                {/* Warn threshold */}
                <div style={{ marginTop: 22, paddingTop: 22, borderTop: '1px solid var(--border)' }}>
                  <div className="hi-row hi-between" style={{ marginBottom: 12 }}>
                    <div className="hi-col hi-g-1">
                      <span className="hi-h2">Warning threshold</span>
                      <span className="hi-tiny">Notify you and require confirmation for new orders at this point.</span>
                    </div>
                    <span className="hi-mono" style={{ fontSize: 18, fontWeight: 600 }}>80%</span>
                  </div>
                  <div style={{ position: 'relative', height: 6, background: 'var(--surface-hi)', borderRadius: 3 }}>
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '80%', background: 'var(--warn)', borderRadius: 3 }} />
                    <div style={{ position: 'absolute', left: '80%', top: -5, width: 14, height: 16, transform: 'translateX(-7px)', background: 'var(--warn)', borderRadius: 4, border: '2px solid var(--bg)' }} />
                  </div>
                </div>
              </section>

              {/* Triggers card */}
              <section className="hi-card" style={{ padding: 22 }}>
                <div className="hi-col hi-g-1" style={{ marginBottom: 16 }}>
                  <h2 className="hi-h1">When triggered</h2>
                  <p className="hi-tiny">Actions Guardrail performs the moment your loss reaches the threshold. Runs in order.</p>
                </div>
                <div className="hi-col" style={{ gap: 0 }}>
                  {[
                    { ic: 'x',     t: 'Close all open positions',           sub: 'Market orders to flatten · ~120ms',     on: true },
                    { ic: 'x',     t: 'Cancel pending orders',              sub: 'Working & GTC orders across all symbols', on: true },
                    { ic: 'lock',  t: 'Lock account until reset',           sub: 'Reject new orders until 17:00 ET',      on: true },
                    { ic: 'bell',  t: 'Notify by email + push',             sub: 'Sent to andrew@…, 2 devices',           on: true },
                    { ic: 'bolt',  t: 'Send Discord webhook',               sub: '#trades · message template',            on: false },
                  ].map((row, i, arr) => (
                    <div key={row.t} className="hi-row" style={{ padding: '12px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--border-sub)' : 'none', gap: 14, alignItems: 'center' }}>
                      <div style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-mid)' }}>
                        <Icon name={row.ic} size="sm" />
                      </div>
                      <div className="hi-col hi-grow" style={{ gap: 2 }}>
                        <span style={{ fontSize: 13, fontWeight: 500 }}>{row.t}</span>
                        <span className="hi-tiny">{row.sub}</span>
                      </div>
                      <button className="hi-btn hi-btn--ghost hi-btn--sm"><Icon name="settings" size="sm" /></button>
                      <div className={`hi-switch ${row.on ? 'hi-switch--on' : ''}`} />
                    </div>
                  ))}
                </div>
                <button className="hi-btn hi-btn--ghost hi-btn--sm" style={{ marginTop: 14 }}>
                  <Icon name="plus" size="sm" /> Add action
                </button>
              </section>
            </div>

            {/* Right column */}
            <div className="hi-col hi-g-4">
              {/* Live status */}
              <section className="hi-card" style={{ padding: 20 }}>
                <div className="hi-row hi-between" style={{ marginBottom: 14 }}>
                  <span className="hi-label">Right now</span>
                  <span className="hi-badge hi-badge--warn"><span className="hi-dot hi-dot--pulse" />Approaching limit</span>
                </div>
                <div className="hi-row" style={{ alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                  <span className="hi-mono hi-num" style={{ fontSize: 32, fontWeight: 600, color: 'var(--warn)' }}>−$840</span>
                  <span className="hi-mono hi-tiny" style={{ color: 'var(--text-mute)' }}>/ $1,200</span>
                </div>
                <div className="hi-tiny" style={{ marginBottom: 14 }}>$360 remaining · resets in 4h 12m</div>
                <div className="hi-bar hi-bar--warn hi-bar--thick"><i style={{ width: '70%' }} /></div>

                <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                  <div className="hi-row hi-between" style={{ marginBottom: 10 }}>
                    <span className="hi-tiny">P&L · last 12 trades</span>
                    <span className="hi-tiny hi-mono">3W · 9L</span>
                  </div>
                  <div className="hi-spark" style={{ height: 36 }}>
                    {[8, 6, -4, 7, -3, -6, 5, -8, -5, 9, -11, -3].map((v, i) => (
                      <i key={i} className={v >= 0 ? 'hi-spark--pos' : 'hi-spark--neg'} style={{ height: Math.abs(v) * 2.5 + 4 + 'px' }} />
                    ))}
                  </div>
                </div>
              </section>

              {/* Schedule preview */}
              <section className="hi-card" style={{ padding: 20 }}>
                <div className="hi-row hi-between" style={{ marginBottom: 12 }}>
                  <span className="hi-label">Recent triggers</span>
                  <button className="hi-btn hi-btn--ghost hi-btn--sm">View all</button>
                </div>
                <div className="hi-col" style={{ gap: 0 }}>
                  {[
                    { d: 'Mon · May 19', pnl: '−$1,200', note: 'auto-flattened 3 positions' },
                    { d: 'Tue · May 13', pnl: '−$1,200', note: 'auto-flattened 1 position' },
                    { d: 'Thu · May 8',  pnl: '−$980',   note: 'warning at 80%, no breach' },
                  ].map((h, i, arr) => (
                    <div key={i} className="hi-row hi-between" style={{ padding: '10px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--border-sub)' : 'none' }}>
                      <div className="hi-col" style={{ gap: 2 }}>
                        <span style={{ fontSize: 13 }}>{h.d}</span>
                        <span className="hi-tiny">{h.note}</span>
                      </div>
                      <span className="hi-mono hi-num" style={{ fontSize: 13, color: 'var(--warn)' }}>{h.pnl}</span>
                    </div>
                  ))}
                </div>
              </section>

              {/* Apply to other accounts */}
              <section className="hi-card" style={{ padding: 20 }}>
                <div className="hi-col hi-g-1" style={{ marginBottom: 12 }}>
                  <span className="hi-h2">Apply to other accounts</span>
                  <span className="hi-tiny">Copy this rule's config to one or more connected accounts.</span>
                </div>
                <div className="hi-col" style={{ gap: 6 }}>
                  {ACCOUNTS.slice(1).map(a => (
                    <label key={a.id} className="hi-row hi-between" style={{ padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border)', cursor: 'pointer' }}>
                      <span className="hi-row hi-g-2">
                        <span style={{ width: 14, height: 14, borderRadius: 4, border: '1.5px solid var(--border-hi)', background: 'var(--surface-2)' }} />
                        <span style={{ fontSize: 13 }}>{a.label}</span>
                      </span>
                      <span className="hi-mono hi-tiny">{a.tv}</span>
                    </label>
                  ))}
                </div>
                <button className="hi-btn hi-btn--sm" style={{ marginTop: 12, width: '100%' }}>Copy to selected</button>
              </section>
            </div>
          </div>

          {/* Footer save bar */}
          <div style={{
            position: 'sticky', bottom: 0,
            padding: '14px 32px',
            background: 'rgba(10,11,14,0.85)', backdropFilter: 'blur(8px)',
            borderTop: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span className="hi-tiny" style={{ color: 'var(--warn)' }}>● 3 unsaved changes</span>
            <div className="hi-row hi-g-2">
              <button className="hi-btn hi-btn--ghost">Discard</button>
              <button className="hi-btn hi-btn--primary">Save changes</button>
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
};

// ─────────────────────────────────────────────────────────────────
// V2 · Dashboard cards — status-forward, all rules visible
// ─────────────────────────────────────────────────────────────────
const HV2Cards = () => {
  return (
    <Shell breadcrumb={['Eval $50K', 'Trading Rules']}>
      <div style={{ padding: '24px 32px', height: '100%', overflow: 'auto' }}>
        {/* Page header */}
        <div className="hi-row hi-between" style={{ marginBottom: 8, alignItems: 'flex-start' }}>
          <div className="hi-col hi-g-2">
            <h1 className="hi-display">Trading Rules</h1>
            <p className="hi-body" style={{ maxWidth: 540 }}>Configured guardrails that Guardrail enforces on your Tradovate accounts in real time.</p>
          </div>
          <div className="hi-row hi-g-2">
            <button className="hi-btn"><Icon name="refresh" size="sm" /> Sync with broker</button>
            <button className="hi-btn"><Icon name="copy" size="sm" /> Copy from preset</button>
            <button className="hi-btn hi-btn--primary"><Icon name="plus" size="sm" /> New rule</button>
          </div>
        </div>

        {/* Account tabs */}
        <div className="hi-row" style={{ borderBottom: '1px solid var(--border)', gap: 28, marginTop: 22 }}>
          {ACCOUNTS.map((a, i) => (
            <button key={a.id} className={`hi-tab ${i === 0 ? 'hi-tab--active' : ''}`}>
              <span className="hi-row hi-g-2" style={{ alignItems: 'center' }}>
                <span className="hi-dot" style={{ color: a.status === 'warn' ? 'var(--warn)' : a.status === 'idle' ? 'var(--text-faint)' : 'var(--ok)' }} />
                <span>{a.label}</span>
                <span className="hi-mono hi-tiny" style={{ color: 'var(--text-mute)', fontWeight: 400 }}>{a.tv}</span>
              </span>
            </button>
          ))}
        </div>

        {/* Summary strip */}
        <div className="hi-row hi-g-3" style={{ marginTop: 22, marginBottom: 22 }}>
          {[
            { label: 'Account balance', val: '$49,160', sub: '−$840 today', tone: 'warn' },
            { label: 'Rules active',     val: '8 of 9',  sub: '1 disabled', tone: 'neutral' },
            { label: 'Compliance',       val: '94%',     sub: '1 near limit', tone: 'warn' },
            { label: 'Next reset',       val: '17:00 ET', sub: 'in 4h 12m',  tone: 'neutral' },
          ].map(k => (
            <div key={k.label} className="hi-card" style={{ padding: 16, flex: 1 }}>
              <span className="hi-label">{k.label}</span>
              <div className="hi-row hi-g-2" style={{ alignItems: 'baseline', marginTop: 6 }}>
                <span className="hi-mono hi-num" style={{ fontSize: 22, fontWeight: 600 }}>{k.val}</span>
                <span className="hi-tiny" style={{ color: k.tone === 'warn' ? 'var(--warn)' : 'var(--text-mute)' }}>{k.sub}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="hi-row hi-between" style={{ marginBottom: 14 }}>
          <div className="hi-row hi-g-2">
            {['All 9', 'Risk 3', 'Position 2', 'Goals 2', 'Schedule 2'].map((t, i) => (
              <span key={t} className={`hi-chip ${i === 0 ? 'hi-chip--active' : ''}`}>{t}</span>
            ))}
          </div>
          <div className="hi-row hi-g-2">
            <div className="hi-seg">
              <button className="hi-seg--active"><Icon name="grid" size="sm" /></button>
              <button><Icon name="list" size="sm" /></button>
              <button><Icon name="table" size="sm" /></button>
            </div>
            <button className="hi-btn hi-btn--sm"><Icon name="filter" size="sm" /> Filter</button>
          </div>
        </div>

        {/* Card grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          {RULES.map(rr => {
            const tone = rr.status === 'warn' ? 'warn' : rr.status === 'bad' ? 'bad' : 'ok';
            const valDisplay = typeof rr.val === 'number'
              ? (rr.unit === '$' ? '$' + rr.val.toLocaleString() : `${rr.val}${rr.unit ? ' ' + rr.unit : ''}`)
              : rr.val;

            return (
              <article key={rr.id} className="hi-card" style={{ padding: 18, position: 'relative', overflow: 'hidden' }}>
                {rr.status === 'warn' && (
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'var(--warn)' }} />
                )}
                {rr.status === 'bad' && (
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'var(--bad)' }} />
                )}

                <div className="hi-row hi-between" style={{ marginBottom: 14 }}>
                  <div className="hi-col hi-g-1">
                    <span className="hi-label">{rr.group}</span>
                    <h3 className="hi-h2">{rr.name}</h3>
                  </div>
                  <div className={`hi-switch ${rr.on ? 'hi-switch--on' : ''}`} />
                </div>

                <div className="hi-row hi-between" style={{ alignItems: 'flex-end', marginBottom: 12 }}>
                  <span className="hi-mono hi-num" style={{ fontSize: 24, fontWeight: 600, color: rr.on ? 'var(--text)' : 'var(--text-mute)', letterSpacing: '-0.02em' }}>{valDisplay}</span>
                  {rr.on && rr.status !== 'bad' && (
                    <span className={`hi-badge hi-badge--${tone}`}>
                      <span className="hi-dot" />
                      {rr.status === 'warn' ? `${rr.pct}% used` : 'On track'}
                    </span>
                  )}
                  {!rr.on && <span className="hi-badge hi-badge--neutral">Disabled</span>}
                </div>

                {rr.on && rr.pct > 0 && rr.pct < 100 && (
                  <div className={`hi-bar hi-bar--${tone}`}><i style={{ width: rr.pct + '%' }} /></div>
                )}
                {(rr.pct === 100 || rr.pct === 0) && (
                  <div className="hi-bar"><i style={{ width: '0%' }} /></div>
                )}

                <div className="hi-row hi-between" style={{ marginTop: 12 }}>
                  <span className="hi-tiny">{rr.currLabel}</span>
                  <button className="hi-btn hi-btn--ghost hi-btn--sm" style={{ padding: '2px 6px' }}>
                    <Icon name="edit" size="sm" /> Edit
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        <div className="hi-row" style={{ marginTop: 18, justifyContent: 'center' }}>
          <button className="hi-btn hi-btn--ghost"><Icon name="plus" size="sm" /> Add custom rule</button>
        </div>
      </div>
    </Shell>
  );
};

// ─────────────────────────────────────────────────────────────────
// V3 · Matrix — power user, rules × accounts
// ─────────────────────────────────────────────────────────────────
const HV3Matrix = () => {
  const cellVals = {
    'daily-loss':  [{ v: '$1,200', s: 'warn', p: 70 }, { v: '$2,500', s: 'ok', p: 24 }, { v: '$1,200', s: 'ok', p: 35 }, { v: '—', s: 'idle', p: 0 }],
    'max-dd':      [{ v: '$2,500', s: 'ok', p: 46 }, { v: '$5,000', s: 'ok', p: 22 }, { v: '$2,500', s: 'ok', p: 30 }, { v: '—', s: 'idle', p: 0 }],
    'risk-trade':  [{ v: '1.0%',   s: 'ok', p: 100 },{ v: '0.5%', s: 'ok', p: 100 }, { v: '1.0%', s: 'ok', p: 100 }, { v: '2.0%', s: 'ok', p: 100 }],
    'pos-size':    [{ v: '5 ct',   s: 'ok', p: 40 }, { v: '10 ct', s: 'ok', p: 30 },  { v: '5 ct',  s: 'ok', p: 20 },  { v: '20 ct', s: 'ok', p: 5 }],
    'max-open':    [{ v: '3',      s: 'ok', p: 67 }, { v: '5',     s: 'ok', p: 40 },  { v: '3',     s: 'ok', p: 33 },  { v: '∞',     s: 'ok', p: 100 }],
    'profit-tgt':  [{ v: '$3,000', s: 'ok', p: 61 }, { v: '$5,000',s: 'ok', p: 28 },  { v: '$3,000',s: 'ok', p: 10 },  { v: '—', s: 'idle', p: 0 }],
    'hours':       [{ v: '8:30-16',s: 'ok', p: 100 },{ v: '8:30-16',s:'ok', p: 100 }, { v: '8:30-16',s:'ok',p: 100 },  { v: '24/5',  s: 'ok', p: 100 }],
    'consistency': [{ v: '40%',    s: 'ok', p: 80 }, { v: '40%',   s: 'ok', p: 65 },  { v: '40%',   s: 'ok', p: 50 },  { v: '—', s: 'idle', p: 0 }],
    'news':        [{ v: 'off',    s: 'bad',p: 0 },  { v: '5min ±',s: 'ok', p: 100 }, { v: '5min ±',s: 'ok', p: 100 }, { v: 'off',   s: 'idle', p: 0 }],
  };
  const tone = s => s === 'ok' ? 'var(--ok)' : s === 'warn' ? 'var(--warn)' : s === 'bad' ? 'var(--bad)' : 'var(--text-faint)';

  return (
    <Shell breadcrumb={['All accounts', 'Trading Rules', 'Matrix']}>
      <div style={{ padding: '24px 32px', height: '100%', overflow: 'auto' }}>
        <div className="hi-row hi-between" style={{ marginBottom: 4, alignItems: 'flex-start' }}>
          <div className="hi-col hi-g-2">
            <h1 className="hi-display">Rules matrix</h1>
            <p className="hi-body">All rules across all accounts. Click a cell to edit, shift-click for bulk, drag a column to copy between accounts.</p>
          </div>
          <div className="hi-row hi-g-2">
            <button className="hi-btn"><Icon name="download" size="sm" /> Export</button>
            <button className="hi-btn"><Icon name="refresh" size="sm" /> Pull from broker</button>
            <button className="hi-btn hi-btn--primary">Save all</button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="hi-row hi-between" style={{ marginTop: 24, marginBottom: 14 }}>
          <div className="hi-row hi-g-2">
            <div className="hi-input-affix" style={{ width: 260 }}>
              <span className="hi-affix" style={{ background: 'transparent', borderRight: 'none' }}><Icon name="search" size="sm" /></span>
              <input className="hi-input" placeholder="Filter rules or accounts…" style={{ fontSize: 13, padding: '7px 10px 7px 0' }} />
            </div>
            <span className="hi-chip hi-chip--active">All</span>
            <span className="hi-chip">Enabled</span>
            <span className="hi-chip">Near limit · 1</span>
            <span className="hi-chip">Disabled · 1</span>
          </div>
          <div className="hi-row hi-g-3 hi-tiny" style={{ color: 'var(--text-mute)' }}>
            <span className="hi-row hi-g-2"><span className="hi-dot" style={{ color: 'var(--ok)' }} />ok</span>
            <span className="hi-row hi-g-2"><span className="hi-dot" style={{ color: 'var(--warn)' }} />near limit</span>
            <span className="hi-row hi-g-2"><span className="hi-dot" style={{ color: 'var(--bad)' }} />disabled</span>
            <span className="hi-row hi-g-2"><span className="hi-dot" style={{ color: 'var(--text-faint)' }} />n/a</span>
          </div>
        </div>

        {/* Table */}
        <div className="hi-card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="hi-table">
            <thead>
              <tr>
                <th style={{ width: 280 }}>Rule</th>
                {ACCOUNTS.map(a => (
                  <th key={a.id}>
                    <div className="hi-col hi-g-1">
                      <span className="hi-row hi-g-2" style={{ alignItems: 'center', textTransform: 'none', letterSpacing: 'normal', fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>
                        <span className="hi-dot" style={{ color: a.status === 'warn' ? 'var(--warn)' : a.status === 'idle' ? 'var(--text-faint)' : 'var(--ok)' }} />
                        {a.label}
                      </span>
                      <span className="hi-mono" style={{ fontSize: 11, color: 'var(--text-mute)', fontWeight: 400, letterSpacing: 'normal', textTransform: 'none' }}>{a.tv} · {a.balance}</span>
                    </div>
                  </th>
                ))}
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {RULES.map(rr => (
                <tr key={rr.id}>
                  <td style={{ background: 'var(--surface-2)' }}>
                    <div className="hi-row hi-g-3" style={{ alignItems: 'center' }}>
                      <Icon name="drag" size="sm" style={{ color: 'var(--text-faint)' }} />
                      <div className={`hi-switch ${rr.on ? 'hi-switch--on' : ''}`} style={{ transform: 'scale(0.85)' }} />
                      <div className="hi-col" style={{ gap: 1 }}>
                        <span style={{ fontSize: 13, fontWeight: 500, color: rr.on ? 'var(--text)' : 'var(--text-mute)' }}>{rr.name}</span>
                        <span className="hi-tiny">{rr.group}</span>
                      </div>
                    </div>
                  </td>
                  {cellVals[rr.id].map((c, i) => (
                    <td key={i} style={{ padding: 0 }}>
                      <div style={{ padding: '12px 14px', background: c.s === 'warn' ? 'var(--warn-bg)' : c.s === 'bad' ? 'var(--bad-bg)' : 'transparent', cursor: 'pointer', height: '100%' }}>
                        <div className="hi-row hi-between" style={{ marginBottom: c.p > 0 && c.p < 100 ? 6 : 0 }}>
                          <span className="hi-row hi-g-2" style={{ alignItems: 'center' }}>
                            <span className="hi-dot" style={{ color: tone(c.s) }} />
                            <span className="hi-mono hi-num" style={{ fontSize: 13, fontWeight: 500, color: c.s === 'idle' ? 'var(--text-faint)' : 'var(--text)' }}>{c.v}</span>
                          </span>
                          {c.s === 'warn' && <span className="hi-mono hi-tiny" style={{ color: 'var(--warn)' }}>{c.p}%</span>}
                        </div>
                        {c.p > 0 && c.p < 100 && (
                          <div className={`hi-bar hi-bar--thin hi-bar--${c.s}`}><i style={{ width: c.p + '%' }} /></div>
                        )}
                      </div>
                    </td>
                  ))}
                  <td><button className="hi-btn hi-btn--ghost hi-btn--sm hi-btn--icon"><Icon name="more" size="sm" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="hi-row hi-between" style={{ marginTop: 14 }}>
          <span className="hi-tiny">
            Tip: select a column header to copy all rules to another account · <span className="hi-kbd">⌘C</span> <span className="hi-kbd">⌘V</span>
          </span>
          <button className="hi-btn hi-btn--ghost hi-btn--sm"><Icon name="plus" size="sm" /> Add rule</button>
        </div>
      </div>
    </Shell>
  );
};

Object.assign(window, { HV1Split, HV2Cards, HV3Matrix });
