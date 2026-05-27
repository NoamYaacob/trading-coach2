// Guardrail · settings sub-pages, onboarding flow, utility states.

// ── Settings shell (sub-nav + content area) ──────────────────
const SettingsShell = ({ active = 'profile', breadcrumbLast, children }) => (
  <div className="gr">
    <GrShellNav active="settings" breadcrumb={['Settings', breadcrumbLast]}>
      <div className="gr-row" style={{ height: '100%', alignItems: 'stretch' }}>
        <div style={{ width: 240, flex: '0 0 240px', borderRight: '1px solid var(--border)', background: 'var(--bg-elev)', padding: '24px 14px', overflow: 'auto' }}>
          <span className="gr-label" style={{ padding: '0 10px 10px', display: 'block' }}>Settings</span>
          <div className="gr-col" style={{ gap: 2 }}>
            {[
              { id: 'profile', l: 'Profile', i: 'user' },
              { id: 'notifs',  l: 'Notifications', i: 'bell' },
              { id: 'plan',    l: 'Default plan', i: 'shield' },
              { id: 'billing', l: 'Billing & plan', i: 'coin' },
              { id: 'team',    l: 'Team & access', i: 'user' },
              { id: 'api',     l: 'API & integrations', i: 'plug' },
              { id: 'security',l: 'Security', i: 'lock' },
              { id: 'audit',   l: 'Audit log', i: 'list' },
            ].map(n => (
              <div key={n.id} className={`gr-nav-item ${n.id === active ? 'gr-nav-item--active' : ''}`} style={{ fontSize: 13 }}>
                <GIcon name={n.i} />
                <span>{n.l}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="gr-grow" style={{ overflow: 'auto' }}>
          {children}
        </div>
      </div>
    </GrShellNav>
  </div>
);

// ── Settings · Notifications ────────────────────────────────
const GrSettingsNotifs = () => {
  const Channel = ({ ic, name, val, on, badge }) => (
    <div className="gr-row gr-g-3" style={{
      padding: '14px 16px', border: '1px solid var(--border)', borderRadius: 11, background: 'var(--surface)',
      alignItems: 'center',
    }}>
      <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--surface-2)', color: 'var(--text-mid)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
        <GIcon name={ic} />
      </div>
      <div className="gr-col gr-g-1 gr-grow">
        <div className="gr-row gr-g-2">
          <span className="gr-h3">{name}</span>
          {badge && <span className="gr-badge gr-badge--ok"><span className="gr-dot gr-dot--pulse" />active</span>}
        </div>
        <span className="gr-tiny">{val}</span>
      </div>
      <button className="gr-btn gr-btn--sm gr-btn--ghost">Configure</button>
      <div className={`gr-switch ${on ? 'gr-switch--on' : ''}`} />
    </div>
  );

  return (
    <SettingsShell active="notifs" breadcrumbLast="Notifications">
      <section style={{ padding: '32px 36px', maxWidth: 820 }}>
        <span className="gr-label">Notifications</span>
        <h1 className="gr-h1" style={{ fontSize: 28, marginTop: 8 }}>How Guardrail reaches you</h1>
        <p className="gr-body" style={{ marginTop: 6 }}>Choose where rule warnings, breaches and system messages get delivered.</p>

        {/* Channels */}
        <div className="gr-col gr-g-3" style={{ marginTop: 24 }}>
          <span className="gr-label">Channels</span>
          <Channel ic="bell" name="Push (mobile + desktop)" val="2 devices · iPhone 15 Pro · MBP M3" on badge />
          <Channel ic="bell" name="Email" val="andrew@guardrail.io · verified" on badge />
          <Channel ic="bolt" name="Discord webhook" val="#trades-log channel · last fired 4 min ago" on badge />
          <Channel ic="bolt" name="Slack webhook" val="Not configured" on={false} />
          <Channel ic="bell" name="SMS · US only" val="+1 (***) *** 4128" on={false} />
          <Channel ic="plug" name="Custom webhook" val="2 endpoints" on />
        </div>

        {/* Routing */}
        <div className="gr-card" style={{ padding: 24, marginTop: 28 }}>
          <div className="gr-row gr-between" style={{ marginBottom: 16 }}>
            <div className="gr-col gr-g-1">
              <span className="gr-h2">Routing rules</span>
              <span className="gr-tiny">Decide which events go where. Defaults below cover most traders.</span>
            </div>
            <button className="gr-btn gr-btn--sm"><GIcon name="plus" size="sm" /> Add rule</button>
          </div>

          <div className="gr-col" style={{ gap: 0 }}>
            {[
              { ev: 'Daily loss · warning at 80%', dest: ['push', 'email'], sev: 'warn' },
              { ev: 'Daily loss · limit reached',  dest: ['push', 'email', 'discord', 'webhook'], sev: 'bad' },
              { ev: 'Tilt protection triggered',   dest: ['push', 'discord'], sev: 'lock' },
              { ev: 'Broker disconnected',         dest: ['push', 'email', 'webhook'], sev: 'bad' },
              { ev: 'Session opened',              dest: ['push'], sev: 'info' },
              { ev: 'Plan sync · drift detected',  dest: ['email'], sev: 'info' },
            ].map((row, i, arr) => (
              <div key={i} className="gr-row gr-g-3" style={{
                padding: '14px 0',
                borderBottom: i < arr.length - 1 ? '1px solid var(--border-sub)' : 'none',
                alignItems: 'center',
              }}>
                <span className="gr-dot gr-dot-lg" style={{
                  color: row.sev === 'bad' ? 'var(--bad)' : row.sev === 'warn' ? 'var(--warn)' : row.sev === 'lock' ? 'var(--lock)' : 'var(--text-faint)',
                }} />
                <span className="gr-grow gr-small" style={{ color: 'var(--ink)' }}>{row.ev}</span>
                <div className="gr-row gr-g-1">
                  {row.dest.map(d => <span key={d} className="gr-chip" style={{ padding: '3px 9px', fontSize: 11 }}>{d}</span>)}
                </div>
                <button className="gr-btn gr-btn--ghost gr-btn--sm gr-btn--icon"><GIcon name="more" size="sm" /></button>
              </div>
            ))}
          </div>
        </div>

        {/* Quiet hours */}
        <div className="gr-card" style={{ padding: 24, marginTop: 16 }}>
          <div className="gr-row gr-between" style={{ marginBottom: 14 }}>
            <div className="gr-col gr-g-1">
              <span className="gr-h2">Quiet hours</span>
              <span className="gr-tiny">Push notifications are suppressed in this window. Breach-level events still come through.</span>
            </div>
            <div className="gr-switch gr-switch--on" />
          </div>
          <div className="gr-row gr-g-3" style={{ alignItems: 'flex-end' }}>
            <label className="gr-col gr-g-2" style={{ flex: 1 }}>
              <span className="gr-label">From</span>
              <div className="gr-input-affix">
                <input className="gr-input gr-mono" defaultValue="22:00" />
                <span className="gr-affix gr-affix--right">ET</span>
              </div>
            </label>
            <label className="gr-col gr-g-2" style={{ flex: 1 }}>
              <span className="gr-label">Until</span>
              <div className="gr-input-affix">
                <input className="gr-input gr-mono" defaultValue="07:30" />
                <span className="gr-affix gr-affix--right">ET</span>
              </div>
            </label>
          </div>
        </div>
      </section>
    </SettingsShell>
  );
};

// ── Settings · Default plan / Templates ─────────────────────
const GrSettingsTemplates = () => (
  <SettingsShell active="plan" breadcrumbLast="Default plan">
    <section style={{ padding: '32px 36px', maxWidth: 980 }}>
      <span className="gr-label">Default plan</span>
      <h1 className="gr-h1" style={{ fontSize: 28, marginTop: 8 }}>Templates</h1>
      <p className="gr-body" style={{ marginTop: 6 }}>Pre-built guardrails you can apply to a new account in one click — or start from your own.</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginTop: 24 }}>
        {[
          { n: 'Apex $50K Eval', desc: 'Tuned to Apex Trader Funding $50K evaluation rules. Daily loss $1,200, max contracts 5, tilt 3.', src: 'Guardrail official', default: true },
          { n: 'TopStep $50K Combine', desc: 'TopStep daily loss $1,000, contract count 5 micro / 1 mini, no trades 5min around US CPI.', src: 'Guardrail official' },
          { n: 'My personal plan',      desc: 'Your custom template synced from Apex · Eval $50K. Last updated 2 days ago.',                       src: 'You', mine: true },
          { n: 'Conservative · funded', desc: 'Halves all limits vs. eval. Built for funded accounts where every dollar protected matters.',       src: 'Guardrail official' },
          { n: 'Day-trade futures only',desc: 'Daily P&L bands, session 9:30–11:30 ET, no overnight holds, micro contracts only.',                 src: 'Community · 412 users' },
          { n: 'Swing trader',          desc: 'No daily loss limit; weekly drawdown only; max contracts 2. For longer holds.',                     src: 'Community · 88 users' },
        ].map((t, i) => (
          <div key={i} className="gr-card" style={{ padding: 22, position: 'relative' }}>
            {t.default && <span className="gr-badge gr-badge--copper" style={{ position: 'absolute', top: 14, right: 14 }}>default</span>}
            <div className="gr-row gr-g-2" style={{ marginBottom: 12 }}>
              <span className="gr-h2">{t.n}</span>
            </div>
            <p className="gr-small" style={{ minHeight: 56 }}>{t.desc}</p>
            <div className="gr-row gr-between" style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border-sub)' }}>
              <span className="gr-tiny">{t.src}</span>
              <div className="gr-row gr-g-1">
                {t.mine && <button className="gr-btn gr-btn--ghost gr-btn--sm"><GIcon name="edit" size="sm" /></button>}
                <button className="gr-btn gr-btn--ghost gr-btn--sm" style={{ color: 'var(--copper)' }}>Apply <GIcon name="arrowR" size="sm" /></button>
              </div>
            </div>
          </div>
        ))}

        <button style={{
          padding: 22, border: '1px dashed var(--border-hi)', borderRadius: 14, background: 'transparent',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
          color: 'var(--text-mute)', cursor: 'pointer', font: 'inherit', minHeight: 180,
        }}>
          <GIcon name="plus" size="lg" />
          <span style={{ fontSize: 13.5, fontWeight: 500 }}>Create template</span>
          <span className="gr-tiny" style={{ textAlign: 'center', maxWidth: 200 }}>Save the current account's plan as a reusable template</span>
        </button>
      </div>
    </section>
  </SettingsShell>
);

