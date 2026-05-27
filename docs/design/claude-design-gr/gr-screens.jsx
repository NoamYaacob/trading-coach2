// Guardrail · Overview screen and Editor screen.

// ─────────────────────────────────────────────────────────────────
// OVERVIEW (no rule selected — all cards visible)
// ─────────────────────────────────────────────────────────────────
const GrOverview = ({ accountSelectorOpen = false }) => {
  return (
    <div className="gr">
      <GrShell breadcrumb={['Apex · Eval $50K', 'Trading Plan']} showAccountSelectorOpen={accountSelectorOpen}>
        <div style={{ height: '100%', overflow: 'auto' }}>
          {/* Hero */}
          <section style={{ padding: '32px 36px 24px' }}>
            <div className="gr-row gr-between" style={{ alignItems: 'flex-start', gap: 24 }}>
              <div className="gr-col gr-g-3" style={{ maxWidth: 620 }}>
                <span className="gr-label">Trading Plan · Apex Eval $50K</span>
                <h1 className="gr-display">
                  Your <span className="gr-uline" style={{ fontStyle: 'italic' }}>guardrails</span>, watching every tick.
                </h1>
                <p className="gr-body">
                  8 active rules across capital, discipline, sizing, and schedule. One rule is approaching its limit — review it before your next entry.
                </p>
              </div>
              <div className="gr-row gr-g-2">
                <button className="gr-btn"><GIcon name="refresh" size="sm" /> Sync</button>
                <button className="gr-btn"><GIcon name="copy" size="sm" /> Apply template</button>
                <button className="gr-btn gr-btn--primary"><GIcon name="plus" size="sm" /> New rule</button>
              </div>
            </div>

            {/* KPI strip */}
            <div className="gr-row gr-g-3" style={{ marginTop: 28 }}>
              {[
                { label: 'Balance', val: '$49,160', sub: '−$840 today', tone: 'warn' },
                { label: 'Today P&L', val: '−$840', sub: '7 trades · 3W 4L', tone: 'warn' },
                { label: 'Compliance', val: '94%', sub: '1 rule near limit', tone: 'warn' },
                { label: 'Next reset', val: '17:00 ET', sub: 'in 4h 12m', tone: 'mute' },
              ].map((k, i) => (
                <div key={k.label} className="gr-card" style={{ padding: 18, flex: 1 }}>
                  <span className="gr-label">{k.label}</span>
                  <div className="gr-row gr-g-2" style={{ alignItems: 'baseline', marginTop: 8 }}>
                    <span className="gr-mono gr-num" style={{ fontSize: 28, fontWeight: 600, color: k.tone === 'warn' && (i === 1) ? 'var(--warn)' : 'var(--ink)', lineHeight: 1, letterSpacing: '-0.02em' }}>{k.val}</span>
                  </div>
                  <span className="gr-tiny" style={{ marginTop: 6, display: 'inline-block', color: k.tone === 'warn' ? 'var(--warn)' : 'var(--text-mute)' }}>{k.sub}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Filters */}
          <section style={{ padding: '6px 36px 14px' }}>
            <div className="gr-row gr-between">
              <div className="gr-row gr-g-2" style={{ flexWrap: 'wrap' }}>
                <span className="gr-chip gr-chip--active">All 9</span>
                {GR_GROUPS.map(g => {
                  const n = GR_RULES.filter(r => r.group === g).length;
                  if (!n) return null;
                  return <span key={g} className="gr-chip">{g} {n}</span>;
                })}
              </div>
              <div className="gr-row gr-g-2">
                <button className="gr-btn gr-btn--sm"><GIcon name="copy" size="sm" /> Compare accounts</button>
                <div className="gr-seg">
                  <button className="gr-seg--active"><GIcon name="grid" size="sm" /></button>
                  <button><GIcon name="list" size="sm" /></button>
                </div>
              </div>
            </div>
          </section>

          {/* Card grid (3 across) */}
          <section style={{ padding: '0 36px 28px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
              {GR_RULES.map((r, i) => (
                <RuleCard key={r.id} rule={r} />
              ))}
            </div>
          </section>

          {/* Footnote */}
          <section style={{ padding: '0 36px 36px' }}>
            <div className="gr-card-flat" style={{ padding: 18, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8, flex: '0 0 auto',
                background: 'var(--copper-bg)', color: 'var(--copper)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <GIcon name="info" />
              </div>
              <div className="gr-col gr-g-2 gr-grow">
                <span className="gr-h3">About enforcement labels</span>
                <p className="gr-small">
                  <span className="gr-badge gr-badge--broker" style={{ marginRight: 6 }}><GIcon name="shield" size="sm"/>Broker-backed</span>
                  rules are enforced by the broker · 
                  <span className="gr-badge gr-badge--lock" style={{ margin: '0 6px' }}><GIcon name="lock" size="sm"/>App lock</span>
                  rules block orders inside Guardrail before they reach the broker · 
                  <span className="gr-badge gr-badge--mon" style={{ margin: '0 6px' }}><GIcon name="bell" size="sm"/>Monitor</span>
                  rules track and notify but never block trades · 
                  <span className="gr-badge gr-badge--saved" style={{ margin: '0 6px' }}><GIcon name="bookmark" size="sm"/>Saved</span>
                  rules are stored but not yet evaluated · 
                  <span className="gr-badge gr-badge--plan" style={{ marginLeft: 6 }}><GIcon name="sparkle" size="sm"/>Planned</span>
                  rules are not active.
                </p>
              </div>
            </div>
          </section>
        </div>
      </GrShell>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// EDITOR (a rule is selected — Daily Loss Limit)
// mode: 'default' | 'unsaved' | 'locked'
// ─────────────────────────────────────────────────────────────────
const GrEditor = ({ mode = 'default' }) => {
  const r = GR_RULES[0]; // Daily loss limit
  const isLocked = mode === 'locked';
  const isUnsaved = mode === 'unsaved';

  return (
    <div className="gr">
      <GrShell breadcrumb={['Apex · Eval $50K', 'Trading Plan', r.name]}>
        <div className="gr-row" style={{ height: '100%', alignItems: 'stretch' }}>
          {/* Rules rail */}
          <div style={{ width: 300, flex: '0 0 300px', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--bg-elev)' }}>
            <div style={{ padding: '20px 18px 12px' }}>
              <div className="gr-row gr-between" style={{ marginBottom: 14 }}>
                <h2 className="gr-h1">Rules</h2>
                <button className="gr-btn gr-btn--sm"><GIcon name="plus" size="sm" /> New</button>
              </div>
              <div className="gr-input-affix">
                <span className="gr-affix" style={{ background: 'transparent', borderRight: 'none', paddingRight: 4 }}>
                  <GIcon name="search" size="sm" />
                </span>
                <input className="gr-input" placeholder="Filter rules…" style={{ padding: '8px 12px 8px 0', fontSize: 13 }} />
              </div>
            </div>

            <div className="gr-col" style={{ overflow: 'auto', padding: '0 10px 16px' }}>
              {GR_GROUPS.map(grp => {
                const rules = GR_RULES.filter(x => x.group === grp);
                if (!rules.length) return null;
                return (
                  <div key={grp} style={{ marginBottom: 12 }}>
                    <div className="gr-row gr-between" style={{ padding: '8px 10px 6px' }}>
                      <span className="gr-label">{grp}</span>
                      <span className="gr-tiny gr-mono">{rules.length}</span>
                    </div>
                    <div className="gr-col" style={{ gap: 1 }}>
                      {rules.map(rr => (
                        <RuleRow key={rr.id} rule={rr} selected={rr.id === r.id} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Editor pane */}
          <div className="gr-grow gr-col" style={{ overflow: 'auto', minWidth: 0 }}>
            {/* Header */}
            <div style={{ padding: '28px 36px 22px', borderBottom: '1px solid var(--border)' }}>
              <div className="gr-row gr-between" style={{ alignItems: 'flex-start', gap: 24 }}>
                <div className="gr-col gr-g-3" style={{ maxWidth: 620 }}>
                  <div className="gr-row gr-g-2">
                    <EnforcementChip type={r.enforcement} />
                    <span className="gr-badge gr-badge--neutral">{r.group}</span>
                    <span className="gr-badge gr-badge--warn"><span className="gr-dot gr-dot--pulse" />Approaching · 70%</span>
                  </div>
                  <h1 className="gr-h1" style={{ fontSize: 26 }}>{r.name}</h1>
                  <p className="gr-body" style={{ maxWidth: 580 }}>{r.desc}</p>
                </div>
                <div className="gr-row gr-g-2">
                  <button className="gr-btn gr-btn--sm"><GIcon name="copy" size="sm" /> Duplicate</button>
                  <button className="gr-btn gr-btn--sm"><GIcon name="clock" size="sm" /> History</button>
                  <div style={{ width: 1, height: 28, background: 'var(--border)', margin: '0 4px' }} />
                  <div className="gr-row gr-g-2" style={{ alignItems: 'center' }}>
                    <span className="gr-tiny">Enabled</span>
                    <div className={`gr-switch ${isLocked ? 'gr-switch--disabled' : ''} gr-switch--on`} />
                  </div>
                  <div style={{ width: 1, height: 28, background: 'var(--border)', margin: '0 4px' }} />
                  {isLocked ? <SaveButton state="locked" sm />
                    : isUnsaved ? <SaveButton state="unsaved" changeCount={3} sm />
                    : <SaveButton state="clean" savedAgo="2m ago" sm />}
                </div>
              </div>
            </div>

            {/* Mode banner — locked or unsaved */}
            {isLocked && (
              <div style={{
                padding: '14px 36px',
                background: 'var(--warn-bg)',
                borderBottom: '1px solid var(--warn-bd)',
                display: 'flex', alignItems: 'center', gap: 14,
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8, flex: '0 0 auto',
                  background: 'var(--surface)', color: 'var(--warn)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '1px solid var(--warn-bd)',
                }}>
                  <GIcon name="lock" />
                </div>
                <div className="gr-col gr-g-1 gr-grow">
                  <span className="gr-h3" style={{ color: 'var(--warn)' }}>Session locked · daily loss limit reached at 11:42 ET</span>
                  <span className="gr-small">Editor is read-only until reset at 17:00 ET. Rule changes are disabled during a locked session.</span>
                </div>
                <button className="gr-btn gr-btn--sm">
                  <GIcon name="clock" size="sm" /> Resets in 4h 12m
                </button>
              </div>
            )}
            {isUnsaved && (
              <div style={{
                padding: '12px 36px',
                background: 'var(--copper-bg)',
                borderBottom: '1px solid var(--copper-bd)',
                display: 'flex', alignItems: 'center', gap: 14,
              }}>
                <span className="gr-dot gr-dot--pulse" style={{ color: 'var(--copper)', width: 8, height: 8 }} />
                <span className="gr-h3" style={{ color: 'var(--copper)' }}>3 unsaved changes</span>
                <span className="gr-small gr-mute">Threshold · Warning · Discord webhook</span>
                <div className="gr-grow" />
                <button className="gr-btn gr-btn--sm gr-btn--ghost">Discard</button>
                <SaveButton state="unsaved" changeCount={3} sm />
              </div>
            )}

            {/* Body */}
            <div style={{ padding: '24px 36px', display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 24, opacity: isLocked ? 0.62 : 1, pointerEvents: isLocked ? 'none' : 'auto' }}>
              {/* Left col */}
              <div className="gr-col gr-g-4">
                {/* Enforcement explainer */}
                <div className="gr-card" style={{ padding: 18, borderColor: 'var(--broker-bd)', background: 'linear-gradient(0deg, var(--broker-bg), var(--broker-bg)), var(--surface)' }}>
                  <div className="gr-row gr-g-3" style={{ alignItems: 'flex-start' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--broker-bg)', color: 'var(--broker)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
                      <GIcon name="shield" />
                    </div>
                    <div className="gr-col gr-g-1">
                      <div className="gr-row gr-g-2" style={{ alignItems: 'center' }}>
                        <span className="gr-h3">Broker-backed enforcement</span>
                        <span className="gr-badge gr-badge--broker" style={{ padding: '1px 6px', fontSize: 10 }}>active</span>
                      </div>
                      <p className="gr-small">
                        This account is eligible — the daily loss limit is enforced by Tradovate. Guardrail also monitors the limit at the app layer for warnings and notifications.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Threshold */}
                <section className="gr-card" style={{ padding: 22 }}>
                  <div className="gr-row gr-between" style={{ marginBottom: 18, alignItems: 'flex-start' }}>
                    <div className="gr-col gr-g-1">
                      <h2 className="gr-h2">Threshold</h2>
                      <p className="gr-tiny">How loss is measured against the limit.</p>
                    </div>
                    <div className="gr-seg">
                      <button className="gr-seg--active">Amount</button>
                      <button>% of balance</button>
                    </div>
                  </div>

                  <div className="gr-row gr-g-3" style={{ alignItems: 'flex-end' }}>
                    <div className="gr-col gr-g-2" style={{ flex: 1 }}>
                      <label className="gr-label">Daily loss limit</label>
                      <div className="gr-input-affix">
                        <span className="gr-affix">USD</span>
                        <input className="gr-input gr-mono gr-num" defaultValue="1,200.00" style={{ fontSize: 22, fontWeight: 600, padding: '11px 14px', color: 'var(--ink)' }} />
                      </div>
                    </div>
                    <div className="gr-col gr-g-2" style={{ width: 170 }}>
                      <label className="gr-label">Reset at</label>
                      <div className="gr-input-affix">
                        <input className="gr-input gr-mono" defaultValue="17:00" style={{ padding: '11px 14px', fontSize: 15 }} />
                        <span className="gr-affix gr-affix--right">ET</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: 22 }}>
                    <div className="gr-row gr-between" style={{ marginBottom: 10 }}>
                      <span className="gr-tiny">2.4% of $50,000 balance</span>
                      <span className="gr-tiny" style={{ color: 'var(--bad)', fontWeight: 600 }}>Apex cap · $1,250</span>
                    </div>
                    <div style={{ position: 'relative', height: 8, background: 'var(--surface-2)', borderRadius: 4 }}>
                      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '24%', background: 'var(--copper)', borderRadius: 4 }} />
                      <div style={{ position: 'absolute', left: '24%', top: -5, width: 16, height: 18, transform: 'translateX(-8px)', background: 'var(--copper)', borderRadius: 5, border: '2px solid var(--surface)', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }} />
                      <div style={{ position: 'absolute', left: '25%', top: -4, bottom: -4, width: 2, background: 'var(--bad)', opacity: 0.7 }} />
                    </div>
                    <div className="gr-row gr-between gr-tiny gr-mono" style={{ marginTop: 10 }}>
                      <span>$0</span><span>$1,250</span><span>$2,500</span><span>$5,000</span>
                    </div>
                  </div>

                  <div style={{ marginTop: 22, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
                    <div className="gr-row gr-between" style={{ marginBottom: 12 }}>
                      <div className="gr-col gr-g-1">
                        <span className="gr-h3">Monitor warning</span>
                        <span className="gr-tiny">Notify and require confirmation for new orders.</span>
                      </div>
                      <span className="gr-mono gr-num" style={{ fontSize: 18, fontWeight: 600, color: 'var(--warn)' }}>80%</span>
                    </div>
                    <div style={{ position: 'relative', height: 6, background: 'var(--surface-2)', borderRadius: 3 }}>
                      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '80%', background: 'var(--warn)', borderRadius: 3 }} />
                      <div style={{ position: 'absolute', left: '80%', top: -4, width: 14, height: 14, transform: 'translateX(-7px)', background: 'var(--warn)', borderRadius: 4, border: '2px solid var(--surface)' }} />
                    </div>
                  </div>
                </section>

                {/* When triggered — honest split */}
                <section className="gr-card" style={{ padding: 22 }}>
                  <div className="gr-col gr-g-1" style={{ marginBottom: 18 }}>
                    <h2 className="gr-h2">When the limit is reached</h2>
                    <p className="gr-tiny">What Guardrail does on breach. Broker-side actions need broker integration.</p>
                  </div>

                  {/* Active group */}
                  <div className="gr-label" style={{ marginBottom: 8 }}>Active now</div>
                  <div className="gr-col" style={{ gap: 0, marginBottom: 18 }}>
                    {[
                      { ic: 'bell',  t: 'Push notification',    sub: 'Sent to andrew@… and 2 devices', enf: 'monitor', on: true },
                      { ic: 'lock',  t: 'Lock new orders in Guardrail', sub: 'Block submission until next reset', enf: 'lock',    on: true },
                      { ic: 'bolt',  t: 'Discord webhook',      sub: '#trades-log channel',                   enf: 'utility', on: false },
                    ].map((row, i, arr) => (
                      <div key={row.t} className="gr-row" style={{ padding: '12px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--border-sub)' : 'none', gap: 14, alignItems: 'center' }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: 8,
                          background: row.on ? 'var(--copper-bg)' : 'var(--surface-2)',
                          color: row.on ? 'var(--copper)' : 'var(--text-mute)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          border: row.on ? '1px solid var(--copper-bd)' : '1px solid var(--border)',
                        }}>
                          <GIcon name={row.ic} size="sm" />
                        </div>
                        <div className="gr-col gr-grow" style={{ gap: 2 }}>
                          <div className="gr-row gr-g-2" style={{ alignItems: 'center' }}>
                            <span className="gr-h3">{row.t}</span>
                            {row.enf !== 'utility' && <EnforcementChip type={row.enf} size="sm" />}
                          </div>
                          <span className="gr-tiny">{row.sub}</span>
                        </div>
                        <div className={`gr-switch ${row.on ? 'gr-switch--on' : ''}`} />
                      </div>
                    ))}
                  </div>

                  {/* Planned group */}
                  <div className="gr-row gr-between" style={{ marginBottom: 8 }}>
                    <span className="gr-label">Planned · not active</span>
                    <span className="gr-tiny">Requires broker integration</span>
                  </div>
                  <div className="gr-col" style={{ gap: 0, opacity: 0.7 }}>
                    {[
                      { ic: 'x',     t: 'Auto-flatten open positions', sub: 'Send market orders to flatten via broker' },
                      { ic: 'x',     t: 'Cancel pending orders',       sub: 'Cancel working & GTC orders' },
                      { ic: 'lock',  t: 'Lock account at broker',      sub: 'Broker-side block until reset' },
                    ].map((row, i, arr) => (
                      <div key={row.t} className="gr-row" style={{ padding: '12px 0', borderBottom: i < arr.length - 1 ? '1px dashed var(--border)' : 'none', gap: 14, alignItems: 'center' }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: 8,
                          background: 'var(--surface-2)', color: 'var(--text-mute)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          border: '1px dashed var(--border-hi)',
                        }}>
                          <GIcon name={row.ic} size="sm" />
                        </div>
                        <div className="gr-col gr-grow" style={{ gap: 2 }}>
                          <div className="gr-row gr-g-2" style={{ alignItems: 'center' }}>
                            <span className="gr-h3" style={{ color: 'var(--text-mid)' }}>{row.t}</span>
                            <EnforcementChip type="planned" size="sm" />
                          </div>
                          <span className="gr-tiny">{row.sub}</span>
                        </div>
                        <div className="gr-switch gr-switch--disabled" />
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              {/* Right col */}
              <div className="gr-col gr-g-4">
                {/* Live status */}
                <section className="gr-card" style={{ padding: 22, borderColor: 'var(--warn-bd)', boxShadow: '0 0 0 4px var(--warn-bg)' }}>
                  <div className="gr-row gr-between" style={{ marginBottom: 14 }}>
                    <span className="gr-label">Right now</span>
                    <span className="gr-badge gr-badge--warn"><span className="gr-dot gr-dot--pulse" />Approaching</span>
                  </div>
                  <div className="gr-row" style={{ alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                    <span className="gr-mono gr-num" style={{ fontSize: 36, fontWeight: 600, color: 'var(--warn)', lineHeight: 1, letterSpacing: '-0.02em' }}>−$840</span>
                    <span className="gr-mono gr-tiny">/ $1,200</span>
                  </div>
                  <div className="gr-tiny" style={{ marginBottom: 14 }}>$360 remaining · resets in 4h 12m</div>
                  <div className="gr-bar gr-bar--warn gr-bar--thick"><i style={{ width: '70%' }} /></div>

                  <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                    <div className="gr-row gr-between" style={{ marginBottom: 10 }}>
                      <span className="gr-tiny">P&L · last 12 trades</span>
                      <span className="gr-tiny gr-mono">3W · 9L</span>
                    </div>
                    <div className="gr-spark" style={{ height: 36 }}>
                      {[8, 6, -4, 7, -3, -6, 5, -8, -5, 9, -11, -3].map((v, i) => (
                        <i key={i} className={v >= 0 ? 'gr-spark--pos' : 'gr-spark--neg'} style={{ height: Math.abs(v) * 2.6 + 4 + 'px' }} />
                      ))}
                    </div>
                  </div>
                </section>

                {/* Recent triggers */}
                <section className="gr-card" style={{ padding: 22 }}>
                  <div className="gr-row gr-between" style={{ marginBottom: 14 }}>
                    <span className="gr-label">Recent triggers</span>
                    <button className="gr-btn gr-btn--ghost gr-btn--sm">View all</button>
                  </div>
                  <div className="gr-col" style={{ gap: 0 }}>
                    {[
                      { d: 'Mon · May 19', pnl: '−$1,200', note: 'Limit reached · notifications sent', tone: 'bad' },
                      { d: 'Tue · May 13', pnl: '−$1,200', note: 'Limit reached · notifications sent', tone: 'bad' },
                      { d: 'Thu · May 8',  pnl: '−$980',   note: 'Warning at 80% · no breach',        tone: 'warn' },
                    ].map((h, i, arr) => (
                      <div key={i} className="gr-row gr-between" style={{ padding: '12px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--border-sub)' : 'none' }}>
                        <div className="gr-col" style={{ gap: 2 }}>
                          <span className="gr-h3">{h.d}</span>
                          <span className="gr-tiny">{h.note}</span>
                        </div>
                        <span className="gr-mono gr-num" style={{ fontSize: 13.5, color: h.tone === 'bad' ? 'var(--bad)' : 'var(--warn)', fontWeight: 600 }}>{h.pnl}</span>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Apply to other accounts */}
                <section className="gr-card-soft" style={{ padding: 22 }}>
                  <div className="gr-col gr-g-1" style={{ marginBottom: 14 }}>
                    <span className="gr-h3">Apply to other accounts</span>
                    <span className="gr-tiny">Copy this rule to one or more connected accounts.</span>
                  </div>
                  <div className="gr-col" style={{ gap: 8 }}>
                    {GR_ACCOUNT_GROUPS.flatMap(g => g.accounts.map(a => ({ ...a, brokerShort: g.short })))
                      .filter(a => !a.selected && a.state !== 'expired').slice(0, 4).map((a, i) => (
                      <label key={a.id} className="gr-row gr-between" style={{
                        padding: '10px 12px', borderRadius: 9,
                        background: 'var(--surface)', border: '1px solid var(--border)', cursor: 'pointer',
                      }}>
                        <span className="gr-row gr-g-3">
                          <span className={`gr-check ${i === 0 ? 'gr-check--on' : ''}`}>
                            {i === 0 && <GIcon name="check" size="sm" style={{ width: 10, height: 10, strokeWidth: 2.5 }} />}
                          </span>
                          <span className="gr-col gr-g-1">
                            <span className="gr-h3">{a.brokerShort} · {a.name}</span>
                            <span className="gr-mono gr-tiny">{a.ref}</span>
                          </span>
                        </span>
                        {a.state === 'demo' && <span className="gr-badge gr-badge--neutral" style={{ padding: '1px 6px', fontSize: 10 }}>demo</span>}
                      </label>
                    ))}
                  </div>
                  <button className="gr-btn gr-btn--primary gr-btn--sm" style={{ marginTop: 14, width: '100%' }}>Copy to 1 selected</button>
                </section>
              </div>
            </div>

            {/* Sticky save bar */}
            {/* Removed — Save lives in the header actions next to Enabled toggle */}
          </div>
        </div>
      </GrShell>
    </div>
  );
};

Object.assign(window, { GrOverview, GrEditor });
