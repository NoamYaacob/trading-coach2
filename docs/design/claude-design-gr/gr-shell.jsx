// Guardrail · shared components (Shell, AccountSelector, EnforcementChip, RuleCard,
// SaveButton with states).

// ── Brand mark ─────────────────────────────────────────────
const GrLogo = ({ size = 28 }) => (
  <div style={{
    width: size, height: size, borderRadius: 8,
    background: 'var(--copper)', color: 'white',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: "'Instrument Serif', Georgia, serif",
    fontWeight: 400, fontSize: size * 0.65, letterSpacing: '-0.04em',
    transform: 'rotate(-2deg)',
  }}>g</div>
);

// ── Enforcement chip ──────────────────────────────────────
const EnforcementChip = ({ type, size = 'md' }) => {
  const meta = ENFORCEMENT[type];
  if (!meta || !meta.label) return null;
  return (
    <span
      className={`gr-badge gr-badge--${meta.badge}`}
      style={size === 'sm' ? { fontSize: 10.5, padding: '2px 7px' } : undefined}
      title={meta.tip}
    >
      <GIcon name={meta.icon} size="sm" />
      {meta.label}
    </span>
  );
};

// ── Save button with all states ───────────────────────────
// state: 'clean' | 'unsaved' | 'disabled' | 'locked'
const SaveButton = ({ state = 'clean', changeCount = 0, savedAgo = '2m ago', sm = false }) => {
  const cls = `gr-btn ${sm ? 'gr-btn--sm' : ''}`;
  if (state === 'unsaved') {
    return (
      <button className={`${cls} gr-btn--primary`}>
        <GIcon name="check" size="sm" />
        Save {changeCount > 0 ? `${changeCount} change${changeCount > 1 ? 's' : ''}` : 'changes'}
      </button>
    );
  }
  if (state === 'locked') {
    return (
      <button className={`${cls} gr-btn--disabled`} style={{ color: 'var(--warn)', borderColor: 'var(--warn-bd)', background: 'var(--warn-bg)' }}>
        <GIcon name="lock" size="sm" /> Locked · session active
      </button>
    );
  }
  if (state === 'disabled') {
    return (
      <button className={`${cls} gr-btn--disabled`}>
        <GIcon name="check" size="sm" /> Save
      </button>
    );
  }
  // clean
  return (
    <button className={`${cls} gr-btn--ghost`} style={{ color: 'var(--text-mute)' }}>
      <GIcon name="check" size="sm" /> Saved · {savedAgo}
    </button>
  );
};

