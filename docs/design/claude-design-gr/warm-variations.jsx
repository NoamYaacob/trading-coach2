// Warm hi-fi · Split-view editor with color + Instrument Serif headings.
// Re-uses ACCOUNTS + RULES from hifi-tokens.

const WarmShell = ({ children, breadcrumb }) => (
  <div className="w-row" style={{ height: '100%', alignItems: 'stretch' }}>
    {/* Side nav */}
    <aside style={{
      width: 232, flex: '0 0 232px',
      borderRight: '1px solid var(--border)',
      background: 'var(--bg-elev)',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: '20px 18px', borderBottom: '1px solid var(--border)' }}>
        <div className="w-row w-g-3" style={{ alignItems: 'center' }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: 'var(--primary)', color: 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontWeight: 400, fontSize: 18, letterSpacing: '-0.04em',
            transform: 'rotate(-2deg)',
          }}>g</div>
          <div className="w-col">
            <span className="w-serif" style={{ fontSize: 16, color: 'var(--ink)' }}>Guardrail</span>
            <span className="w-tiny">v2 · live</span>
          </div>
        </div>
      </div>

      {/* Account picker */}
      <div style={{ padding: 12, borderBottom: '1px solid var(--border)' }}>
        <div className="w-label" style={{ padding: '4px 4px 8px' }}>Account</div>
        <div className="w-row w-between" style={{
          padding: '10px 12px', background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 9, cursor: 'pointer',
        }}>
          <div className="w-col w-g-1">
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>Eval $50K</span>
            <span className="w-mono w-tiny">TV-4128</span>
          </div>
          <WIcon name="chevD" size="sm" />
        </div>
      </div>

      <nav className="w-col" style={{ padding: 10, gap: 2 }}>
        {[
          { id: 'home', label: 'Overview', icon: 'home' },
          { id: 'rules', label: 'Trading Rules', icon: 'shield', active: true },
          { id: 'trades', label: 'Trades', icon: 'chart' },
          { id: 'accounts', label: 'Accounts', icon: 'user' },
          { id: 'alerts', label: 'Alerts', icon: 'bell', badge: 2 },
        ].map(n => (
          <div key={n.id} className={`w-nav-item ${n.active ? 'w-nav-item--active' : ''}`}>
            <span className="w-nav-i"><WIcon name={n.icon} /></span>
            <span>{n.label}</span>
            {n.badge && <span className="w-badge w-badge--warn" style={{ marginLeft: 'auto', padding: '1px 6px' }}>{n.badge}</span>}
          </div>
        ))}
      </nav>

      <div className="w-grow" />

      <div style={{ padding: 14, borderTop: '1px solid var(--border)' }}>
        <div style={{ background: 'var(--surface-warm)', padding: 12, borderRadius: 10, border: '1px solid var(--border)' }}>
          <div className="w-row w-between" style={{ marginBottom: 8 }}>
            <span className="w-tiny">Tradovate</span>
            <span className="w-badge w-badge--ok"><span className="w-dot w-dot--pulse" />connected</span>
          </div>
          <div className="w-mono w-tiny">ping 42ms · sync 3s ago</div>
        </div>
      </div>
    </aside>

    {/* Main */}
    <main className="w-col w-grow" style={{ minWidth: 0 }}>
      <header className="w-row" style={{
        height: 56, padding: '0 28px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg)', alignItems: 'center', gap: 16,
      }}>
        <div className="w-row w-g-2" style={{ color: 'var(--text-mute)', fontSize: 13 }}>
          {breadcrumb.map((b, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span style={{ opacity: 0.4 }}>/</span>}
              <span style={{ color: i === breadcrumb.length - 1 ? 'var(--ink)' : 'var(--text-mute)', fontWeight: i === breadcrumb.length - 1 ? 500 : 400 }}>{b}</span>
            </React.Fragment>
          ))}
        </div>
        <div className="w-grow" />
        <div className="w-row w-g-3" style={{ color: 'var(--text-mute)' }}>
          <div className="w-row w-g-2" style={{ padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 9, background: 'var(--surface)', fontSize: 12.5, alignItems: 'center' }}>
            <WIcon name="search" size="sm" />
            <span>Quick action…</span>
            <span className="w-kbd" style={{ marginLeft: 32 }}>⌘K</span>
          </div>
          <button className="w-btn w-btn--ghost w-btn--icon"><WIcon name="bell" /></button>
          <div style={{
            width: 30, height: 30, borderRadius: 999,
            background: 'var(--primary)', color: 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 600,
          }}>AN</div>
        </div>
      </header>

      <div className="w-grow" style={{ overflow: 'hidden', position: 'relative' }}>
        {children}
      </div>
    </main>
  </div>
);

