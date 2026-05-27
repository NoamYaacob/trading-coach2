// Guardrail · full set of marketing + auth + legal pages.
// All share MarketingHeader + MarketingFooter from gr-marketing.jsx.

// ── Shared "legal" article shell ────────────────────────────
const LegalArticle = ({ kicker, title, updated, intro, sections }) => (
  <div className="gr" style={{ height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
    <MarketingHeader />
    <article style={{ maxWidth: 880, margin: '0 auto', padding: '56px 32px 80px', flex: 1 }}>
      <span className="gr-label">{kicker}</span>
      <h1 style={{ fontSize: 44, fontWeight: 600, letterSpacing: '-0.025em', color: 'var(--ink)', margin: '8px 0 12px', lineHeight: 1.12 }}>{title}</h1>
      <p className="gr-tiny">Last updated · {updated}</p>
      {intro && <p className="gr-body" style={{ fontSize: 16, lineHeight: 1.6, marginTop: 22, maxWidth: 720 }}>{intro}</p>}

      <div className="gr-col gr-g-6" style={{ marginTop: 36 }}>
        {sections.map((s, i) => (
          <section key={i}>
            <div className="gr-row gr-g-3" style={{ alignItems: 'baseline', marginBottom: 8 }}>
              <span className="gr-mono" style={{ fontSize: 12, color: 'var(--text-faint)', fontWeight: 500 }}>{String(i + 1).padStart(2, '0')}</span>
              <h2 className="gr-h1" style={{ fontSize: 22 }}>{s.h}</h2>
            </div>
            {s.p.map((p, j) => (
              <p key={j} className="gr-body" style={{ fontSize: 15, lineHeight: 1.65, marginTop: 10 }}>{p}</p>
            ))}
            {s.list && (
              <ul style={{ marginTop: 14, paddingLeft: 22, color: 'var(--text-mid)', lineHeight: 1.7 }}>
                {s.list.map((li, k) => <li key={k} style={{ marginBottom: 6 }}>{li}</li>)}
              </ul>
            )}
          </section>
        ))}
      </div>

      <div className="gr-card-soft" style={{ padding: 18, marginTop: 40, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--copper-bg)', color: 'var(--copper)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
          <GIcon name="info" />
        </div>
        <div className="gr-col gr-g-1">
          <span className="gr-h3">Questions?</span>
          <span className="gr-small">Email <span style={{ color: 'var(--copper)' }}>support@guardrail-trade.com</span> and we'll respond within one business day.</span>
        </div>
      </div>
    </article>
    <MarketingFooter />
  </div>
);

// ── Features ──────────────────────────────────────────────
const GrFeatures = () => (
  <div className="gr" style={{ height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
    <MarketingHeader />
    <section style={{ padding: '64px 32px 32px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <span className="gr-label">Features</span>
        <h1 style={{ fontSize: 56, lineHeight: 1.08, fontWeight: 600, letterSpacing: '-0.025em', color: 'var(--ink)', margin: '8px 0 0', maxWidth: 880 }}>
          Every Guardrail feature, on one page.
        </h1>
        <p className="gr-body" style={{ fontSize: 17, marginTop: 18, maxWidth: 680 }}>
          Built specifically for futures traders working through prop firm evaluations, funded accounts, and personal sessions. No signals, no advice — just the rules you set, held.
        </p>
      </div>
    </section>

    {/* Feature grid */}
    <section style={{ padding: '24px 32px 56px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {[
          { ic: 'shield', t: 'Daily loss limit', d: 'Stops the session when your realised + unrealised P&L crosses the limit. Broker-backed on supported connections.', enf: 'broker' },
          { ic: 'list',   t: 'Max trades per day', d: 'Blocks the next order submission after your daily trade cap is reached. App-layer enforcement.', enf: 'lock' },
          { ic: 'bolt',   t: 'Stop after consecutive losses', d: 'Pauses trading after N reds in a row. Interrupts tilt before it compounds.', enf: 'lock' },
          { ic: 'clock',  t: 'Session hours', d: 'Only trade in the window you decided. Notify when the session ends; lock when the rule fires.', enf: 'mon-planned' },
          { ic: 'target', t: 'Risk per trade', d: 'Warns when an order would risk more than your % of balance based on stop distance.', enf: 'monitor' },
          { ic: 'lock',   t: 'Tilt protection', d: 'A protective lock window after a streak. Configurable cooldown.', enf: 'lock' },
          { ic: 'chart',  t: 'Live rule evaluation', d: 'Every event resolved against your plan in real time. You see Allowed, Warning, or Locked before damage compounds.', enf: 'utility' },
          { ic: 'bell',   t: 'Telegram alerts', d: 'Push, Discord, webhook — wired to whichever channel you actually read.', enf: 'utility' },
          { ic: 'plug',   t: 'Tradovate connection', d: 'Read-only trade events feed. No broker credentials stored.', enf: 'utility' },
        ].map(f => (
          <div key={f.t} className="gr-card" style={{ padding: 22 }}>
            <div className="gr-row gr-between" style={{ marginBottom: 14 }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--surface-2)', color: 'var(--text-mid)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <GIcon name={f.ic} />
              </div>
              {f.enf !== 'utility' && <EnforcementChip type={f.enf} size="sm" />}
            </div>
            <h3 className="gr-h2" style={{ fontSize: 17 }}>{f.t}</h3>
            <p className="gr-body" style={{ marginTop: 8 }}>{f.d}</p>
          </div>
        ))}
      </div>
    </section>

    {/* Roadmap */}
    <section style={{ padding: '24px 32px 80px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div className="gr-card-soft" style={{ padding: 32 }}>
          <span className="gr-label">Coming next</span>
          <h2 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.018em', color: 'var(--ink)', margin: '8px 0 22px' }}>Ten more rules on the way</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            {[
              'Max contracts (standard-eq)',
              'Per-symbol size limits',
              'News blackout windows',
              'Auto-flatten on breach (broker-side)',
              'Cancel pending orders on breach',
              'Broker-side account lockout',
              'Consistency rule (% of best day)',
              'Trailing drawdown tracking',
              'Custom webhook templates',
              'Multi-account compliance dashboard',
            ].map(r => (
              <div key={r} className="gr-row gr-g-3" style={{ padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 9 }}>
                <EnforcementChip type="planned" size="sm" />
                <span className="gr-small" style={{ color: 'var(--ink)' }}>{r}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>

    <MarketingFooter />
  </div>
);

// ── How it works ──────────────────────────────────────────
const GrHowItWorks = () => (
  <div className="gr" style={{ height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
    <MarketingHeader />
    <section style={{ padding: '64px 32px 32px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <span className="gr-label">How it works</span>
        <h1 style={{ fontSize: 56, lineHeight: 1.08, fontWeight: 600, letterSpacing: '-0.025em', color: 'var(--ink)', margin: '8px 0 0', maxWidth: 920 }}>
          Three steps. One operating loop. Repeat every session.
        </h1>
        <p className="gr-body" style={{ fontSize: 17, marginTop: 18, maxWidth: 680 }}>
          Guardrail isn't a chart tool or a signal service. It's the loop you run every trading day: configure → trade → review.
        </p>
      </div>
    </section>

    {/* Three big steps, vertical */}
    <section style={{ padding: '24px 32px 80px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        {[
          { n: '01', tag: 'Premarket', tone: 'neutral', t: 'Set your trading plan',
            p: ['Daily loss limit, max trades, session hours, loss-streak stop. Set them once before the open. Guardrail holds them across every session — not just today.', 'Apply a prop-firm template (Apex, TopStep, MyFundedFutures) to match the rules of your eval automatically, then tweak.'],
            bullets: ['Templates for Apex, TopStep, MFF', 'Per-account overrides', 'Plan version history'] },
          { n: '02', tag: 'Live', tone: 'ok', t: 'Trade with live rule monitoring',
            p: ['Every trade event from Tradovate is evaluated against your rules in real time. The state you see at all times: Allowed, Warning, or Locked.', 'Warnings give you a moment to step back. Locks stop the next order before it lands.'],
            bullets: ['Sub-second rule evaluation', 'Allowed · Warning · Locked states', 'Telegram, Discord, push channels'] },
          { n: '03', tag: 'Locked', tone: 'bad', t: 'Session locks when a rule breaks',
            p: ['When a limit is hit, the session locks inside the app. You see which rule fired, when it fired, and when the reset window opens.', 'Account-level monitoring today. Broker-side enforcement applies to Daily Loss on supported connections, when explicitly enabled.'],
            bullets: ['Reason + timestamp on every lock', 'Reset window indicator', 'Full session log for review'] },
        ].map((s, i, arr) => (
          <div key={s.n} className="gr-card" style={{ padding: 36, marginBottom: i < arr.length - 1 ? 16 : 0 }}>
            <div className="gr-row gr-g-4" style={{ alignItems: 'flex-start' }}>
              <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 56, fontWeight: 500, color: 'var(--text-faint)', letterSpacing: '-0.025em', lineHeight: 1, flex: '0 0 auto' }}>{s.n}</span>
              <div className="gr-col gr-g-3 gr-grow">
                <div className="gr-row gr-g-2">
                  <span className={`gr-badge gr-badge--${s.tone}`} style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 10.5, fontWeight: 600 }}>{s.tag}</span>
                </div>
                <h2 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.018em', color: 'var(--ink)', margin: 0 }}>{s.t}</h2>
                {s.p.map((p, j) => (
                  <p key={j} className="gr-body" style={{ fontSize: 15.5, lineHeight: 1.6, maxWidth: 720 }}>{p}</p>
                ))}
                <div className="gr-row gr-g-2" style={{ marginTop: 6, flexWrap: 'wrap' }}>
                  {s.bullets.map(b => <span key={b} className="gr-chip">{b}</span>)}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>

    {/* Final CTA */}
    <section style={{ padding: '0 32px 64px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div className="gr-card" style={{
          padding: '36px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 24, flexWrap: 'wrap',
          borderColor: 'var(--copper-bd)', boxShadow: '0 0 0 4px var(--copper-bg)',
        }}>
          <div className="gr-col gr-g-2">
            <h2 style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.018em', color: 'var(--ink)', margin: 0 }}>Run your first session.</h2>
            <p className="gr-body">Set your limits, connect Tradovate, and let Guardrail hold the rules.</p>
          </div>
          <button className="gr-btn gr-btn--ink" style={{ padding: '12px 22px', borderRadius: 999, fontSize: 14 }}>Open today's session</button>
        </div>
      </div>
    </section>

    <MarketingFooter />
  </div>
);

// ── For prop firms ────────────────────────────────────────
const GrPropFirms = () => (
  <div className="gr" style={{ height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
    <MarketingHeader />

    {/* Hero */}
    <section style={{ padding: '64px 32px 24px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 56, alignItems: 'center' }}>
        <div>
          <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.18em', color: 'var(--copper)', textTransform: 'uppercase' }}>For prop firm traders</span>
          <h1 style={{ fontSize: 56, lineHeight: 1.08, fontWeight: 600, letterSpacing: '-0.025em', color: 'var(--ink)', margin: '10px 0 0' }}>
            Pass the eval.<br />Keep the funded account.
          </h1>
          <p className="gr-body" style={{ fontSize: 17, lineHeight: 1.55, maxWidth: 540, marginTop: 18 }}>
            Apex, TopStep, MyFundedFutures and most prop firms don't forgive a single emotional trade. Guardrail holds the rules you set so one bad session doesn't cost the challenge or the payout.
          </p>
          <div className="gr-row gr-g-2" style={{ marginTop: 24 }}>
            <button className="gr-btn gr-btn--ink" style={{ padding: '12px 22px', borderRadius: 999, fontSize: 14 }}>Open today's session</button>
            <button className="gr-btn" style={{ padding: '12px 22px', borderRadius: 999, fontSize: 14 }}>Compare to your firm's rules</button>
          </div>
        </div>

        {/* Plan card mock */}
        <div className="gr-card" style={{ padding: 22 }}>
          <div className="gr-row gr-between" style={{ marginBottom: 10 }}>
            <span className="gr-label">Apex · Eval $50K</span>
            <span className="gr-badge gr-badge--ok"><span className="gr-dot gr-dot--pulse" />live</span>
          </div>
          <div className="gr-col gr-g-3" style={{ marginTop: 8 }}>
            {[
              ['Daily loss', '$1,250', 'warn'],
              ['Max contracts', '5 std-eq', 'ok'],
              ['Tilt streak', '3 losses', 'ok'],
              ['Session', '08:30 – 16:00 ET', 'ok'],
            ].map(([l, v, tone]) => (
              <div key={l}>
                <div className="gr-row gr-between" style={{ marginBottom: 4 }}>
                  <span className="gr-small">{l}</span>
                  <span className="gr-mono gr-num" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{v}</span>
                </div>
                <div className={`gr-bar gr-bar--${tone} gr-bar--thin`}><i style={{ width: tone === 'warn' ? '70%' : '40%' }} /></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>

    {/* Three protection cards */}
    <section style={{ padding: '40px 32px 60px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <span className="gr-label">Why traders blow accounts</span>
        <h2 style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)', margin: '8px 0 28px', maxWidth: 720 }}>
          Prop firm rules do not forgive emotional trades.
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {[
            { t: 'Protect the challenge', d: 'Daily drawdown and max-trade rules are not suggestions during an evaluation. Guardrail holds them like they are.', items: ['Daily loss limit per eval', 'Max trades counted at fill', 'Session hours match eval window'] },
            { t: 'Protect the funded account', d: 'When pressure rises, Guardrail keeps the account inside the limits you chose — before emotional decisions override them.', items: ['Conservative defaults for funded', 'Lock the session, not the broker', 'Resume next day intact'] },
            { t: 'Protect payout days', d: 'When the goal is reached, Guardrail helps stop the giveback trade. Lock in the good day.', items: ['Daily profit lock-in', 'Auto session close on target', 'Audit log for payout request'] },
          ].map(c => (
            <div key={c.t} className="gr-card" style={{ padding: 28 }}>
              <h3 className="gr-h2" style={{ fontSize: 18 }}>{c.t}</h3>
              <p className="gr-body" style={{ marginTop: 10 }}>{c.d}</p>
              <div className="gr-col gr-g-2" style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border-sub)' }}>
                {c.items.map(it => (
                  <span key={it} className="gr-row gr-g-2 gr-small" style={{ color: 'var(--text)' }}>
                    <span style={{ color: 'var(--ok)', fontWeight: 700 }}>✓</span> {it}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* Firm templates */}
    <section style={{ padding: '20px 32px 60px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <span className="gr-label">Templates ready to apply</span>
        <h2 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.018em', color: 'var(--ink)', margin: '8px 0 22px' }}>Pre-built for the firms you actually trade</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
          {[
            { n: 'Apex Trader Funding', s: 'Eval, PA, Live funded', live: true },
            { n: 'TopStep',             s: 'Combine & Express',     live: true },
            { n: 'MyFundedFutures',     s: 'Eval & Funded',         live: true },
            { n: 'Earn2Trade',          s: 'Coming soon',           live: false },
            { n: 'Bulenox',             s: 'Coming soon',           live: false },
            { n: 'FundedNext',          s: 'Coming soon',           live: false },
            { n: 'TX3 Funding',         s: 'Coming soon',           live: false },
            { n: 'Custom plan',         s: 'Build your own template', live: true },
          ].map(b => (
            <div key={b.n} className="gr-card" style={{ padding: 18, opacity: b.live ? 1 : 0.65 }}>
              <div className="gr-row gr-between" style={{ marginBottom: 8 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--surface-2)', color: 'var(--text-mid)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{b.n.split(' ').slice(0, 2).map(w => w[0]).join('')}</div>
                {!b.live && <span className="gr-badge gr-badge--neutral">Soon</span>}
              </div>
              <span className="gr-h3" style={{ fontSize: 14 }}>{b.n}</span>
              <p className="gr-tiny" style={{ marginTop: 4 }}>{b.s}</p>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* CTA */}
    <section style={{ padding: '20px 32px 64px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div style={{
          padding: '40px 40px', background: 'var(--ink)', color: 'var(--bg)', borderRadius: 18,
          position: 'relative', overflow: 'hidden', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 32, flexWrap: 'wrap',
        }}>
          <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse 60% 50% at 100% 0%, ${GR.copper}40, transparent 60%)`, pointerEvents: 'none' }} />
          <div className="gr-col gr-g-2" style={{ position: 'relative', maxWidth: 580 }}>
            <h2 style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.018em', color: 'var(--bg)', margin: 0, lineHeight: 1.2 }}>
              The eval is mechanical. Your discipline doesn't have to be.
            </h2>
            <p className="gr-body" style={{ color: 'rgba(255,255,255,0.7)' }}>First week free. Pass the eval with Guardrail holding the line.</p>
          </div>
          <button style={{ position: 'relative', padding: '12px 22px', borderRadius: 999, background: 'var(--copper)', color: 'white', border: 'none', fontFamily: 'inherit', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
            Open today's session
          </button>
        </div>
      </div>
    </section>

    <MarketingFooter />
  </div>
);

// ── Pricing (redesign with FAQ teaser at the bottom) ──────
const GrPricingFull = () => (
  <div className="gr" style={{ height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
    <MarketingHeader />
    <section style={{ padding: '64px 32px 24px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', textAlign: 'center' }}>
        <span className="gr-label">Pricing</span>
        <h1 style={{ fontSize: 56, lineHeight: 1.08, fontWeight: 600, letterSpacing: '-0.025em', color: 'var(--ink)', margin: '10px 0 0' }}>
          First week free. $25 a month after.
        </h1>
        <p className="gr-body" style={{ fontSize: 17, marginTop: 18, maxWidth: 560, margin: '18px auto 0' }}>
          One plan, monthly billing, cancel any time. Every trader gets the full rule engine.
        </p>
      </div>
    </section>

    <section style={{ padding: '32px 32px 60px' }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        <div className="gr-card" style={{ padding: 40, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48 }}>
          <div>
            <div className="gr-row gr-g-2" style={{ marginBottom: 16 }}>
              <span className="gr-badge gr-badge--copper">7-day free trial</span>
              <span className="gr-badge gr-badge--neutral">No credit card</span>
            </div>
            <div className="gr-row" style={{ alignItems: 'baseline', gap: 10 }}>
              <span className="gr-mono gr-num" style={{ fontSize: 72, fontWeight: 600, letterSpacing: '-0.04em', lineHeight: 1, color: 'var(--ink)' }}>$25</span>
              <span className="gr-small" style={{ color: 'var(--text-mute)' }}>/ month after trial</span>
            </div>
            <span className="gr-tiny" style={{ display: 'block', marginTop: 8 }}>Billed monthly · cancel any time</span>
            <button className="gr-btn gr-btn--ink" style={{ marginTop: 28, padding: '12px 22px', borderRadius: 999, fontSize: 14 }}>Open today's session</button>
            <p className="gr-tiny" style={{ marginTop: 18 }}>
              Yearly billing coming soon · contact <span style={{ color: 'var(--copper)' }}>support@guardrail-trade.com</span> for prop firm team plans.
            </p>
          </div>
          <div>
            <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>Included</span>
            <div className="gr-col" style={{ gap: 8, marginTop: 16 }}>
              {[
                'Live rule evaluation — Allowed, Warning, or Locked',
                'Daily loss limit, max trades, loss-streak stop, session hours',
                'Tradovate read-only connection — trade events vs. your rules',
                'Telegram alerts when a limit triggers',
                'Account-level enforcement · broker-side coming for Daily Loss',
                'Full session history and locked-session log',
                'Templates for Apex, TopStep, MyFundedFutures',
                'Unlimited accounts on the same plan',
              ].map(f => (
                <div key={f} className="gr-row gr-g-3" style={{ padding: '12px 14px', background: 'var(--bg-elev)', borderRadius: 10 }}>
                  <span style={{ color: 'var(--ok)', fontSize: 14, fontWeight: 700 }}>✓</span>
                  <span className="gr-small" style={{ color: 'var(--ink)' }}>{f}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* FAQ teaser */}
        <div style={{ marginTop: 48 }}>
          <span className="gr-label">Pricing questions</span>
          <h2 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.018em', color: 'var(--ink)', margin: '8px 0 18px' }}>The basics</h2>
          <div className="gr-col" style={{ gap: 10 }}>
            {[
              ['Do I need a credit card to start?',     'No. Sign up, connect Tradovate read-only, and Guardrail runs for 7 days. Add a card when you want to keep going.'],
              ['Can I cancel anytime?',                  'Yes. Cancel from Settings → Billing. No prorated refunds, but you keep access until the end of the period.'],
              ['Do you charge per account?',             "No. $25/month covers as many Tradovate accounts as you want to connect."],
              ['Is there a team / prop firm operator plan?', 'Not yet. Email support@guardrail-trade.com if you operate a firm and want early access to multi-trader pricing.'],
            ].map(([q]) => (
              <div key={q} className="gr-card" style={{ padding: '18px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
                <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>{q}</span>
                <span style={{ fontSize: 22, color: 'var(--text-mute)', fontWeight: 300 }}>+</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>

    <MarketingFooter />
  </div>
);

// ── FAQ ───────────────────────────────────────────────────
const GrFAQ = () => {
  const groups = [
    { h: 'The basics', q: [
      ['What does Guardrail actually do?', 'Guardrail watches your live trade events against the rules you set before the session — daily loss, max trades, loss-streak stop, session hours — and shows Allowed, Warning, or Locked in real time.'],
      ['What is Guardian?',                'Guardian is the in-app engine that runs your trading plan during a session. It evaluates each event and locks the session inside the app when a rule breaks.'],
      ['Is Guardrail a trading signal tool?','No. Guardrail is a discipline and risk-control tool. It does not generate signals, recommend trades, or provide financial advice.'],
      ['Does Guardrail block my broker orders?', 'Today Guardrail enforces inside the app at the account level. Broker-side enforcement applies only to Daily Loss, only on supported connections, and only when you explicitly enable it.'],
    ]},
    { h: 'Connections & security', q: [
      ['Which brokers do you support?', 'Tradovate today. Apex, TopStep, and MyFundedFutures via Tradovate. More direct broker connections are on the roadmap.'],
      ['Is my data safe?', 'Read-only by default. We never store your broker password. Connections use broker authorization or scoped tokens you can revoke any time.'],
      ['Can Guardrail trade for me?', "No. Read-only means read-only. Guardrail receives trade events. It cannot place or cancel orders."],
      ['What happens if I disconnect?', 'Your rule configuration is kept. Trade event data tied to that connection is removed.'],
    ]},
    { h: 'Billing & plans', q: [
      ['Do I need a credit card to start?', 'No. Sign up and Guardrail runs free for 7 days. Add a card when you want to keep going.'],
      ['Can I cancel anytime?', 'Yes. Cancel from Settings → Billing. You keep access until the end of the billing period.'],
      ['Do you offer team plans?', 'Not yet. Email support@guardrail-trade.com if you run a prop firm or trading group.'],
    ]},
    { h: 'Rules & enforcement', q: [
      ['What rules are active today?', 'Daily Loss Limit, Max Trades Per Day, Stop After Consecutive Losses, Session Hours. Ten more on the roadmap.'],
      ['What does "Locked" mean?', 'The session is paused inside the app — Guardrail will block the next order submission until the rule resets.'],
      ['Can I customize the limits?', 'Yes. Every rule is configurable per account. Apply a prop-firm template and override anything you need.'],
    ]},
  ];

  return (
    <div className="gr" style={{ height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      <MarketingHeader />
      <section style={{ padding: '64px 32px 32px' }}>
        <div style={{ maxWidth: 880, margin: '0 auto' }}>
          <span className="gr-label">FAQ</span>
          <h1 style={{ fontSize: 56, lineHeight: 1.08, fontWeight: 600, letterSpacing: '-0.025em', color: 'var(--ink)', margin: '8px 0 0' }}>
            Common questions.
          </h1>
          <p className="gr-body" style={{ fontSize: 17, marginTop: 18 }}>
            If you have a question that isn't here, email <span style={{ color: 'var(--copper)' }}>support@guardrail-trade.com</span>.
          </p>
        </div>
      </section>

      <section style={{ padding: '24px 32px 80px' }}>
        <div style={{ maxWidth: 880, margin: '0 auto' }}>
          {groups.map((g, gi) => (
            <div key={g.h} style={{ marginBottom: 36 }}>
              <div className="gr-row gr-g-3" style={{ alignItems: 'baseline', marginBottom: 12 }}>
                <span className="gr-mono" style={{ fontSize: 12, color: 'var(--text-faint)', fontWeight: 500 }}>{String(gi + 1).padStart(2, '0')}</span>
                <h2 className="gr-h1" style={{ fontSize: 22 }}>{g.h}</h2>
              </div>
              <div className="gr-col" style={{ gap: 10 }}>
                {g.q.map(([q, a]) => (
                  <details key={q} className="gr-card" style={{ padding: '20px 24px' }}>
                    <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>
                      {q}
                      <span style={{ fontSize: 22, color: 'var(--text-mute)', fontWeight: 300 }}>+</span>
                    </summary>
                    <p className="gr-body" style={{ marginTop: 12, fontSize: 14.5, lineHeight: 1.6 }}>{a}</p>
                  </details>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
};

// ── Contact support ───────────────────────────────────────
const GrContactSupport = () => (
  <div className="gr" style={{ height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
    <MarketingHeader />
    <section style={{ padding: '64px 32px 32px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 56, alignItems: 'flex-start' }}>
        <div>
          <span className="gr-label">Support</span>
          <h1 style={{ fontSize: 48, lineHeight: 1.08, fontWeight: 600, letterSpacing: '-0.025em', color: 'var(--ink)', margin: '8px 0 0' }}>
            We answer within one business day.
          </h1>
          <p className="gr-body" style={{ fontSize: 16, marginTop: 18, maxWidth: 540 }}>
            Email is fastest. For broker connection issues, attach a screenshot of what you're seeing.
          </p>

          {/* Channels */}
          <div className="gr-col gr-g-3" style={{ marginTop: 32 }}>
            {[
              { ic: 'bell', t: 'Email · fastest', s: 'support@guardrail-trade.com', cta: 'Send email' },
              { ic: 'bolt', t: 'Live chat', s: 'Mon–Fri · 09:00 – 18:00 ET', cta: 'Start chat' },
              { ic: 'shield', t: 'Broker connection issue', s: 'Include your account ref and a screenshot', cta: 'Open ticket' },
            ].map(c => (
              <div key={c.t} className="gr-card" style={{ padding: 18, display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--copper-bg)', color: 'var(--copper)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
                  <GIcon name={c.ic} />
                </div>
                <div className="gr-col gr-g-1 gr-grow">
                  <span className="gr-h3">{c.t}</span>
                  <span className="gr-mono gr-tiny">{c.s}</span>
                </div>
                <button className="gr-btn gr-btn--sm">{c.cta}</button>
              </div>
            ))}
          </div>
        </div>

        {/* Contact form */}
        <div className="gr-card" style={{ padding: 28 }}>
          <span className="gr-h2">Send a message</span>
          <div className="gr-col gr-g-3" style={{ marginTop: 18 }}>
            <div className="gr-row gr-g-2">
              <label className="gr-col gr-g-2" style={{ flex: 1 }}>
                <span className="gr-label">Name</span>
                <input className="gr-input" placeholder="Andrew Naftalovich" />
              </label>
              <label className="gr-col gr-g-2" style={{ flex: 1 }}>
                <span className="gr-label">Email</span>
                <input className="gr-input" placeholder="you@domain.com" />
              </label>
            </div>
            <label className="gr-col gr-g-2">
              <span className="gr-label">Topic</span>
              <div className="gr-input-affix">
                <input className="gr-input" defaultValue="Connection issue" />
                <span className="gr-affix gr-affix--right"><GIcon name="chevD" size="sm" /></span>
              </div>
            </label>
            <label className="gr-col gr-g-2">
              <span className="gr-label">Tradovate account ref · optional</span>
              <input className="gr-input gr-mono" placeholder="TV-XXXXX" />
            </label>
            <label className="gr-col gr-g-2">
              <span className="gr-label">Message</span>
              <textarea rows={6} className="gr-input" style={{ fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical' }} placeholder="What's happening?" />
            </label>
            <button className="gr-btn gr-btn--ink" style={{ borderRadius: 999, padding: '11px 16px', justifyContent: 'center' }}>Send message</button>
            <p className="gr-tiny" style={{ textAlign: 'center', color: 'var(--text-mute)' }}>
              We use your message only to respond. See our <span style={{ color: 'var(--copper)' }}>Privacy Policy</span>.
            </p>
          </div>
        </div>
      </div>
    </section>
    <MarketingFooter />
  </div>
);

// ── Terms ─────────────────────────────────────────────────
const GrTerms = () => (
  <LegalArticle
    kicker="Legal"
    title="Terms of Service"
    updated="May 27, 2026"
    intro="These terms govern your use of guardrail-trade.com and the Guardrail web app. By creating an account, you agree to them. Plain English first, plain English last."
    sections={[
      { h: 'Who we are', p: [
        'Guardrail is operated by Guardrail Inc., a Delaware C-Corp. You can reach us at support@guardrail-trade.com.',
      ]},
      { h: 'What Guardrail is — and is not', p: [
        'Guardrail is a discipline and risk-management tool. It enforces the rules you configure for your own accounts.',
        'Guardrail is not a broker, a trading signal service, an investment adviser, or a robo-advisor. We do not place trades for you, recommend trades, or guarantee outcomes.',
      ]},
      { h: 'Your account', p: [
        'You are responsible for the activity on your account, including keeping your password safe and reviewing connected broker accounts. You must be at least 18 to create an account.',
      ]},
      { h: 'Broker connections & read-only access', p: [
        "Guardrail connects to brokers using read-only access. We receive trade events; we cannot place or cancel orders unless you explicitly enable broker-side enforcement for a supported rule.",
        'You can disconnect a broker at any time from Settings → Accounts.',
      ]},
      { h: 'Subscriptions, trials, billing', p: [
        'Most plans include a free trial. After the trial, billing is monthly to the payment method on file, recurring until you cancel from Settings → Billing.',
        'We do not prorate refunds for the current period. If something is broken on our side, email support and we will sort it out.',
      ]},
      { h: 'Acceptable use', p: ['You agree not to use Guardrail to:'],
        list: [
          'Reverse engineer or attempt to bypass rule enforcement other than by changing your own configuration.',
          'Connect broker accounts you do not own or are not authorised to manage.',
          'Use Guardrail to violate the terms of your broker, prop firm, or any law.',
        ]},
      { h: 'Risk disclosure', p: [
        'Futures trading involves substantial risk of loss and is not suitable for everyone. Using Guardrail does not eliminate risk. You may lose more than your deposit. See our Risk Disclaimer for the full version.',
      ]},
      { h: 'Limitation of liability', p: [
        'To the maximum extent permitted by law, Guardrail Inc. is not liable for trading losses, missed trades, broker outages, or indirect damages. Our total liability is limited to the fees you paid us in the prior 12 months.',
      ]},
      { h: 'Changes', p: [
        'We may update these terms. We will notify you by email and post the updated terms here. Continued use after notice means you accept the update.',
      ]},
      { h: 'Governing law', p: [
        'These terms are governed by the laws of the State of Delaware, USA. Disputes will be resolved in Delaware courts unless your local law requires otherwise.',
      ]},
    ]}
  />
);

// ── Privacy ───────────────────────────────────────────────
const GrPrivacy = () => (
  <LegalArticle
    kicker="Legal"
    title="Privacy Policy"
    updated="May 27, 2026"
    intro="We collect as little as we need. We never sell data. Here's exactly what we collect, why, and how to remove it."
    sections={[
      { h: 'What we collect', p: ['Three buckets:'],
        list: [
          'Account info — your email, name, and password hash. Used to sign you in and contact you.',
          'Broker connection data — trade events, positions, and balance from connected brokers. Used to evaluate your rules in real time.',
          'Usage analytics — page views, feature usage, and performance traces. Used to improve the product.',
        ]},
      { h: 'What we never collect', p: [],
        list: [
          'Broker passwords. We use OAuth or scoped tokens.',
          'Trading strategies, signal logic, or any data you do not feed us.',
          'Browsing activity outside guardrail-trade.com.',
        ]},
      { h: 'Why we collect it', p: [
        'To enforce your rules, deliver alerts, bill you, and improve the product. Nothing else.',
      ]},
      { h: 'Where it lives', p: [
        'Account data is stored in encrypted Postgres on AWS us-east-1. Trade event data is held for 90 days then aggregated. Logs are held for 30 days.',
      ]},
      { h: 'Who we share it with', p: ['Limited list of subprocessors:'],
        list: [
          'AWS — infrastructure.',
          'Stripe — billing.',
          'Postmark — transactional email.',
          'PostHog — product analytics.',
        ]},
      { h: 'Your rights', p: [
        'You can request a data export or full deletion from Settings → Profile, or by emailing support@guardrail-trade.com. We respond within 30 days.',
        'EU and UK residents have the rights granted by GDPR. California residents have the rights granted by CCPA.',
      ]},
      { h: 'Cookies', p: [
        'We use one essential cookie to keep you signed in, and one analytics cookie that you can opt out of in Settings → Privacy.',
      ]},
      { h: 'Children', p: [
        'Guardrail is not for anyone under 18. We do not knowingly collect data from minors. If you are a parent and believe we have collected your child\'s data, email us and we will delete it.',
      ]},
      { h: 'Contact', p: [
        'Email privacy@guardrail-trade.com. We are a small team and we read everything.',
      ]},
    ]}
  />
);

// ── Risk disclaimer ───────────────────────────────────────
const GrRiskDisclaimer = () => (
  <LegalArticle
    kicker="Legal"
    title="Risk Disclaimer"
    updated="May 27, 2026"
    intro="Trading futures is risky. Guardrail does not change that. Please read this carefully before you connect a live account."
    sections={[
      { h: 'Substantial risk of loss', p: [
        'Futures and futures options trading involves substantial risk of loss and is not suitable for every investor. You can lose more than your initial deposit. Past performance is not indicative of future results.',
      ]},
      { h: 'Guardrail is a tool, not an adviser', p: [
        'Guardrail enforces the rules you configure. It is not a broker, financial adviser, or signal service. Nothing in the app constitutes investment advice.',
      ]},
      { h: 'No guarantee of enforcement', p: [
        'Guardrail starts in monitoring mode. Broker-side enforcement applies only to Daily Loss, only on supported connections, and only when you explicitly enable it. App-layer locks block order submission inside Guardrail; they do not modify or cancel orders that are already live at the broker.',
        'Network outages, broker downtime, or API issues can prevent Guardrail from receiving events or executing locks in time.',
      ]},
      { h: 'Personal responsibility', p: [
        'You are responsible for every trade. Configuring Guardrail does not transfer that responsibility to us, your broker, or your prop firm.',
      ]},
      { h: 'Prop firm rules', p: [
        'Prop firms set their own rules. Our templates are provided as a convenience and may not exactly match your firm\'s current evaluation. Always confirm with the firm before relying on a template for a payout-critical session.',
      ]},
      { h: 'Hypothetical and simulated results', p: [
        'Any examples, demos, or screenshots on this site use illustrative numbers and do not reflect actual trading results. Hypothetical performance has many inherent limitations.',
      ]},
      { h: 'Speak to a professional', p: [
        'If you are unsure whether futures trading is appropriate for your situation, consult a licensed financial professional.',
      ]},
    ]}
  />
);

Object.assign(window, {
  GrFeatures, GrHowItWorks, GrPropFirms, GrPricingFull, GrFAQ,
  GrContactSupport, GrTerms, GrPrivacy, GrRiskDisclaimer, LegalArticle,
});