// ── Account selector (grouped by broker) ──────────────────
// expanded popover style; in product use a dropdown trigger
const AccountSelector = ({ open = false }) => {
  const selected = GR_ACCOUNT_GROUPS.flatMap(g => g.accounts).find(a => a.selected);
  return (
    <div className="gr-col" style={{ position: 'relative' }}>
      {/* Trigger */}
      <button style={{
        width: '100%', textAlign: 'left',
        padding: '10px 12px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 9, cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 10,
        font: 'inherit', color: 'var(--ink)',
      }}>
        <div style={{
          width: 24, height: 24, borderRadius: 6,
          background: 'var(--copper-bg)', color: 'var(--copper)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 700, letterSpacing: '-0.02em',
        }}>AP</div>
        <div className="gr-col gr-grow" style={{ minWidth: 0 }}>
          <div className="gr-row gr-g-2" style={{ alignItems: 'center' }}>
            <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>Apex · Eval $50K</span>
            <span className="gr-badge gr-badge--ok" style={{ padding: '1px 6px', fontSize: 10 }}>live</span>
          </div>
          <span className="gr-mono gr-tiny">{selected?.ref}</span>
        </div>
        <GIcon name="chevD" size="sm" style={{ color: 'var(--text-mute)' }} />
      </button>

      {/* Popover */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 11,
          boxShadow: '0 12px 32px -8px rgba(40,30,15,0.18), 0 2px 6px -2px rgba(40,30,15,0.10)',
          padding: 8, zIndex: 30, maxHeight: 360, overflow: 'auto',
        }}>
          <div className="gr-input-affix" style={{ marginBottom: 6 }}>
            <span className="gr-affix" style={{ background: 'transparent', borderRight: 'none', paddingRight: 4 }}>
              <GIcon name="search" size="sm" />
            </span>
            <input className="gr-input" placeholder="Search accounts…" style={{ padding: '7px 10px 7px 0', fontSize: 13 }} />
          </div>

          {GR_ACCOUNT_GROUPS.map(grp => (
            <div key={grp.broker} style={{ marginTop: 4 }}>
              <div className="gr-label" style={{ padding: '8px 10px 4px' }}>{grp.broker}</div>
              {grp.accounts.map(a => (
                <div key={a.id} style={{
                  padding: '8px 10px',
                  borderRadius: 7,
                  background: a.selected ? 'var(--surface-warm)' : 'transparent',
                  display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                  opacity: a.state === 'expired' ? 0.6 : 1,
                }}>
                  <div className="gr-col gr-grow" style={{ minWidth: 0 }}>
                    <div className="gr-row gr-g-2" style={{ alignItems: 'center' }}>
                      <span style={{ fontSize: 13, fontWeight: a.selected ? 600 : 500, color: 'var(--ink)' }}>{a.name}</span>
                      {a.state === 'live' && <span className="gr-badge gr-badge--ok" style={{ padding: '1px 6px', fontSize: 10 }}>live</span>}
                      {a.state === 'demo' && <span className="gr-badge gr-badge--neutral" style={{ padding: '1px 6px', fontSize: 10 }}>demo</span>}
                      {a.state === 'expired' && <span className="gr-badge gr-badge--bad" style={{ padding: '1px 6px', fontSize: 10 }}>reconnect</span>}
                    </div>
                    <span className="gr-mono gr-tiny">{a.ref}</span>
                  </div>
                  {a.state !== 'expired' && a.balance > 0 && (
                    <span className="gr-mono gr-num gr-small" style={{ color: 'var(--text-mid)' }}>${a.balance.toLocaleString()}</span>
                  )}
                  {a.state === 'expired' && (
                    <button className="gr-btn gr-btn--sm gr-btn--ghost" style={{ color: 'var(--copper)' }}>Reconnect</button>
                  )}
                  {a.selected && <GIcon name="check" size="sm" style={{ color: 'var(--copper)' }} />}
                </div>
              ))}
            </div>
          ))}

          <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
            <button className="gr-btn gr-btn--ghost gr-btn--sm" style={{ width: '100%', justifyContent: 'flex-start', color: 'var(--copper)' }}>
              <GIcon name="plus" size="sm" /> Connect another account
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Rule card with all states ─────────────────────────────
// state: 'clean' | 'unsaved' | 'inherited' | 'changed'
const RuleCard = ({ rule, selected = false, onClick }) => {
  const r = rule;
  const stateCls = r.state === 'unsaved' ? 'gr-rule--unsaved' : r.state === 'changed' ? 'gr-rule--changed' : '';
  const disabledCls = !r.on ? 'gr-rule--disabled' : '';
  const tone = r.status === 'warn' ? 'warn' : r.status === 'bad' ? 'bad' : r.status === 'planned' ? 'plan' : 'ok';

  return (
    <article
      className={`gr-rule ${selected ? 'gr-rule--selected' : ''} ${stateCls} ${disabledCls}`}
      onClick={onClick}
      tabIndex={0}
      role="button"
    >
      {/* Top: group + enforcement */}
      <div className="gr-row gr-between" style={{ marginBottom: 8 }}>
        <span className="gr-label">{r.group}</span>
        <EnforcementChip type={r.enforcement} size="sm" />
      </div>

      {/* Title + sub */}
      <div className="gr-col gr-g-1" style={{ marginBottom: 14 }}>
        <h3 className="gr-h2">{r.name}</h3>
        <span className="gr-tiny">{r.sub}</span>
      </div>

      {/* Value */}
      <div className="gr-row gr-between" style={{ alignItems: 'flex-end', marginBottom: 12, gap: 8 }}>
        <span
          className="gr-mono gr-num"
          style={{
            fontSize: 22, fontWeight: 600,
            color: r.on ? 'var(--ink)' : 'var(--text-mute)',
            letterSpacing: '-0.02em', lineHeight: 1.1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%',
          }}
        >
          {r.valueLabel}
        </span>
        {r.on && r.status === 'warn' && (
          <span className="gr-badge gr-badge--warn"><span className="gr-dot" />{r.usagePct}%</span>
        )}
      </div>

      {/* Usage bar */}
      {r.on && r.usagePct > 0 && r.usagePct < 100 && (
        <div className={`gr-bar gr-bar--${tone}`}><i style={{ width: r.usagePct + '%' }} /></div>
      )}
      {(r.usagePct === 100 || (r.usagePct === 0 && r.on)) && (
        <div style={{ height: 6 }} />
      )}

      {/* Bottom row */}
      <div className="gr-row gr-between" style={{ marginTop: 12 }}>
        <div className="gr-row gr-g-2" style={{ minWidth: 0 }}>
          {r.state === 'inherited' && (
            <span className="gr-tiny gr-row gr-g-1" style={{ color: 'var(--text-mute)' }}>
              <GIcon name="copy" size="sm" /> From template
            </span>
          )}
          {r.state === 'changed' && (
            <span className="gr-tiny gr-row gr-g-1" style={{ color: 'var(--copper)' }}>
              <span className="gr-dot" style={{ color: 'var(--copper)' }} /> Override
            </span>
          )}
          {r.state === 'unsaved' && (
            <span className="gr-tiny gr-row gr-g-1" style={{ color: 'var(--warn)' }}>
              <span className="gr-dot" style={{ color: 'var(--warn)' }} /> Unsaved
            </span>
          )}
          {!r.on && (
            <span className="gr-tiny gr-row gr-g-1" style={{ color: 'var(--text-mute)' }}>
              <GIcon name="lock" size="sm" /> Disabled
            </span>
          )}
          {r.state === 'clean' && r.on && (
            <span className="gr-tiny" style={{ color: 'var(--text-mute)' }}>{r.usageLabel}</span>
          )}
        </div>
        <button className="gr-btn gr-btn--ghost gr-btn--sm" style={{ padding: '3px 8px', color: 'var(--copper)' }} onClick={(e) => e.stopPropagation()}>
          Configure <GIcon name="arrowR" size="sm" />
        </button>
      </div>
    </article>
  );
};

// ── List-row variant of rule (used in side rail) ──────────
const RuleRow = ({ rule, selected = false, onClick }) => {
  const r = rule;
  return (
    <div
      onClick={onClick}
      style={{
        padding: '10px 12px',
        background: selected ? 'var(--surface)' : 'transparent',
        border: selected ? '1px solid var(--border)' : '1px solid transparent',
        borderRadius: 9, cursor: 'pointer', position: 'relative',
      }}>
      {selected && <div style={{ position: 'absolute', left: -1, top: 8, bottom: 8, width: 3, background: 'var(--copper)', borderRadius: 2 }} />}
      <div className="gr-row gr-g-3" style={{ alignItems: 'center' }}>
        <span className="gr-dot gr-dot-lg" style={{
          color: r.status === 'ok' ? 'var(--ok)' : r.status === 'warn' ? 'var(--warn)' : r.status === 'planned' ? 'var(--text-faint)' : 'var(--bad)',
        }} />
        <div className="gr-col gr-grow" style={{ gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 13.5, fontWeight: selected ? 600 : 500, color: r.on ? 'var(--ink)' : 'var(--text-mute)' }}>{r.name}</span>
          <span className="gr-mono gr-tiny">{r.valueLabel}</span>
        </div>
        {!r.on && <GIcon name="lock" size="sm" style={{ color: 'var(--text-faint)' }} />}
        {r.status === 'warn' && <span className="gr-mono gr-tiny" style={{ color: 'var(--warn)', fontWeight: 600 }}>{r.usagePct}%</span>}
        {r.state === 'unsaved' && <span className="gr-dot" style={{ color: 'var(--warn)' }} />}
        {r.state === 'changed' && <span className="gr-dot" style={{ color: 'var(--copper)' }} />}
      </div>
    </div>
  );
};

// ── Sticky save bar (only when there are unsaved changes) ──
const SaveBar = ({ changeCount = 3, savedAgo = '2m ago' }) => (
  <div style={{
    position: 'sticky', bottom: 0, left: 0, right: 0,
    padding: '12px 32px',
    background: `${GR.bg}f2`,
    backdropFilter: 'blur(10px)',
    borderTop: '1px solid var(--border)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
    zIndex: 10,
  }}>
    <div className="gr-row gr-g-3" style={{ minWidth: 0 }}>
      <span className="gr-row gr-g-2 gr-small" style={{ color: 'var(--copper)' }}>
        <span className="gr-dot gr-dot--pulse" style={{ color: 'var(--copper)' }} />
        {changeCount} unsaved change{changeCount > 1 ? 's' : ''}
      </span>
      <span className="gr-tiny">Last saved {savedAgo}</span>
    </div>
    <div className="gr-row gr-g-2">
      <button className="gr-btn gr-btn--ghost">Discard</button>
      <SaveButton state="unsaved" changeCount={changeCount} />
    </div>
  </div>
);

// ── App shell ─────────────────────────────────────────────
const GrShellNav = ({ children, breadcrumb = [], active = 'rules', showAccountSelectorOpen = false }) => (
  <div className="gr-row" style={{ height: '100%', alignItems: 'stretch' }}>
    {/* Side nav */}
    <aside style={{
      width: 240, flex: '0 0 240px',
      borderRight: '1px solid var(--border)',
      background: 'var(--bg-elev)',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: '20px 18px', borderBottom: '1px solid var(--border)' }}>
        <div className="gr-row gr-g-3" style={{ alignItems: 'center' }}>
          <GrLogo />
          <div className="gr-col">
            <span style={{ fontSize: 15.5, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.01em' }}>Guardrail</span>
            <span className="gr-tiny">v2 · live</span>
          </div>
        </div>
      </div>

      {/* Account selector */}
      <div style={{ padding: 14, borderBottom: '1px solid var(--border)' }}>
        <div className="gr-label" style={{ padding: '0 4px 8px' }}>Account</div>
        <AccountSelector open={showAccountSelectorOpen} />
      </div>

      {/* Nav */}
      <nav className="gr-col" style={{ padding: 10, gap: 2 }}>
        {[
          { id: 'home', label: 'Dashboard', icon: 'home' },
          { id: 'rules', label: 'Trading Plan', icon: 'shield' },
          { id: 'trades', label: 'Trades', icon: 'chart' },
          { id: 'accounts', label: 'Accounts', icon: 'user' },
          { id: 'alerts', label: 'Alerts', icon: 'bell', badge: 2 },
          { id: 'settings', label: 'Settings', icon: 'settings' },
        ].map(n => (
          <div key={n.id} className={`gr-nav-item ${n.id === active ? 'gr-nav-item--active' : ''}`}>
            <GIcon name={n.icon} />
            <span>{n.label}</span>
            {n.badge && <span className="gr-badge gr-badge--warn" style={{ marginLeft: 'auto', padding: '1px 6px' }}>{n.badge}</span>}
          </div>
        ))}
      </nav>

      <div className="gr-grow" />

      <div style={{ padding: 14, borderTop: '1px solid var(--border)' }}>
        <div className="gr-card-soft" style={{ padding: 12 }}>
          <div className="gr-row gr-between" style={{ marginBottom: 8 }}>
            <span className="gr-tiny">Tradovate API</span>
            <span className="gr-badge gr-badge--ok"><span className="gr-dot gr-dot--pulse" />live</span>
          </div>
          <div className="gr-mono gr-tiny">ping 42ms · sync 3s ago</div>
        </div>
      </div>
    </aside>

    {/* Main */}
    <main className="gr-col gr-grow" style={{ minWidth: 0 }}>
      <header className="gr-row" style={{
        height: 56, padding: '0 28px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg)', alignItems: 'center', gap: 16,
      }}>
        <div className="gr-row gr-g-2" style={{ color: 'var(--text-mute)', fontSize: 13 }}>
          {breadcrumb.map((b, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span style={{ opacity: 0.4 }}>/</span>}
              <span style={{ color: i === breadcrumb.length - 1 ? 'var(--ink)' : 'var(--text-mute)', fontWeight: i === breadcrumb.length - 1 ? 500 : 400 }}>{b}</span>
            </React.Fragment>
          ))}
        </div>
        <div className="gr-grow" />
        <div className="gr-row gr-g-3" style={{ color: 'var(--text-mute)' }}>
          <div className="gr-row gr-g-2" style={{
            padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 9,
            background: 'var(--surface)', fontSize: 12.5, alignItems: 'center',
          }}>
            <GIcon name="search" size="sm" />
            <span>Quick action…</span>
            <span className="gr-kbd" style={{ marginLeft: 32 }}>⌘K</span>
          </div>
          <button className="gr-btn gr-btn--ghost gr-btn--icon"><GIcon name="bell" /></button>
          <div className="gr-avatar" style={{ background: 'var(--copper)', color: 'white' }}>AN</div>
        </div>
      </header>

      <div className="gr-grow" style={{ overflow: 'hidden', position: 'relative' }}>
        {children}
      </div>
    </main>
  </div>
);

// Legacy alias (keeps existing Trading Plan screens working)
const GrShell = (props) => <GrShellNav {...props} active="rules" />;

Object.assign(window, { GrLogo, EnforcementChip, SaveButton, AccountSelector, RuleCard, RuleRow, SaveBar, GrShell, GrShellNav });
