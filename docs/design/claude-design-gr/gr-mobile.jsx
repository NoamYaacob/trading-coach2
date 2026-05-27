// Guardrail · mobile screens + state showcases.

// ─────────────────────────────────────────────────────────────────
// MOBILE · Overview
// ─────────────────────────────────────────────────────────────────
const GrMobileOverview = () => {
  return (
    <div className="gr" style={{ fontSize: 14 }}>
      {/* Top bar */}
      <header className="gr-row gr-between" style={{
        padding: '14px 16px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-elev)',
      }}>
        <button className="gr-btn gr-btn--ghost gr-btn--icon" style={{ padding: 4 }}><GIcon name="menu" /></button>
        <div className="gr-col" style={{ textAlign: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Trading Plan</span>
          <span className="gr-tiny">Apex · Eval $50K</span>
        </div>
        <button className="gr-btn gr-btn--ghost gr-btn--icon" style={{ padding: 4 }}><GIcon name="bell" /></button>
      </header>

      <div style={{ overflow: 'auto', height: 'calc(100% - 53px)', padding: '14px 14px 80px' }}>
        {/* Status hero */}
        <div className="gr-card-soft" style={{ padding: 16, marginBottom: 14 }}>
          <div className="gr-row gr-between" style={{ marginBottom: 10 }}>
            <span className="gr-label">Today</span>
            <span className="gr-badge gr-badge--warn"><span className="gr-dot gr-dot--pulse" />1 near limit</span>
          </div>
          <div className="gr-row gr-between" style={{ alignItems: 'baseline', marginBottom: 4 }}>
            <span className="gr-mono gr-num" style={{ fontSize: 26, fontWeight: 600, color: 'var(--warn)', lineHeight: 1 }}>−$840</span>
            <span className="gr-mono gr-tiny">limit $1,200</span>
          </div>
          <div className="gr-bar gr-bar--warn gr-bar--thick" style={{ marginTop: 10 }}><i style={{ width: '70%' }} /></div>
          <div className="gr-tiny" style={{ marginTop: 8 }}>$360 left · resets in 4h 12m</div>
        </div>

        {/* KPI row */}
        <div className="gr-row gr-g-2" style={{ marginBottom: 14 }}>
          <div className="gr-card" style={{ padding: 12, flex: 1 }}>
            <span className="gr-tiny">Compliance</span>
            <div className="gr-mono gr-num" style={{ fontSize: 18, fontWeight: 600, color: 'var(--warn)', marginTop: 4 }}>94%</div>
          </div>
          <div className="gr-card" style={{ padding: 12, flex: 1 }}>
            <span className="gr-tiny">Rules on</span>
            <div className="gr-mono gr-num" style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)', marginTop: 4 }}>8/9</div>
          </div>
        </div>

        {/* Filters */}
        <div className="gr-row gr-g-2" style={{ marginBottom: 12, overflow: 'auto', paddingBottom: 4 }}>
          <span className="gr-chip gr-chip--active" style={{ flex: '0 0 auto' }}>All 9</span>
          <span className="gr-chip" style={{ flex: '0 0 auto' }}>Capital</span>
          <span className="gr-chip" style={{ flex: '0 0 auto' }}>Discipline</span>
          <span className="gr-chip" style={{ flex: '0 0 auto' }}>Sizing</span>
          <span className="gr-chip" style={{ flex: '0 0 auto' }}>Schedule</span>
        </div>

        {/* Cards stacked */}
        <div className="gr-col gr-g-3">
          {GR_RULES.slice(0, 6).map(r => {
            const tone = r.status === 'warn' ? 'warn' : r.status === 'bad' ? 'bad' : 'ok';
            return (
              <div key={r.id} className={`gr-rule ${r.state === 'changed' ? 'gr-rule--changed' : ''} ${!r.on ? 'gr-rule--disabled' : ''}`} style={{ padding: 14 }}>
                <div className="gr-row gr-between" style={{ marginBottom: 6 }}>
                  <span className="gr-label">{r.group}</span>
                  <EnforcementChip type={r.enforcement} size="sm" />
                </div>
                <div className="gr-row gr-between" style={{ alignItems: 'flex-end', marginTop: 4 }}>
                  <div className="gr-col gr-g-1">
                    <span className="gr-h2">{r.name}</span>
                    <span className="gr-tiny">{r.sub}</span>
                  </div>
                  <GIcon name="chevR" style={{ color: 'var(--text-mute)' }} />
                </div>
                <div className="gr-row gr-between" style={{ alignItems: 'center', marginTop: 12 }}>
                  <span className="gr-mono gr-num" style={{ fontSize: 18, fontWeight: 600, color: r.on ? 'var(--ink)' : 'var(--text-mute)' }}>{r.valueLabel}</span>
                  {r.on && r.status === 'warn' && <span className="gr-badge gr-badge--warn"><span className="gr-dot" />{r.usagePct}%</span>}
                  {!r.on && <span className="gr-badge gr-badge--neutral"><GIcon name="lock" size="sm"/>Disabled</span>}
                </div>
                {r.on && r.usagePct > 0 && r.usagePct < 100 && (
                  <div className={`gr-bar gr-bar--${tone}`} style={{ marginTop: 10 }}><i style={{ width: r.usagePct + '%' }} /></div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom tab bar */}
      <nav style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        background: 'var(--bg-elev)',
        borderTop: '1px solid var(--border)',
        padding: '8px 6px 10px',
        display: 'flex', gap: 4, justifyContent: 'space-around',
      }}>
        {[
          { i: 'home',   l: 'Home' },
          { i: 'shield', l: 'Plan', active: true },
          { i: 'chart',  l: 'Trades' },
          { i: 'user',   l: 'Me' },
        ].map(t => (
          <div key={t.l} className="gr-col" style={{ alignItems: 'center', gap: 3, padding: '4px 12px', color: t.active ? 'var(--copper)' : 'var(--text-mute)' }}>
            <GIcon name={t.i} size="lg" />
            <span style={{ fontSize: 10.5, fontWeight: t.active ? 600 : 500 }}>{t.l}</span>
          </div>
        ))}
      </nav>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// MOBILE · Editor (Daily Loss)
// ─────────────────────────────────────────────────────────────────
const GrMobileEditor = () => {
  const r = GR_RULES[0];
  return (
    <div className="gr" style={{ fontSize: 14 }}>
      <header className="gr-row gr-between" style={{
        padding: '14px 14px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-elev)',
      }}>
        <button className="gr-btn gr-btn--ghost gr-btn--icon" style={{ padding: 4 }}><GIcon name="chevL" /></button>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Daily loss limit</span>
        <button className="gr-btn gr-btn--ghost gr-btn--icon" style={{ padding: 4 }}><GIcon name="more" /></button>
      </header>

      <div style={{ overflow: 'auto', height: 'calc(100% - 53px - 64px)', padding: '14px 14px 14px' }}>
        {/* Status chip row */}
        <div className="gr-row gr-g-2" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
          <EnforcementChip type="broker" />
          <span className="gr-badge gr-badge--warn"><span className="gr-dot gr-dot--pulse" />Approaching</span>
        </div>

        {/* Live */}
        <div className="gr-card" style={{ padding: 16, marginBottom: 14, borderColor: 'var(--warn-bd)' }}>
          <span className="gr-label">Right now</span>
          <div className="gr-row gr-between" style={{ alignItems: 'baseline', marginTop: 6, marginBottom: 4 }}>
            <span className="gr-mono gr-num" style={{ fontSize: 28, fontWeight: 600, color: 'var(--warn)' }}>−$840</span>
            <span className="gr-mono gr-tiny">/ $1,200</span>
          </div>
          <div className="gr-bar gr-bar--warn gr-bar--thick" style={{ marginTop: 8 }}><i style={{ width: '70%' }} /></div>
          <div className="gr-tiny" style={{ marginTop: 8 }}>$360 left · resets in 4h 12m</div>
        </div>

        {/* Threshold */}
        <div className="gr-card" style={{ padding: 16, marginBottom: 14 }}>
          <div className="gr-row gr-between" style={{ marginBottom: 12 }}>
            <span className="gr-h3">Threshold</span>
            <div className="gr-seg" style={{ padding: 1 }}>
              <button className="gr-seg--active" style={{ padding: '4px 8px', fontSize: 11.5 }}>$</button>
              <button style={{ padding: '4px 8px', fontSize: 11.5 }}>%</button>
            </div>
          </div>
          <div className="gr-input-affix" style={{ marginBottom: 12 }}>
            <span className="gr-affix">USD</span>
            <input className="gr-input gr-mono gr-num" defaultValue="1,200.00" style={{ fontSize: 20, fontWeight: 600, padding: '10px 12px' }} />
          </div>
          <div className="gr-row gr-g-2" style={{ flexWrap: 'wrap' }}>
            {['$500', '$1k', '$1.2k', '$2k'].map((t, i) => (
              <span key={t} className={`gr-chip ${i === 2 ? 'gr-chip--active' : ''}`}>{t}</span>
            ))}
          </div>
        </div>

        {/* Reset */}
        <div className="gr-card" style={{ padding: 16, marginBottom: 14 }}>
          <div className="gr-row gr-between">
            <span className="gr-h3">Reset at</span>
            <span className="gr-mono">17:00 ET</span>
          </div>
        </div>

        {/* Triggers */}
        <div className="gr-card" style={{ padding: 16, marginBottom: 14 }}>
          <span className="gr-h3" style={{ marginBottom: 12, display: 'block' }}>When limit is reached</span>
          {[
            { t: 'Push notification', enf: 'monitor', on: true },
            { t: 'Lock new orders in Guardrail', enf: 'lock', on: true },
            { t: 'Discord webhook', enf: 'utility', on: false },
          ].map((row, i, arr) => (
            <div key={row.t} className="gr-row gr-between" style={{
              padding: '10px 0',
              borderBottom: i < arr.length - 1 ? '1px solid var(--border-sub)' : 'none',
            }}>
              <div className="gr-col gr-g-1" style={{ minWidth: 0 }}>
                <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>{row.t}</span>
                {row.enf !== 'utility' && <EnforcementChip type={row.enf} size="sm" />}
              </div>
              <div className={`gr-switch ${row.on ? 'gr-switch--on' : ''}`} />
            </div>
          ))}
        </div>

        {/* Planned */}
        <div className="gr-card-flat" style={{ padding: 14, marginBottom: 14, opacity: 0.85 }}>
          <div className="gr-row gr-g-2" style={{ marginBottom: 8 }}>
            <EnforcementChip type="planned" />
            <span className="gr-tiny">3 broker actions</span>
          </div>
          <span className="gr-small">Auto-flatten, cancel orders, broker-side lockout — pending broker integration.</span>
        </div>
      </div>

      {/* Sticky bottom save */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        padding: '12px 14px',
        background: `${GR.bg}f5`,
        backdropFilter: 'blur(8px)',
        borderTop: '1px solid var(--border)',
        display: 'flex', gap: 8, alignItems: 'center',
      }}>
        <button className="gr-btn gr-btn--ghost" style={{ flex: 1 }}>Cancel</button>
        <button className="gr-btn gr-btn--primary" style={{ flex: 2 }}>
          <GIcon name="check" size="sm" /> Save 3 changes
        </button>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// COMPONENT SHOWCASE · card states + save button states
// ─────────────────────────────────────────────────────────────────
const StateShowcase = () => {
  // Build sample rules in each state
  const sample = GR_RULES.find(x => x.id === 'max-trades');
  const variants = [
    { label: 'Default · clean', rule: { ...sample, state: 'clean' } },
    { label: 'Hover (border-hi)', rule: { ...sample, state: 'clean' }, hover: true },
    { label: 'Selected', rule: { ...sample, state: 'clean' }, selected: true },
    { label: 'Changed (override)', rule: { ...sample, state: 'changed' } },
    { label: 'Unsaved', rule: { ...sample, state: 'unsaved' } },
    { label: 'Inherited from template', rule: { ...sample, state: 'inherited' } },
    { label: 'Disabled / locked', rule: { ...sample, on: false, state: 'clean' } },
    { label: 'Planned (roadmap)', rule: GR_RULES.find(x => x.id === 'broker-actions') },
  ];

  return (
    <div className="gr" style={{ padding: 32, overflow: 'auto', height: '100%' }}>
      <div className="gr-col gr-g-2" style={{ marginBottom: 24 }}>
        <span className="gr-label">Components · all states</span>
        <h2 className="gr-h1" style={{ fontSize: 22 }}>Rule card</h2>
        <p className="gr-body" style={{ maxWidth: 580 }}>One component covers every state. State is derived from the rule object — no separate variants in code.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 36 }}>
        {variants.map((v, i) => (
          <div key={i} className="gr-col gr-g-2">
            <span className="gr-tiny" style={{ fontWeight: 500, color: 'var(--text-mid)' }}>{v.label}</span>
            <div style={v.hover ? { boxShadow: '0 0 0 1px var(--border-hi)', borderRadius: 14 } : undefined}>
              <RuleCard rule={v.rule} selected={v.selected} />
            </div>
          </div>
        ))}
      </div>

      <div className="gr-col gr-g-2" style={{ marginBottom: 16 }}>
        <span className="gr-label">Save button states</span>
        <h2 className="gr-h1" style={{ fontSize: 22 }}>Save</h2>
      </div>
      <div className="gr-row gr-g-3" style={{ flexWrap: 'wrap', marginBottom: 36 }}>
        <div className="gr-col gr-g-2">
          <span className="gr-tiny">Clean</span>
          <SaveButton state="clean" savedAgo="2m ago" />
        </div>
        <div className="gr-col gr-g-2">
          <span className="gr-tiny">Unsaved</span>
          <SaveButton state="unsaved" changeCount={3} />
        </div>
        <div className="gr-col gr-g-2">
          <span className="gr-tiny">Disabled (no changes)</span>
          <SaveButton state="disabled" />
        </div>
        <div className="gr-col gr-g-2">
          <span className="gr-tiny">Locked (session active)</span>
          <SaveButton state="locked" />
        </div>
      </div>

      <div className="gr-col gr-g-2" style={{ marginBottom: 16 }}>
        <span className="gr-label">Enforcement chips</span>
        <h2 className="gr-h1" style={{ fontSize: 22 }}>Honest enforcement labels</h2>
        <p className="gr-body" style={{ maxWidth: 580 }}>Five distinct chip styles — chip type is the visual contract for whether a rule actually blocks anything.</p>
      </div>
      <div className="gr-row gr-g-3" style={{ flexWrap: 'wrap' }}>
        {['broker', 'lock', 'monitor', 'mon-planned', 'saved', 'planned'].map(t => (
          <div key={t} className="gr-col gr-g-2" style={{ minWidth: 200 }}>
            <EnforcementChip type={t} />
            <span className="gr-tiny">{ENFORCEMENT[t].tip}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

Object.assign(window, { GrMobileOverview, GrMobileEditor, StateShowcase });