// Rules list panel
const RulesList = ({ selectedId }) => (
  <div style={{ width: 320, flex: '0 0 320px', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--bg-elev)' }}>
    <div style={{ padding: '22px 20px 14px' }}>
      <div className="w-row w-between" style={{ marginBottom: 16 }}>
        <h2 className="w-display-sm">Rules</h2>
        <button className="w-btn w-btn--sm"><WIcon name="plus" size="sm" /> New</button>
      </div>
      <div className="w-input-affix">
        <span className="w-affix" style={{ background: 'transparent', borderRight: 'none', paddingRight: 4 }}><WIcon name="search" size="sm" /></span>
        <input className="w-input" placeholder="Filter rules…" style={{ padding: '8px 12px 8px 4px', fontSize: 13 }} />
      </div>
    </div>

    <div className="w-col" style={{ overflow: 'auto', padding: '0 12px 18px' }}>
      {['Risk', 'Position', 'Goals', 'Schedule'].map(grp => (
        <div key={grp} style={{ marginBottom: 14 }}>
          <div className="w-row w-between" style={{ padding: '8px 10px 6px' }}>
            <span className="w-label">{grp}</span>
            <span className="w-tiny w-mono">{RULES.filter(x => x.group === grp).length}</span>
          </div>
          <div className="w-col" style={{ gap: 1 }}>
            {RULES.filter(x => x.group === grp).map(rr => {
              const isSel = rr.id === selectedId;
              return (
                <div key={rr.id} style={{
                  padding: '10px 12px',
                  background: isSel ? 'var(--surface)' : 'transparent',
                  border: isSel ? '1px solid var(--border)' : '1px solid transparent',
                  borderRadius: 9, cursor: 'pointer', position: 'relative',
                }}>
                  {isSel && <div style={{ position: 'absolute', left: -1, top: 8, bottom: 8, width: 3, background: 'var(--primary)', borderRadius: 2 }} />}
                  <div className="w-row w-g-3" style={{ alignItems: 'center' }}>
                    <span className="w-dot w-dot-lg" style={{
                      color: rr.status === 'ok' ? 'var(--ok)' : rr.status === 'warn' ? 'var(--warn)' : 'var(--bad)',
                    }} />
                    <div className="w-col w-grow" style={{ gap: 2, minWidth: 0 }}>
                      <span style={{ fontSize: 13.5, fontWeight: isSel ? 600 : 500, color: rr.on ? 'var(--ink)' : 'var(--text-mute)' }}>{rr.name}</span>
                      <span className="w-mono w-tiny">
                        {rr.unit === '$' ? '$' + rr.val.toLocaleString() : `${rr.val}${rr.unit ? (rr.unit === '%' ? '%' : ' ' + rr.unit) : ''}`}
                      </span>
                    </div>
                    {!rr.on && <WIcon name="lock" size="sm" style={{ color: 'var(--text-faint)' }} />}
                    {rr.status === 'warn' && <span className="w-tiny w-mono" style={{ color: 'var(--warn)', fontWeight: 600 }}>70%</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────
// Variation 1 · Daily Loss Limit editor
// ─────────────────────────────────────────────────────────────────
const WV1 = () => {
  return (
    <div className="w-board">
      <WarmShell breadcrumb={['Eval $50K', 'Trading Rules', 'Daily Loss Limit']}>
        <div className="w-row" style={{ height: '100%', alignItems: 'stretch' }}>
          <RulesList selectedId="daily-loss" />

          <div className="w-grow w-col" style={{ overflow: 'auto', minWidth: 0 }}>
            {/* Hero header */}
            <div style={{ padding: '32px 36px 24px', borderBottom: '1px solid var(--border)' }}>
              <div className="w-row w-between" style={{ alignItems: 'flex-start', gap: 24 }}>
                <div className="w-col w-g-3" style={{ maxWidth: 600 }}>
                  <div className="w-row w-g-2">
                    <span className="w-badge w-badge--warn"><span className="w-dot w-dot--pulse" />Near limit · 70%</span>
                    <span className="w-badge w-badge--neutral">Risk</span>
                    <span className="w-badge w-badge--primary">Required by Topstep</span>
                  </div>
                  <h1 className="w-display" style={{ marginTop: 6 }}>
                    Daily <span className="w-underline-soft" style={{ fontStyle: 'italic' }}>loss limit</span>
                  </h1>
                  <p className="w-body" style={{ maxWidth: 560 }}>
                    The most you can lose in a single trading day before Guardrail steps in, flattens your positions, and locks the account until reset.
                  </p>
                </div>
                <div className="w-row w-g-2">
                  <button className="w-btn w-btn--sm"><WIcon name="copy" size="sm" /> Duplicate</button>
                  <button className="w-btn w-btn--sm"><WIcon name="clock" size="sm" /> History</button>
                  <div className="w-vdiv" style={{ height: 28, margin: '0 4px' }} />
                  <div className="w-row w-g-2" style={{ alignItems: 'center' }}>
                    <span className="w-tiny">Enabled</span>
                    <div className="w-switch w-switch--on" />
                  </div>
                  <div className="w-vdiv" style={{ height: 28, margin: '0 4px' }} />
                  <button className="w-btn w-btn--primary w-btn--sm"><WIcon name="check" size="sm" /> Save</button>
                </div>
              </div>
            </div>

            {/* Body */}
            <div style={{ padding: '28px 36px', display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 24 }}>
              <div className="w-col w-g-4">
                {/* Threshold */}
                <section className="w-card" style={{ padding: 24 }}>
                  <div className="w-row w-between" style={{ marginBottom: 20, alignItems: 'flex-start' }}>
                    <div className="w-col w-g-1">
                      <h2 className="w-h1" style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em' }}>Threshold</h2>
                      <p className="w-tiny">How loss is measured against the limit.</p>
                    </div>
                    <div className="w-seg">
                      <button className="w-seg--active">Amount</button>
                      <button>% of balance</button>
                    </div>
                  </div>

                  <div className="w-row w-g-3" style={{ alignItems: 'flex-end' }}>
                    <div className="w-col w-g-2" style={{ flex: 1 }}>
                      <label className="w-label">Daily loss limit</label>
                      <div className="w-input-affix">
                        <span className="w-affix">USD</span>
                        <input className="w-input w-mono w-num" defaultValue="1,200.00" style={{ fontSize: 24, fontWeight: 600, padding: '12px 14px', color: 'var(--ink)' }} />
                      </div>
                    </div>
                    <div className="w-col w-g-2" style={{ width: 180 }}>
                      <label className="w-label">Reset at</label>
                      <div className="w-input-affix">
                        <input className="w-input w-mono" defaultValue="17:00" style={{ padding: '12px 14px', fontSize: 16 }} />
                        <span className="w-affix w-affix--right">ET</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: 24 }}>
                    <div className="w-row w-between" style={{ marginBottom: 10 }}>
                      <span className="w-tiny">2.4% of $50,000 balance</span>
                      <span className="w-tiny"><span style={{ color: 'var(--bad)', fontWeight: 600 }}>Topstep cap: $1,250</span></span>
                    </div>
                    <div style={{ position: 'relative', height: 8, background: 'var(--surface-2)', borderRadius: 4 }}>
                      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '24%', background: 'var(--primary)', borderRadius: 4 }} />
                      <div style={{ position: 'absolute', left: '24%', top: -5, width: 16, height: 18, transform: 'translateX(-8px)', background: 'var(--primary)', borderRadius: 5, border: '2px solid var(--surface)', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }} />
                      <div style={{ position: 'absolute', left: '25%', top: -4, bottom: -4, width: 2, background: 'var(--bad)', opacity: 0.7 }} />
                    </div>
                    <div className="w-row w-between w-tiny w-mono" style={{ marginTop: 10 }}>
                      <span>$0</span><span>$1,250</span><span>$2,500</span><span>$5,000</span>
                    </div>
                  </div>

                  <div style={{ marginTop: 24, paddingTop: 22, borderTop: '1px solid var(--border)' }}>
                    <div className="w-row w-between" style={{ marginBottom: 12 }}>
                      <div className="w-col w-g-1">
                        <span className="w-h2">Warning threshold</span>
                        <span className="w-tiny">Notify you and require confirmation for new orders.</span>
                      </div>
                      <span className="w-mono w-num" style={{ fontSize: 20, fontWeight: 600, color: 'var(--warn)' }}>80%</span>
                    </div>
                    <div style={{ position: 'relative', height: 6, background: 'var(--surface-2)', borderRadius: 3 }}>
                      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '80%', background: 'var(--warn)', borderRadius: 3 }} />
                      <div style={{ position: 'absolute', left: '80%', top: -4, width: 14, height: 14, transform: 'translateX(-7px)', background: 'var(--warn)', borderRadius: 4, border: '2px solid var(--surface)' }} />
                    </div>
                  </div>
                </section>

                {/* Triggers */}
                <section className="w-card" style={{ padding: 24 }}>
                  <div className="w-col w-g-1" style={{ marginBottom: 18 }}>
                    <h2 className="w-h1" style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em' }}>When triggered</h2>
                    <p className="w-tiny">Sequenced actions Guardrail performs the moment your loss hits the limit.</p>
                  </div>
                  <div className="w-col" style={{ gap: 0 }}>
                    {[
                      { ic: 'x',     t: 'Close all open positions',           sub: 'Market orders to flatten · ~120ms',     on: true },
                      { ic: 'x',     t: 'Cancel pending orders',              sub: 'Working & GTC orders across all symbols', on: true },
                      { ic: 'lock',  t: 'Lock account until reset',           sub: 'Reject new orders until 17:00 ET',      on: true },
                      { ic: 'bell',  t: 'Notify by email + push',             sub: 'Sent to andrew@… and 2 devices',        on: true },
                      { ic: 'bolt',  t: 'Send Discord webhook',               sub: '#trades-log channel',                   on: false },
                    ].map((row, i, arr) => (
                      <div key={row.t} className="w-row" style={{ padding: '14px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--border-sub)' : 'none', gap: 14, alignItems: 'center' }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: 9,
                          background: row.on ? 'var(--primary-bg)' : 'var(--surface-2)',
                          color: row.on ? 'var(--primary)' : 'var(--text-mute)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          border: row.on ? '1px solid var(--primary-bd)' : '1px solid var(--border)',
                        }}>
                          <WIcon name={row.ic} size="sm" />
                        </div>
                        <div className="w-col w-grow" style={{ gap: 2 }}>
                          <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>{row.t}</span>
                          <span className="w-tiny">{row.sub}</span>
                        </div>
                        <button className="w-btn w-btn--ghost w-btn--sm w-btn--icon"><WIcon name="settings" size="sm" /></button>
                        <div className={`w-switch w-switch--primary ${row.on ? 'w-switch--on' : ''}`} />
                      </div>
                    ))}
                  </div>
                  <button className="w-btn w-btn--ghost w-btn--sm" style={{ marginTop: 14, color: 'var(--primary)' }}>
                    <WIcon name="plus" size="sm" /> Add action
                  </button>
                </section>
              </div>

              {/* Right column */}
              <div className="w-col w-g-4">
                {/* Live status */}
                <section className="w-card-primary" style={{ padding: 22 }}>
                  <div className="w-row w-between" style={{ marginBottom: 16 }}>
                    <span className="w-label">Right now</span>
                    <span className="w-badge w-badge--warn"><span className="w-dot w-dot--pulse" />Approaching</span>
                  </div>
                  <div className="w-row" style={{ alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                    <span className="w-serif w-num" style={{ fontSize: 44, lineHeight: 1, color: 'var(--warn)', fontWeight: 400, letterSpacing: '-0.02em' }}>−$840</span>
                    <span className="w-mono w-tiny">/ $1,200</span>
                  </div>
                  <div className="w-tiny" style={{ marginBottom: 14 }}>$360 remaining · resets in 4h 12m</div>
                  <div className="w-bar w-bar--warn w-bar--thick"><i style={{ width: '70%' }} /></div>

                  <div style={{ marginTop: 20, paddingTop: 18, borderTop: '1px solid var(--border)' }}>
                    <div className="w-row w-between" style={{ marginBottom: 12 }}>
                      <span className="w-tiny">P&L · last 12 trades</span>
                      <span className="w-tiny w-mono">3W · 9L</span>
                    </div>
                    <div className="w-spark" style={{ height: 38 }}>
                      {[8, 6, -4, 7, -3, -6, 5, -8, -5, 9, -11, -3].map((v, i) => (
                        <i key={i} className={v >= 0 ? 'w-spark--pos' : 'w-spark--neg'} style={{ height: Math.abs(v) * 2.8 + 4 + 'px' }} />
                      ))}
                    </div>
                  </div>
                </section>

                {/* Recent triggers */}
                <section className="w-card" style={{ padding: 22 }}>
                  <div className="w-row w-between" style={{ marginBottom: 14 }}>
                    <span className="w-label">Recent triggers</span>
                    <button className="w-btn w-btn--ghost w-btn--sm">View all</button>
                  </div>
                  <div className="w-col" style={{ gap: 0 }}>
                    {[
                      { d: 'Mon · May 19', pnl: '−$1,200', note: 'auto-flattened 3 positions', tone: 'bad' },
                      { d: 'Tue · May 13', pnl: '−$1,200', note: 'auto-flattened 1 position', tone: 'bad' },
                      { d: 'Thu · May 8',  pnl: '−$980',   note: 'warning at 80%, no breach', tone: 'warn' },
                    ].map((h, i, arr) => (
                      <div key={i} className="w-row w-between" style={{ padding: '12px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--border-sub)' : 'none' }}>
                        <div className="w-col" style={{ gap: 2 }}>
                          <span style={{ fontSize: 13.5, color: 'var(--ink)' }}>{h.d}</span>
                          <span className="w-tiny">{h.note}</span>
                        </div>
                        <span className="w-mono w-num" style={{ fontSize: 13.5, color: h.tone === 'bad' ? 'var(--bad)' : 'var(--warn)', fontWeight: 600 }}>{h.pnl}</span>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Apply to other accounts */}
                <section className="w-card-soft" style={{ padding: 22 }}>
                  <div className="w-col w-g-1" style={{ marginBottom: 14 }}>
                    <span className="w-h2">Apply to other accounts</span>
                    <span className="w-tiny">Copy this rule to one or more connected accounts.</span>
                  </div>
                  <div className="w-col" style={{ gap: 8 }}>
                    {ACCOUNTS.slice(1).map((a, i) => (
                      <label key={a.id} className="w-row w-between" style={{ padding: '10px 12px', borderRadius: 9, background: 'var(--surface)', border: '1px solid var(--border)', cursor: 'pointer' }}>
                        <span className="w-row w-g-3">
                          <span className={`w-check ${i === 0 ? 'w-check--on' : ''}`}>
                            {i === 0 && <WIcon name="check" size="sm" style={{ width: 10, height: 10, strokeWidth: 2.5 }} />}
                          </span>
                          <span className="w-col w-g-1">
                            <span style={{ fontSize: 13.5, color: 'var(--ink)' }}>{a.label}</span>
                            <span className="w-mono w-tiny">{a.tv}</span>
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <button className="w-btn w-btn--primary w-btn--sm" style={{ marginTop: 14, width: '100%' }}>Copy to 1 selected</button>
                </section>
              </div>
            </div>

          </div>
        </div>
      </WarmShell>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// Variation 2 · Same layout, "Overview" mode — no rule selected
// Shows the dashboard side of things in the right pane instead of an editor.
// ─────────────────────────────────────────────────────────────────
const WV2Overview = () => {
  return (
    <div className="w-board">
      <WarmShell breadcrumb={['Eval $50K', 'Trading Rules']}>
        <div className="w-row" style={{ height: '100%', alignItems: 'stretch' }}>
          <RulesList selectedId={null} />

          <div className="w-grow w-col" style={{ overflow: 'auto', minWidth: 0 }}>
            {/* Hero */}
            <div style={{ padding: '32px 36px 22px' }}>
              <div className="w-row w-between" style={{ alignItems: 'flex-start' }}>
                <div className="w-col w-g-3" style={{ maxWidth: 580 }}>
                  <span className="w-label">Eval $50K · TV-4128</span>
                  <h1 className="w-display">
                    Your <span className="w-underline-soft" style={{ fontStyle: 'italic' }}>guardrails</span>, watching every tick.
                  </h1>
                  <p className="w-body">8 of 9 rules are live and enforcing. One is near its limit — review it before your next trade.</p>
                </div>
                <div className="w-row w-g-2">
                  <button className="w-btn"><WIcon name="refresh" size="sm" /> Sync</button>
                  <button className="w-btn"><WIcon name="copy" size="sm" /> Copy from preset</button>
                  <button className="w-btn w-btn--primary"><WIcon name="plus" size="sm" /> New rule</button>
                </div>
              </div>

              {/* KPI strip */}
              <div className="w-row w-g-3" style={{ marginTop: 26 }}>
                {[
                  { label: 'Balance', val: '$49,160', sub: '−$840 today', tone: 'warn', big: true },
                  { label: 'Compliance', val: '94%', sub: '1 near limit', tone: 'warn' },
                  { label: 'Rules active', val: '8/9', sub: '1 disabled', tone: 'mute' },
                  { label: 'Next reset', val: '17:00', sub: 'in 4h 12m', tone: 'mute' },
                ].map((k, i) => (
                  <div key={k.label} className={i === 0 ? 'w-card-primary' : 'w-card'} style={{ padding: 18, flex: 1 }}>
                    <span className="w-label">{k.label}</span>
                    <div className="w-row w-g-2" style={{ alignItems: 'baseline', marginTop: 8 }}>
                      <span className="w-serif w-num" style={{ fontSize: i === 0 ? 32 : 26, color: 'var(--ink)', lineHeight: 1, letterSpacing: '-0.015em' }}>{k.val}</span>
                    </div>
                    <span className="w-tiny" style={{ marginTop: 6, display: 'inline-block', color: k.tone === 'warn' ? 'var(--warn)' : 'var(--text-mute)' }}>{k.sub}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Rules grid */}
            <div style={{ padding: '0 36px 32px' }}>
              <div className="w-row w-between" style={{ marginBottom: 14 }}>
                <div className="w-row w-g-2">
                  <span className="w-chip w-chip--primary">All 9</span>
                  <span className="w-chip">Risk 3</span>
                  <span className="w-chip">Position 2</span>
                  <span className="w-chip">Goals 2</span>
                  <span className="w-chip">Schedule 2</span>
                </div>
                <div className="w-seg">
                  <button className="w-seg--active"><WIcon name="list" size="sm" /></button>
                  <button><WIcon name="settings" size="sm" /></button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
                {RULES.map(rr => {
                  const tone = rr.status === 'warn' ? 'warn' : rr.status === 'bad' ? 'bad' : 'ok';
                  const valDisplay = typeof rr.val === 'number'
                    ? (rr.unit === '$' ? '$' + rr.val.toLocaleString() : `${rr.val}${rr.unit ? (rr.unit === '%' ? '%' : ' ' + rr.unit) : ''}`)
                    : rr.val;
                  const cardCls = rr.status === 'warn' ? 'w-card-primary' : 'w-card';
                  return (
                    <article key={rr.id} className={cardCls} style={{ padding: 18, position: 'relative' }}>
                      <div className="w-row w-between" style={{ marginBottom: 12 }}>
                        <div className="w-col w-g-1">
                          <span className="w-label">{rr.group}</span>
                          <h3 className="w-h2" style={{ fontSize: 16 }}>{rr.name}</h3>
                        </div>
                        <div className={`w-switch w-switch--primary ${rr.on ? 'w-switch--on' : ''}`} />
                      </div>

                      <div className="w-row w-between" style={{ alignItems: 'flex-end', marginBottom: 10 }}>
                        <span className="w-serif w-num" style={{ fontSize: 26, fontWeight: 400, color: rr.on ? 'var(--ink)' : 'var(--text-mute)', letterSpacing: '-0.01em', lineHeight: 1 }}>{valDisplay}</span>
                        {rr.on && rr.status !== 'bad' && (
                          <span className={`w-badge w-badge--${tone}`}>
                            <span className="w-dot" />
                            {rr.status === 'warn' ? `${rr.pct}% used` : 'On track'}
                          </span>
                        )}
                        {!rr.on && <span className="w-badge w-badge--bad">Disabled</span>}
                      </div>

                      {rr.on && rr.pct > 0 && rr.pct < 100 && (
                        <div className={`w-bar w-bar--${tone}`}><i style={{ width: rr.pct + '%' }} /></div>
                      )}

                      <div className="w-row w-between" style={{ marginTop: 12 }}>
                        <span className="w-tiny">{rr.currLabel}</span>
                        <button className="w-btn w-btn--ghost w-btn--sm" style={{ padding: '3px 8px', color: 'var(--primary)' }}>
                          Configure <WIcon name="arrowR" size="sm" />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </WarmShell>
    </div>
  );
};

Object.assign(window, { WV1, WV2Overview });