// ── Settings · Billing & plan ───────────────────────────────
const GrSettingsBilling = () => (
  <SettingsShell active="billing" breadcrumbLast="Billing & plan">
    <section style={{ padding: '32px 36px', maxWidth: 900 }}>
      <span className="gr-label">Billing & plan</span>
      <h1 className="gr-h1" style={{ fontSize: 28, marginTop: 8 }}>Your subscription</h1>
      <p className="gr-body" style={{ marginTop: 6 }}>Manage your plan, payment method and invoices.</p>

      {/* Current plan */}
      <div className="gr-card" style={{ padding: 24, marginTop: 24, borderColor: 'var(--copper-bd)' }}>
        <div className="gr-row gr-between" style={{ alignItems: 'flex-start' }}>
          <div className="gr-col gr-g-2">
            <span className="gr-badge gr-badge--copper">Current plan</span>
            <span style={{ fontSize: 22, fontWeight: 600, color: "var(--ink)", letterSpacing: "-0.015em" }}>Pro · monthly</span>
            <span className="gr-tiny">Renews June 18, 2026 · $19.00 charged to Visa ending 4128</span>
          </div>
          <div className="gr-row gr-g-2">
            <button className="gr-btn gr-btn--sm">Switch to annual <span className="gr-badge gr-badge--ok" style={{ marginLeft: 4, padding: '0 5px', fontSize: 10 }}>−18%</span></button>
            <button className="gr-btn gr-btn--sm">Manage plan</button>
          </div>
        </div>

        <div className="gr-row gr-g-3" style={{ marginTop: 20 }}>
          {[
            { l: 'Accounts',      v: '4 / 10' },
            { l: 'Active rules',  v: '8 / unlimited' },
            { l: 'Members',       v: '1 / 3' },
            { l: 'Webhooks',      v: '2 / 10' },
          ].map(k => (
            <div key={k.l} style={{ flex: 1, padding: 14, background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 10 }}>
              <span className="gr-tiny">{k.l}</span>
              <div className="gr-mono gr-num" style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{k.v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Payment method */}
      <div className="gr-card" style={{ padding: 24, marginTop: 16 }}>
        <div className="gr-row gr-between" style={{ marginBottom: 16 }}>
          <div className="gr-col gr-g-1">
            <span className="gr-h2">Payment method</span>
            <span className="gr-tiny">Used for renewals and add-on purchases.</span>
          </div>
          <button className="gr-btn gr-btn--sm"><GIcon name="plus" size="sm" /> Add card</button>
        </div>

        <div className="gr-row gr-g-3" style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 11, background: 'var(--surface-warm)' }}>
          <div style={{ width: 44, height: 30, borderRadius: 6, background: 'var(--ink)', color: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, letterSpacing: '0.05em' }}>VISA</div>
          <div className="gr-col gr-g-1 gr-grow">
            <span className="gr-mono gr-small" style={{ color: 'var(--ink)', fontWeight: 500 }}>•••• •••• •••• 4128</span>
            <span className="gr-tiny">Expires 03 / 28 · Andrew Naftalovich</span>
          </div>
          <span className="gr-badge gr-badge--neutral">primary</span>
          <button className="gr-btn gr-btn--ghost gr-btn--sm">Edit</button>
        </div>
      </div>

      {/* Invoices */}
      <div className="gr-card" style={{ padding: 0, marginTop: 16, overflow: 'hidden' }}>
        <div className="gr-row gr-between" style={{ padding: '18px 22px 12px' }}>
          <span className="gr-h2">Invoices</span>
          <button className="gr-btn gr-btn--ghost gr-btn--sm"><GIcon name="download" size="sm" /> Download all</button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr>
              {['Date', 'Description', 'Amount', 'Status', ''].map(h => (
                <th key={h} className="gr-label" style={{ textAlign: 'left', padding: '10px 22px', borderBottom: '1px solid var(--border)', borderTop: '1px solid var(--border)', background: 'var(--bg-elev)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              { d: 'May 18, 2026', t: 'Pro · monthly', a: '$19.00', s: 'paid' },
              { d: 'Apr 18, 2026', t: 'Pro · monthly', a: '$19.00', s: 'paid' },
              { d: 'Mar 18, 2026', t: 'Pro · monthly', a: '$19.00', s: 'paid' },
              { d: 'Feb 18, 2026', t: 'Pro · monthly · proration', a: '$12.40', s: 'paid' },
            ].map((row, i) => (
              <tr key={i}>
                <td className="gr-mono gr-small" style={{ padding: '12px 22px', borderBottom: '1px solid var(--border-sub)', color: 'var(--text-mid)' }}>{row.d}</td>
                <td style={{ padding: '12px 22px', borderBottom: '1px solid var(--border-sub)', fontSize: 13.5, color: 'var(--ink)' }}>{row.t}</td>
                <td className="gr-mono gr-num" style={{ padding: '12px 22px', borderBottom: '1px solid var(--border-sub)', fontWeight: 500 }}>{row.a}</td>
                <td style={{ padding: '12px 22px', borderBottom: '1px solid var(--border-sub)' }}>
                  <span className="gr-badge gr-badge--ok">Paid</span>
                </td>
                <td style={{ padding: '12px 22px', borderBottom: '1px solid var(--border-sub)', textAlign: 'right' }}>
                  <button className="gr-btn gr-btn--ghost gr-btn--sm"><GIcon name="download" size="sm" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  </SettingsShell>
);

// ── Settings · Team & access ────────────────────────────────
const GrSettingsTeam = () => {
  const members = [
    { n: 'Andrew Naftalovich', e: 'andrew@guardrail.io', r: 'Owner', st: 'active', ini: 'AN' },
    { n: 'Marek Sztein',        e: 'marek@firmtraders.co', r: 'Admin', st: 'active', ini: 'MS' },
    { n: 'Jordan Lim',          e: 'jordan@firmtraders.co', r: 'Trader', st: 'active', ini: 'JL' },
    { n: 'sara@firmtraders.co', e: 'sara@firmtraders.co', r: 'Trader', st: 'invited', ini: 'SA' },
  ];
  return (
    <SettingsShell active="team" breadcrumbLast="Team & access">
      <section style={{ padding: '32px 36px', maxWidth: 980 }}>
        <div className="gr-row gr-between" style={{ alignItems: 'flex-start' }}>
          <div className="gr-col gr-g-2">
            <span className="gr-label">Team & access · 4 of 3 seats used</span>
            <h1 className="gr-h1" style={{ fontSize: 28, marginTop: 8 }}>Members</h1>
            <p className="gr-body" style={{ marginTop: 6 }}>Invite teammates, manage their roles, and decide what they can see.</p>
          </div>
          <div className="gr-row gr-g-2">
            <button className="gr-btn"><GIcon name="copy" size="sm" /> Copy invite link</button>
            <button className="gr-btn gr-btn--primary"><GIcon name="plus" size="sm" /> Invite member</button>
          </div>
        </div>

        {/* Seat warning */}
        <div className="gr-card" style={{ padding: 16, marginTop: 22, borderColor: 'var(--warn-bd)', background: 'var(--warn-bg)', display: 'flex', gap: 14, alignItems: 'center' }}>
          <GIcon name="warn" style={{ color: 'var(--warn)' }} />
          <div className="gr-col gr-g-1 gr-grow">
            <span className="gr-h3" style={{ color: 'var(--warn)' }}>One pending invite over plan limit</span>
            <span className="gr-small">Your Team plan includes 3 seats. Sara's invitation won't activate until you add a seat or remove another member.</span>
          </div>
          <button className="gr-btn gr-btn--sm">Add seat · $49/mo</button>
        </div>

        <div className="gr-card" style={{ padding: 0, marginTop: 16, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead>
              <tr>
                {['Member', 'Role', 'Accounts', 'Last seen', ''].map(h => (
                  <th key={h} className="gr-label" style={{ textAlign: 'left', padding: '12px 22px', borderBottom: '1px solid var(--border)', background: 'var(--bg-elev)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map((m, i) => (
                <tr key={i}>
                  <td style={{ padding: '14px 22px', borderBottom: '1px solid var(--border-sub)' }}>
                    <div className="gr-row gr-g-3">
                      <div className="gr-avatar" style={{ background: m.st === 'invited' ? 'var(--surface-2)' : 'var(--ink)', color: m.st === 'invited' ? 'var(--text-mute)' : 'var(--bg)' }}>{m.ini}</div>
                      <div className="gr-col gr-g-1">
                        <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>{m.n}</span>
                        <span className="gr-mono gr-tiny">{m.e}</span>
                      </div>
                      {m.st === 'invited' && <span className="gr-badge gr-badge--warn">invited</span>}
                    </div>
                  </td>
                  <td style={{ padding: '14px 22px', borderBottom: '1px solid var(--border-sub)' }}>
                    <span className={`gr-badge gr-badge--${m.r === 'Owner' ? 'copper' : m.r === 'Admin' ? 'lock' : 'neutral'}`}>{m.r}</span>
                  </td>
                  <td className="gr-small" style={{ padding: '14px 22px', borderBottom: '1px solid var(--border-sub)', color: 'var(--text-mid)' }}>
                    {m.r === 'Owner' ? 'All 4' : m.r === 'Admin' ? '4' : '2 assigned'}
                  </td>
                  <td className="gr-mono gr-small" style={{ padding: '14px 22px', borderBottom: '1px solid var(--border-sub)', color: 'var(--text-mid)' }}>
                    {m.st === 'invited' ? '—' : i === 0 ? 'now' : i === 1 ? '2 hr ago' : 'yesterday'}
                  </td>
                  <td style={{ padding: '14px 22px', borderBottom: '1px solid var(--border-sub)', textAlign: 'right' }}>
                    <button className="gr-btn gr-btn--ghost gr-btn--sm gr-btn--icon"><GIcon name="more" size="sm" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Roles explainer */}
        <div className="gr-card-flat" style={{ padding: 22, marginTop: 16 }}>
          <span className="gr-h2">Roles</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginTop: 14 }}>
            {[
              { n: 'Owner',  c: 'copper', d: 'Full access. Billing, members, all accounts. Only one owner per workspace.' },
              { n: 'Admin',  c: 'lock', d: 'Manage rules, templates and members. Can\'t change billing.' },
              { n: 'Trader', c: 'neutral', d: 'Read and edit assigned accounts only. Cannot invite or change billing.' },
            ].map(r => (
              <div key={r.n} style={{ padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
                <span className={`gr-badge gr-badge--${r.c}`}>{r.n}</span>
                <p className="gr-small" style={{ marginTop: 8 }}>{r.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </SettingsShell>
  );
};

// ── Settings · API & integrations ───────────────────────────
const GrSettingsApi = () => (
  <SettingsShell active="api" breadcrumbLast="API & integrations">
    <section style={{ padding: '32px 36px', maxWidth: 980 }}>
      <span className="gr-label">API & integrations</span>
      <h1 className="gr-h1" style={{ fontSize: 28, marginTop: 8 }}>Connect Guardrail to your tools</h1>
      <p className="gr-body" style={{ marginTop: 6 }}>Generate API keys, configure webhooks, and link your other trading services.</p>

      {/* Integrations */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginTop: 24 }}>
        {[
          { n: 'TradingView',  s: 'Connected · sync charts', tag: 'Connected', tone: 'ok' },
          { n: 'Discord',      s: '#trades-log · 2 webhooks', tag: 'Connected', tone: 'ok' },
          { n: 'Slack',        s: 'Not connected', tag: null },
          { n: 'Notion',       s: 'Log trades to a database', tag: null },
          { n: 'Zapier',       s: '3,000+ downstream actions', tag: null },
          { n: 'Apple Health', s: 'Coming soon · pair with HRV', tag: 'Planned', tone: 'plan' },
        ].map(int => (
          <div key={int.n} className="gr-card" style={{ padding: 18 }}>
            <div className="gr-row gr-between" style={{ marginBottom: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--surface-2)', color: 'var(--text-mid)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600 }}>{int.n.slice(0, 2).toUpperCase()}</div>
              {int.tag === 'Connected' && <span className="gr-badge gr-badge--ok"><span className="gr-dot gr-dot--pulse" />connected</span>}
              {int.tag === 'Planned' && <EnforcementChip type="planned" size="sm" />}
            </div>
            <span className="gr-h2">{int.n}</span>
            <p className="gr-small" style={{ marginTop: 6, minHeight: 36 }}>{int.s}</p>
            <button className="gr-btn gr-btn--sm" style={{ marginTop: 8 }}>
              {int.tag === 'Connected' ? 'Configure' : int.tag === 'Planned' ? 'Notify me' : 'Connect'}
            </button>
          </div>
        ))}
      </div>

      {/* API keys */}
      <div className="gr-card" style={{ padding: 0, marginTop: 28, overflow: 'hidden' }}>
        <div className="gr-row gr-between" style={{ padding: '20px 24px 14px' }}>
          <div className="gr-col gr-g-1">
            <span className="gr-h2">API keys</span>
            <span className="gr-tiny">For server-to-server reads of your trades, rules, and account state.</span>
          </div>
          <button className="gr-btn gr-btn--primary gr-btn--sm"><GIcon name="plus" size="sm" /> New key</button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr>
              {['Label', 'Key', 'Scopes', 'Created', 'Last used', ''].map(h => (
                <th key={h} className="gr-label" style={{ textAlign: 'left', padding: '10px 24px', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', background: 'var(--bg-elev)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              { l: 'Trade journal',   k: 'gr_live_••••••••••••3a91', sc: ['read:trades'], cr: 'Apr 12', lu: '2 min ago' },
              { l: 'Strategy backtest', k: 'gr_live_••••••••••••8e02', sc: ['read:trades', 'read:plan'], cr: 'Mar 30', lu: '3 days ago' },
              { l: 'Pi dashboard',    k: 'gr_live_••••••••••••22ff', sc: ['read:plan', 'read:alerts'], cr: 'Feb 14', lu: 'never', warn: true },
            ].map((row, i, arr) => (
              <tr key={i}>
                <td style={{ padding: '12px 24px', borderBottom: i < arr.length - 1 ? '1px solid var(--border-sub)' : 'none', fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>{row.l}</td>
                <td className="gr-mono gr-small" style={{ padding: '12px 24px', borderBottom: i < arr.length - 1 ? '1px solid var(--border-sub)' : 'none', color: 'var(--text-mid)' }}>{row.k}</td>
                <td style={{ padding: '12px 24px', borderBottom: i < arr.length - 1 ? '1px solid var(--border-sub)' : 'none' }}>
                  <div className="gr-row gr-g-1">{row.sc.map(s => <span key={s} className="gr-chip" style={{ padding: '2px 7px', fontSize: 10.5 }}>{s}</span>)}</div>
                </td>
                <td className="gr-mono gr-small" style={{ padding: '12px 24px', borderBottom: i < arr.length - 1 ? '1px solid var(--border-sub)' : 'none', color: 'var(--text-mid)' }}>{row.cr}</td>
                <td style={{ padding: '12px 24px', borderBottom: i < arr.length - 1 ? '1px solid var(--border-sub)' : 'none' }}>
                  <span className={`gr-mono gr-small`} style={{ color: row.warn ? 'var(--warn)' : 'var(--text-mid)' }}>{row.lu}</span>
                </td>
                <td style={{ padding: '12px 24px', borderBottom: i < arr.length - 1 ? '1px solid var(--border-sub)' : 'none', textAlign: 'right' }}>
                  <button className="gr-btn gr-btn--ghost gr-btn--sm gr-btn--icon"><GIcon name="more" size="sm" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Webhooks */}
      <div className="gr-card" style={{ padding: 24, marginTop: 16 }}>
        <div className="gr-row gr-between" style={{ marginBottom: 14 }}>
          <div className="gr-col gr-g-1">
            <span className="gr-h2">Outgoing webhooks</span>
            <span className="gr-tiny">Guardrail POSTs JSON events to URLs you control.</span>
          </div>
          <button className="gr-btn gr-btn--sm"><GIcon name="plus" size="sm" /> Add endpoint</button>
        </div>
        <div className="gr-col gr-g-2">
          {[
            { url: 'https://hooks.zapier.com/hooks/catch/12491/abc-trades', ev: 'trade.closed', st: 'live', last: '4 min ago · 200 OK' },
            { url: 'https://my-discord-bot.fly.dev/alert',                 ev: 'rule.breach', st: 'live', last: '2 hr ago · 200 OK' },
            { url: 'https://staging.firmtraders.co/api/journal',           ev: 'all',         st: 'failing', last: '1 hr ago · 502 Bad Gateway', warn: true },
          ].map((w, i) => (
            <div key={i} style={{
              padding: '12px 16px', border: '1px solid var(--border)', borderRadius: 10,
              background: w.warn ? 'var(--warn-bg)' : 'var(--surface)',
              display: 'flex', alignItems: 'center', gap: 14,
            }}>
              <span className={`gr-badge gr-badge--${w.warn ? 'warn' : 'ok'}`}><span className="gr-dot gr-dot--pulse" />{w.st}</span>
              <div className="gr-col gr-g-1 gr-grow" style={{ minWidth: 0 }}>
                <span className="gr-mono gr-small" style={{ color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.url}</span>
                <span className="gr-tiny">event: {w.ev} · last: {w.last}</span>
              </div>
              <button className="gr-btn gr-btn--ghost gr-btn--sm">Logs</button>
              <button className="gr-btn gr-btn--ghost gr-btn--sm gr-btn--icon"><GIcon name="more" size="sm" /></button>
            </div>
          ))}
        </div>
      </div>
    </section>
  </SettingsShell>
);

// ── Settings · Security ─────────────────────────────────────
const GrSettingsSecurity = () => (
  <SettingsShell active="security" breadcrumbLast="Security">
    <section style={{ padding: '32px 36px', maxWidth: 820 }}>
      <span className="gr-label">Security</span>
      <h1 className="gr-h1" style={{ fontSize: 28, marginTop: 8 }}>Keep your account safe</h1>
      <p className="gr-body" style={{ marginTop: 6 }}>Two-factor authentication, active sessions, and recovery options.</p>

      {/* Password */}
      <div className="gr-card" style={{ padding: 22, marginTop: 24 }}>
        <div className="gr-row gr-between">
          <div className="gr-col gr-g-1">
            <span className="gr-h2">Password</span>
            <span className="gr-tiny">Last changed February 4, 2026 · 112 days ago</span>
          </div>
          <button className="gr-btn">Change password</button>
        </div>
      </div>

      {/* 2FA */}
      <div className="gr-card" style={{ padding: 22, marginTop: 16 }}>
        <div className="gr-row gr-between" style={{ marginBottom: 14 }}>
          <div className="gr-col gr-g-1">
            <span className="gr-h2">Two-factor authentication</span>
            <span className="gr-tiny">Required for billing and account-deletion actions.</span>
          </div>
          <span className="gr-badge gr-badge--ok"><GIcon name="check" size="sm" />enabled</span>
        </div>
        <div className="gr-col gr-g-2">
          {[
            { ic: 'lock',     n: 'Authenticator app', s: '1Password · added Mar 12', on: true,  primary: true },
            { ic: 'plug',     n: 'Hardware security key', s: 'YubiKey 5C NFC',         on: true,  primary: false },
            { ic: 'bell',     n: 'SMS · backup',          s: '+1 (***) *** 4128',     on: false, primary: false },
            { ic: 'bookmark', n: 'Recovery codes',        s: '8 of 10 unused',         on: true,  primary: false },
          ].map(row => (
            <div key={row.n} style={{ padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--surface-2)', color: 'var(--text-mid)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <GIcon name={row.ic} size="sm" />
              </div>
              <div className="gr-col gr-g-1 gr-grow">
                <div className="gr-row gr-g-2">
                  <span className="gr-h3">{row.n}</span>
                  {row.primary && <span className="gr-badge gr-badge--neutral">primary</span>}
                </div>
                <span className="gr-tiny">{row.s}</span>
              </div>
              <button className="gr-btn gr-btn--ghost gr-btn--sm">Manage</button>
              <div className={`gr-switch ${row.on ? 'gr-switch--on' : ''}`} />
            </div>
          ))}
        </div>
      </div>

      {/* Sessions */}
      <div className="gr-card" style={{ padding: 22, marginTop: 16 }}>
        <div className="gr-row gr-between" style={{ marginBottom: 14 }}>
          <div className="gr-col gr-g-1">
            <span className="gr-h2">Active sessions</span>
            <span className="gr-tiny">3 devices signed in. Sign out anywhere you don't recognise.</span>
          </div>
          <button className="gr-btn" style={{ color: 'var(--bad)', borderColor: 'var(--bad-bd)' }}>Sign out all others</button>
        </div>
        <div className="gr-col gr-g-2">
          {[
            { dev: 'MacBook Pro · Chrome', ip: 'Brooklyn, NY · 73.4.•.•', ts: 'this device', current: true },
            { dev: 'iPhone 15 Pro · Guardrail iOS', ip: 'Brooklyn, NY', ts: 'active 12 min ago' },
            { dev: 'Windows · Firefox',    ip: 'Newark, NJ · ••.•.220.4', ts: 'May 12 · 14 days ago', stale: true },
          ].map((s, i) => (
            <div key={i} style={{ padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--surface-2)', color: 'var(--text-mid)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <GIcon name="user" size="sm" />
              </div>
              <div className="gr-col gr-g-1 gr-grow">
                <div className="gr-row gr-g-2">
                  <span className="gr-h3">{s.dev}</span>
                  {s.current && <span className="gr-badge gr-badge--ok">this device</span>}
                  {s.stale && <span className="gr-badge gr-badge--warn">stale</span>}
                </div>
                <span className="gr-mono gr-tiny">{s.ip} · {s.ts}</span>
              </div>
              {!s.current && <button className="gr-btn gr-btn--ghost gr-btn--sm">Revoke</button>}
            </div>
          ))}
        </div>
      </div>
    </section>
  </SettingsShell>
);

// ── Settings · Audit log ────────────────────────────────────
const GrSettingsAudit = () => (
  <SettingsShell active="audit" breadcrumbLast="Audit log">
    <section style={{ padding: '32px 36px' }}>
      <div className="gr-row gr-between" style={{ alignItems: 'flex-start' }}>
        <div className="gr-col gr-g-2">
          <span className="gr-label">Audit log</span>
          <h1 className="gr-h1" style={{ fontSize: 28, marginTop: 8 }}>Every change, every member, every device</h1>
          <p className="gr-body" style={{ marginTop: 6 }}>30-day rolling log for Pro. Unlimited on Team.</p>
        </div>
        <div className="gr-row gr-g-2">
          <button className="gr-btn gr-btn--sm"><GIcon name="download" size="sm" /> Export 30d</button>
        </div>
      </div>

      <div className="gr-row gr-g-2" style={{ marginTop: 22 }}>
        <span className="gr-chip gr-chip--active">All</span>
        <span className="gr-chip">Rule edits</span>
        <span className="gr-chip">Auth</span>
        <span className="gr-chip">API</span>
        <span className="gr-chip">Members</span>
      </div>

      <div className="gr-card" style={{ padding: 0, marginTop: 16, overflow: 'hidden', maxWidth: 1180 }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr>
              {['When', 'Actor', 'Event', 'Target', 'IP'].map(h => (
                <th key={h} className="gr-label" style={{ textAlign: 'left', padding: '12px 22px', borderBottom: '1px solid var(--border)', background: 'var(--bg-elev)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ['11:42 ET', 'Andrew', 'rule.update', 'Daily loss limit · threshold 1200 → 1200, warn 80% → 85%', '73.4.•.•'],
              ['11:31 ET', 'Andrew', 'session.signin', 'macOS · Chrome', '73.4.•.•'],
              ['10:18 ET', 'Guardrail',  'rule.trigger', 'Tilt protection armed · 2 losses', 'system'],
              ['08:31 ET', 'Andrew', 'plan.apply_template', 'Apex $50K Eval applied to Eval $50K', '73.4.•.•'],
              ['Yesterday', 'Marek', 'member.invite', 'Sara invited as Trader', '24.8.•.•'],
              ['Yesterday', 'Andrew', 'api_key.create', 'Trade journal · scope read:trades', '73.4.•.•'],
              ['May 19',    'Guardrail', 'rule.breach', 'Daily loss reached on Eval $50K · session closed', 'system'],
              ['May 18',    'Andrew', 'integration.connect', 'Discord webhook · #trades-log', '73.4.•.•'],
            ].map((row, i, arr) => (
              <tr key={i}>
                <td className="gr-mono gr-small" style={{ padding: '12px 22px', borderBottom: i < arr.length - 1 ? '1px solid var(--border-sub)' : 'none', color: 'var(--text-mid)', whiteSpace: 'nowrap' }}>{row[0]}</td>
                <td style={{ padding: '12px 22px', borderBottom: i < arr.length - 1 ? '1px solid var(--border-sub)' : 'none', fontSize: 13.5, fontWeight: 500 }}>{row[1]}</td>
                <td style={{ padding: '12px 22px', borderBottom: i < arr.length - 1 ? '1px solid var(--border-sub)' : 'none' }}>
                  <span className="gr-mono gr-small" style={{ color: 'var(--ink)' }}>{row[2]}</span>
                </td>
                <td className="gr-small" style={{ padding: '12px 22px', borderBottom: i < arr.length - 1 ? '1px solid var(--border-sub)' : 'none', color: 'var(--text-mid)' }}>{row[3]}</td>
                <td className="gr-mono gr-tiny" style={{ padding: '12px 22px', borderBottom: i < arr.length - 1 ? '1px solid var(--border-sub)' : 'none', color: 'var(--text-mid)' }}>{row[4]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  </SettingsShell>
);

// ─────────────────────────────────────────────────────────────────
// ONBOARDING · multi-step
// ─────────────────────────────────────────────────────────────────
const OnboardingShell = ({ step, total = 4, children }) => (
  <div className="gr" style={{ background: 'var(--bg)', height: '100%', display: 'flex', flexDirection: 'column' }}>
    <header className="gr-row gr-between" style={{ height: 64, padding: '0 36px', borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
      <div className="gr-row gr-g-3" style={{ alignItems: 'center' }}>
        <GrLogo size={28} />
        <span style={{ fontSize: 15.5, fontWeight: 600, color: 'var(--ink)' }}>Guardrail</span>
      </div>
      <div className="gr-row gr-g-4" style={{ alignItems: 'center' }}>
        <div className="gr-row gr-g-2 gr-tiny" style={{ alignItems: 'center', color: 'var(--text-mute)' }}>
          {Array.from({ length: total }).map((_, i) => (
            <span key={i} style={{
              width: i < step ? 24 : 8, height: 8, borderRadius: 999,
              background: i < step ? 'var(--copper)' : i === step ? 'var(--copper)' : 'var(--surface-hi)',
              transition: 'width .15s',
            }} />
          ))}
          <span style={{ marginLeft: 6 }}>Step {step + 1} of {total}</span>
        </div>
        <button className="gr-btn gr-btn--ghost gr-btn--sm">Skip for now</button>
      </div>
    </header>
    <div className="gr-grow" style={{ overflow: 'auto' }}>{children}</div>
  </div>
);

const GrOnboardTemplate = () => (
  <OnboardingShell step={1}>
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '48px 32px 64px' }}>
      <div className="gr-col gr-g-2" style={{ marginBottom: 28, textAlign: 'center' }}>
        <span className="gr-label" style={{ margin: '0 auto' }}>Pick a starting point</span>
        <h1 className="gr-display" style={{ fontSize: 40 }}>Start with a <span className="gr-uline" style={{ fontStyle: 'italic' }}>template</span>?</h1>
        <p className="gr-body" style={{ maxWidth: 520, margin: '6px auto 0' }}>We'll pre-fill rules that match your eval or trading style. You can change anything in the next step.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
        {[
          { n: 'Apex $50K Eval', d: 'Tuned for Apex Trader Funding $50K evaluation rules.', items: ['Daily loss $1,200', 'Max contracts 5', 'Tilt 3 losses', 'Session 8:30 – 16:00 ET'], rec: true },
          { n: 'TopStep $50K Combine', d: 'TopStep Combine, daily loss + contract limits.', items: ['Daily loss $1,000', 'Max contracts 5 micro / 1 mini', 'No trades around CPI'] },
          { n: 'Day-trade futures', d: 'Tight session + microcontract only.', items: ['Session 9:30 – 11:30 ET', 'Micro contracts only', 'No overnight holds'] },
          { n: 'Start from scratch', d: 'Empty plan. Add rules as you discover what trips you up.', items: ['No defaults', 'Add rules later'], blank: true },
        ].map((t, i) => (
          <button key={i} style={{
            padding: 22, textAlign: 'left', cursor: 'pointer', font: 'inherit',
            background: 'var(--surface)', border: t.rec ? '1px solid var(--copper-bd)' : '1px solid var(--border)',
            boxShadow: t.rec ? '0 0 0 4px var(--copper-bg)' : 'none',
            borderRadius: 14, display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <div className="gr-row gr-between" style={{ alignItems: 'flex-start' }}>
              <div className="gr-col gr-g-1">
                <span className="gr-h2">{t.n}</span>
                <span className="gr-tiny">{t.d}</span>
              </div>
              {t.rec && <span className="gr-badge gr-badge--copper">Recommended</span>}
            </div>
            <div className="gr-col gr-g-1" style={{ marginTop: 4 }}>
              {t.items.map(it => (
                <span key={it} className="gr-row gr-g-2 gr-small" style={{ color: 'var(--text)' }}>
                  <GIcon name={t.blank ? 'sparkle' : 'check'} size="sm" style={{ color: t.blank ? 'var(--text-faint)' : 'var(--ok)' }} />
                  {it}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>

      <div className="gr-row gr-between" style={{ marginTop: 32 }}>
        <button className="gr-btn gr-btn--ghost">← Back</button>
        <button className="gr-btn gr-btn--primary">Use this template <GIcon name="arrowR" size="sm" /></button>
      </div>
    </div>
  </OnboardingShell>
);

const GrOnboardInvite = () => (
  <OnboardingShell step={2}>
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 32px 64px' }}>
      <div className="gr-col gr-g-2" style={{ marginBottom: 28, textAlign: 'center' }}>
        <span className="gr-label" style={{ margin: '0 auto' }}>Solo or team?</span>
        <h1 className="gr-display" style={{ fontSize: 40 }}>Invite anyone who needs <span className="gr-uline" style={{ fontStyle: 'italic' }}>visibility</span>.</h1>
        <p className="gr-body" style={{ maxWidth: 500, margin: '6px auto 0' }}>For prop firm operators — invite your risk team. For solo traders, skip this step.</p>
      </div>

      <div className="gr-card" style={{ padding: 22 }}>
        <span className="gr-h2">Send invites</span>
        <div className="gr-col gr-g-2" style={{ marginTop: 14 }}>
          {[1, 2, 3].map(i => (
            <div key={i} className="gr-row gr-g-2">
              <input className="gr-input" placeholder="teammate@yourdomain.com" style={{ flex: 1 }} />
              <div className="gr-input-affix" style={{ width: 130 }}>
                <input className="gr-input" defaultValue="Trader" style={{ padding: '9px 12px' }} />
                <span className="gr-affix gr-affix--right"><GIcon name="chevD" size="sm" /></span>
              </div>
            </div>
          ))}
          <button className="gr-btn gr-btn--ghost gr-btn--sm" style={{ alignSelf: 'flex-start', color: 'var(--copper)' }}><GIcon name="plus" size="sm" /> Add another</button>
        </div>
      </div>

      <div className="gr-row gr-between" style={{ marginTop: 32 }}>
        <button className="gr-btn gr-btn--ghost">← Back</button>
        <div className="gr-row gr-g-2">
          <button className="gr-btn">Skip · I trade solo</button>
          <button className="gr-btn gr-btn--primary">Send invites <GIcon name="arrowR" size="sm" /></button>
        </div>
      </div>
    </div>
  </OnboardingShell>
);

const GrOnboardWelcome = () => (
  <OnboardingShell step={3}>
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '64px 32px', textAlign: 'center' }}>
      <div style={{ width: 80, height: 80, borderRadius: 22, background: 'var(--copper)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
        <GIcon name="check" size="xl" style={{ width: 40, height: 40 }} />
      </div>
      <h1 className="gr-display" style={{ fontSize: 48 }}>You're <span className="gr-uline" style={{ fontStyle: 'italic' }}>protected</span>.</h1>
      <p className="gr-body" style={{ fontSize: 16, maxWidth: 540, margin: '14px auto 32px' }}>
        Apex Eval $50K is connected. 8 rules are live. Guardrail is now watching every tick in real time.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, maxWidth: 640, margin: '0 auto 32px' }}>
        {[
          { l: 'Accounts', v: '1', i: 'user' },
          { l: 'Rules', v: '8', i: 'shield' },
          { l: 'Channels', v: '2', i: 'bell' },
        ].map(k => (
          <div key={k.l} className="gr-card-soft" style={{ padding: 18 }}>
            <GIcon name={k.i} style={{ color: 'var(--copper)', marginBottom: 10 }} />
            <div className="gr-mono gr-num" style={{ fontSize: 28, fontWeight: 600, lineHeight: 1 }}>{k.v}</div>
            <span className="gr-tiny" style={{ marginTop: 4, display: 'inline-block' }}>{k.l}</span>
          </div>
        ))}
      </div>

      <div className="gr-row gr-g-2" style={{ justifyContent: 'center' }}>
        <button className="gr-btn">Tour the app</button>
        <button className="gr-btn gr-btn--primary">Go to dashboard <GIcon name="arrowR" size="sm" /></button>
      </div>
    </div>
  </OnboardingShell>
);

Object.assign(window, {
  GrSettingsNotifs, GrSettingsTemplates, GrSettingsBilling, GrSettingsTeam, GrSettingsApi, GrSettingsSecurity, GrSettingsAudit,
  GrOnboardTemplate, GrOnboardInvite, GrOnboardWelcome,
});
