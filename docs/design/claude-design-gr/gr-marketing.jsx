// Guardrail · marketing site. Real content from guardrail-trade.com.
// Warm cream + copper, Geist sans, serif reserved for the hero h1 only.

// ── Shared marketing chrome ─────────────────────────────────
const MarketingHeader = () => (
  <header style={{
    position: 'sticky', top: 0, zIndex: 20,
    background: 'rgba(243,236,224,0.82)', backdropFilter: 'blur(14px)',
    borderBottom: '1px solid var(--border)',
  }}>
    <div style={{ maxWidth: 1240, margin: '0 auto', padding: '0 32px', height: 64, display: 'flex', alignItems: 'center' }}>
      <div className="gr-row gr-g-3" style={{ alignItems: 'center' }}>
        <GrLogo size={28} />
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', letterSpacing: '0.2em' }}>GUARDRAIL</span>
      </div>
      <div className="gr-grow" />
      <div className="gr-row gr-g-4">
        <span style={{ fontSize: 13.5, color: 'var(--text-mid)', cursor: 'pointer' }}>Log out</span>
        <button className="gr-btn gr-btn--ink" style={{ borderRadius: 999, padding: '10px 18px' }}>Go to dashboard</button>
      </div>
    </div>
  </header>
);

const MarketingFooter = () => (
  <footer style={{ borderTop: '1px solid var(--border)', background: 'var(--bg)' }}>
    <div style={{ maxWidth: 1240, margin: '0 auto', padding: '36px 32px 32px' }}>
      <p className="gr-small" style={{ color: 'var(--text-mute)', textAlign: 'center', maxWidth: 920, margin: '0 auto', lineHeight: 1.6 }}>
        Guardrail is a trading-discipline and risk-control tool, not financial advice. Guardrail starts in monitoring mode; broker-side enforcement applies only to Daily Loss, only on supported connections, and only when you explicitly enable it. Trading futures carries a substantial risk of loss.
      </p>

      <div style={{ borderTop: '1px solid var(--border-sub)', marginTop: 28, paddingTop: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <span className="gr-tiny" style={{ maxWidth: 520 }}>
          Guardrail is a discipline and risk-management tool. It does not provide financial advice or guarantee trading results. Trading involves substantial risk of loss.
        </span>
        <div className="gr-row gr-g-5">
          {['Terms', 'Privacy', 'Risk Disclaimer', 'Contact Support'].map(l => (
            <span key={l} className="gr-tiny" style={{ cursor: 'pointer' }}>{l}</span>
          ))}
        </div>
      </div>
    </div>
  </footer>
);

// ── Landing ────────────────────────────────────────────────
const GrLanding = () => (
  <div className="gr" style={{ height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
    <MarketingHeader />

    {/* HERO — bordered card on cream */}
    <section style={{ padding: '40px 32px 24px' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto' }}>
        <div className="gr-card" style={{ padding: '64px 64px 60px', maxWidth: 1080 }}>
          <span style={{ display: 'block', fontSize: 12, fontWeight: 600, letterSpacing: '0.18em', color: 'var(--copper)', textTransform: 'uppercase' }}>
            For futures & prop firm traders
          </span>
          <h1 style={{
            fontFamily: "'Geist', sans-serif",
            fontSize: 56, lineHeight: 1.1, fontWeight: 600, letterSpacing: '-0.025em',
            color: 'var(--ink)', margin: '24px 0 0',
            maxWidth: 880,
          }}>
            You know your rules.<br />Guardrail makes them hold.
          </h1>
          <p className="gr-body" style={{ fontSize: 17, lineHeight: 1.55, maxWidth: 760, marginTop: 24 }}>
            Set your daily loss, max trades, session hours, and loss-streak rules before the open. When pressure hits, Guardrail keeps the session inside those limits.
          </p>
          <p className="gr-small" style={{ marginTop: 22, color: 'var(--text-mute)' }}>
            Account-level monitoring · Broker enforcement when supported and verified
          </p>
          <button className="gr-btn gr-btn--ink" style={{ marginTop: 36, padding: '12px 22px', borderRadius: 999, fontSize: 14 }}>
            Open today's session
          </button>
        </div>
      </div>
    </section>

    {/* THE REAL PROBLEM */}
    <section style={{ padding: '60px 32px' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto' }}>
        <span className="gr-label">The real problem</span>
        <h2 style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)', margin: '8px 0 0', lineHeight: 1.2 }}>
          You know your rules. <span style={{ color: 'var(--text-faint)' }}>You break them anyway.</span>
        </h2>
        <p className="gr-body" style={{ marginTop: 16, maxWidth: 760 }}>
          Every futures trader sets rules before the market opens. Then the session starts, pressure builds, and the rules you made when thinking clearly are the ones you break.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginTop: 36 }}>
          {[
            { t: 'The revenge trade',  d: 'Down $180. Your daily limit is $200. You size up to make it back. Now the day is gone.' },
            { t: 'The one more trade', d: 'You said five trades max. The sixth one looks perfect. Then comes the seventh.' },
            { t: 'The oversized entry',d: 'You triple size because the setup feels obvious. One miss wipes out three good days.' },
          ].map(c => (
            <div key={c.t} className="gr-card" style={{ padding: 28 }}>
              <h3 className="gr-h2" style={{ fontSize: 18 }}>{c.t}</h3>
              <p className="gr-body" style={{ marginTop: 12 }}>{c.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* HOW IT WORKS */}
    <section style={{ padding: '40px 32px 60px' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto' }}>
        <span className="gr-label">How it works</span>
        <h2 style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)', margin: '8px 0 0', lineHeight: 1.2 }}>
          Three steps. One operating loop.
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginTop: 36 }}>
          {[
            { n: '01', tag: 'Premarket', tagTone: 'neutral', t: 'Set your trading plan',
              d: 'Daily loss limit, max trades, session hours, loss-streak stop. Set them once before the open. Guardrail holds them across every session.' },
            { n: '02', tag: 'Live',      tagTone: 'ok',      t: 'Trade with live rule monitoring',
              d: 'Every trade event is evaluated against your rules. You see Allowed, Warning, or Locked — before the damage compounds.' },
            { n: '03', tag: 'Locked',    tagTone: 'bad',     t: 'Session locks when a rule breaks',
              d: 'When a limit is hit, the session locks inside the app. You see which rule fired and when the reset window opens. Account-level monitoring today.' },
          ].map(c => (
            <div key={c.n} className="gr-card" style={{ padding: 28 }}>
              <div className="gr-row gr-between" style={{ alignItems: 'center' }}>
                <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 28, fontWeight: 500, color: 'var(--text-faint)', letterSpacing: '-0.02em' }}>{c.n}</span>
                <span className={`gr-badge gr-badge--${c.tagTone}`} style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 10.5, fontWeight: 600 }}>{c.tag}</span>
              </div>
              <h3 className="gr-h2" style={{ fontSize: 18, marginTop: 36 }}>{c.t}</h3>
              <p className="gr-body" style={{ marginTop: 10 }}>{c.d}</p>
            </div>
          ))}
        </div>

        <a style={{ display: 'inline-block', marginTop: 28, fontSize: 14, color: 'var(--text-mid)', cursor: 'pointer' }}>
          Session states and enforcement scope →
        </a>
      </div>
    </section>

    {/* RULE ENGINE */}
    <section style={{ padding: '40px 32px 60px' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 48, alignItems: 'flex-start' }}>
          <div>
            <span className="gr-label">Rule engine</span>
            <h2 style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)', margin: '8px 0 0', lineHeight: 1.2 }}>
              Four active rules. Ten more on the way.
            </h2>
            <p className="gr-body" style={{ marginTop: 16, maxWidth: 580 }}>
              Loss limits, trade caps, session windows, and news locks — evaluated in real time against every trade event.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 32, maxWidth: 640 }}>
              {[
                'Daily Loss Limit',
                'Max Trades Per Day',
                'Stop After Consecutive Losses',
                'Session Hours',
              ].map(r => (
                <div key={r} className="gr-card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span className="gr-dot gr-dot-lg" style={{ color: 'var(--ok)' }} />
                  <span style={{ fontSize: 14.5, fontWeight: 500, color: 'var(--ink)' }}>{r}</span>
                </div>
              ))}
            </div>

            <a style={{ display: 'inline-block', marginTop: 28, fontSize: 14, color: 'var(--text-mid)', cursor: 'pointer' }}>
              View all 14 rules — Active, Partial, and Coming Soon →
            </a>
          </div>

          {/* Trading plan card */}
          <div className="gr-card" style={{ padding: 22 }}>
            <span className="gr-label">Trading plan</span>
            <div className="gr-col" style={{ marginTop: 14, gap: 0 }}>
              {[
                ['Daily loss limit', '$500'],
                ['Max trades', '5 / day'],
                ['Loss streak stop', '3 losses'],
                ['Session hours', '9:30 – 12:00'],
              ].map(([l, v], i, arr) => (
                <div key={l} className="gr-row gr-between" style={{
                  padding: '12px 0',
                  borderBottom: i < arr.length - 1 ? '1px solid var(--border-sub)' : 'none',
                }}>
                  <span className="gr-small" style={{ color: 'var(--text-mid)' }}>{l}</span>
                  <span className="gr-mono gr-num" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{v}</span>
                </div>
              ))}
            </div>
            <div className="gr-row gr-g-2" style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-sub)' }}>
              <span className="gr-dot" style={{ color: 'var(--ok)' }} />
              <span className="gr-tiny">4 rules active · session live</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    {/* PROP FIRM PRESSURE */}
    <section style={{ padding: '40px 32px 60px' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto' }}>
        <div style={{
          background: 'var(--surface-warm)',
          border: '1px solid var(--copper-bd)',
          borderRadius: 18,
          padding: '40px 36px',
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.18em', color: 'var(--copper)', textTransform: 'uppercase' }}>
            Prop firm pressure
          </span>
          <h2 style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)', margin: '8px 0 0', lineHeight: 1.2 }}>
            Prop firm rules do not forgive emotional trades.
          </h2>
          <p className="gr-body" style={{ marginTop: 14, maxWidth: 720 }}>
            One rule break can cost the challenge, the funded account, or the payout.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginTop: 28 }}>
            {[
              { t: 'Protect the challenge',     d: 'Daily drawdown and max trade rules are not suggestions during an evaluation. Guardrail holds them like they are.' },
              { t: 'Protect the funded account',d: 'When pressure rises, Guardrail keeps the account inside the limits you chose — before emotional decisions override them.' },
              { t: 'Protect payout days',       d: 'When the goal is reached, Guardrail helps stop the giveback trade. Lock in the good day.' },
            ].map(c => (
              <div key={c.t} className="gr-card" style={{ padding: 24 }}>
                <h3 className="gr-h2" style={{ fontSize: 17 }}>{c.t}</h3>
                <p className="gr-body" style={{ marginTop: 12 }}>{c.d}</p>
              </div>
            ))}
          </div>

          <a style={{ display: 'inline-block', marginTop: 28, fontSize: 14, color: 'var(--copper)', fontWeight: 500, cursor: 'pointer' }}>
            Built for prop firms: evaluation, funded, and payout protection →
          </a>
        </div>
      </div>
    </section>

    {/* YOUR DATA, YOUR CONTROL — dark card */}
    <section style={{ padding: '40px 32px 60px' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto' }}>
        <div style={{
          background: 'var(--ink)', color: 'var(--bg)',
          borderRadius: 18, padding: '48px 40px',
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.18em', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase' }}>
            Your data, your control
          </span>
          <h2 style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--bg)', margin: '8px 0 36px', lineHeight: 1.2 }}>
            Read-only first. No trading credentials.
          </h2>

          <div className="gr-col" style={{ gap: 18, maxWidth: 920 }}>
            {[
              'Read-only connection — Guardrail receives trade events. It cannot place or cancel orders.',
              'No broker password stored — connections use broker authorization or scoped tokens.',
              'Disconnect any time from account settings. Rule configuration is kept, data is not.',
            ].map(l => (
              <div key={l} className="gr-row gr-g-3" style={{ alignItems: 'flex-start' }}>
                <span style={{ color: 'var(--ok)', fontSize: 18, fontWeight: 700, lineHeight: 1, marginTop: 2 }}>✓</span>
                <span style={{ fontSize: 15, lineHeight: 1.55, color: 'rgba(255,255,255,0.92)' }}>{l}</span>
              </div>
            ))}
          </div>

          <a style={{ display: 'inline-block', marginTop: 28, fontSize: 14, color: 'rgba(255,255,255,0.55)', cursor: 'pointer' }}>
            Security & read-only access details →
          </a>
        </div>
      </div>
    </section>

    {/* PRICING */}
    <section style={{ padding: '40px 32px 60px' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto' }}>
        <div className="gr-card" style={{ padding: 40, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48 }}>
          <div>
            <span className="gr-label">Pricing</span>
            <h2 style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)', margin: '8px 0 0', lineHeight: 1.2 }}>
              First week free.
            </h2>
            <p className="gr-body" style={{ marginTop: 16, maxWidth: 460 }}>
              Full access for 7 days — no credit card required. Then $25/month.
            </p>

            <div className="gr-row" style={{ alignItems: 'baseline', gap: 10, marginTop: 24 }}>
              <span className="gr-mono gr-num" style={{ fontSize: 56, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1, color: 'var(--ink)' }}>$25</span>
              <span className="gr-small" style={{ color: 'var(--text-mute)' }}>/ month after trial</span>
            </div>
            <span className="gr-tiny" style={{ display: 'block', marginTop: 8 }}>Billed monthly. Cancel any time.</span>

            <button className="gr-btn gr-btn--ink" style={{ marginTop: 28, padding: '12px 22px', borderRadius: 999, fontSize: 14 }}>
              Open today's session
            </button>
          </div>

          <div>
            <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>Included:</span>
            <div className="gr-col" style={{ gap: 8, marginTop: 16 }}>
              {[
                'Live rule evaluation — Allowed, Warning, or Locked',
                'Daily loss limit, max trades, loss-streak stop, session hours',
                'Tradovate read-only connection — trade events vs. your rules',
                'Telegram alerts when a limit triggers',
              ].map(f => (
                <div key={f} className="gr-row gr-g-3" style={{ padding: '12px 14px', background: 'var(--bg-elev)', borderRadius: 10 }}>
                  <span style={{ color: 'var(--ok)', fontSize: 14, fontWeight: 700, lineHeight: 1 }}>✓</span>
                  <span className="gr-small" style={{ color: 'var(--ink)' }}>{f}</span>
                </div>
              ))}
            </div>
            <a style={{ display: 'inline-block', marginTop: 18, fontSize: 13.5, color: 'var(--text-mid)', cursor: 'pointer' }}>
              All included features & cost calculator →
            </a>
          </div>
        </div>
      </div>
    </section>

    {/* FAQ */}
    <section style={{ padding: '40px 32px 60px' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto' }}>
        <span className="gr-label">FAQ</span>
        <h2 style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)', margin: '8px 0 28px', lineHeight: 1.2 }}>
          Common questions.
        </h2>

        <div className="gr-col" style={{ gap: 10 }}>
          {[
            ['What does Guardrail actually do?', 'Guardrail watches your live trade events against the rules you set before the session — daily loss, max trades, loss-streak stop, and session hours — and shows Allowed, Warning, or Locked in real time.'],
            ['What is Guardian?',                'Guardian is the in-app component that runs your trading plan during a session. It evaluates each event and locks the session inside the app when a rule breaks.'],
            ['Is Guardrail a trading signal tool?','No. Guardrail is a discipline and risk-control tool. It does not generate signals, recommend trades, or provide financial advice.'],
            ['Does Guardrail block my broker orders?', 'Today, Guardrail enforces inside the app at the account level. Broker-side enforcement applies only to Daily Loss, only on supported connections, and only when you explicitly enable it.'],
          ].map(([q]) => (
            <div key={q} className="gr-card" style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
              <span style={{ fontSize: 16, fontWeight: 500, color: 'var(--ink)' }}>{q}</span>
              <span style={{ fontSize: 22, color: 'var(--text-mute)', lineHeight: 1, fontWeight: 300 }}>+</span>
            </div>
          ))}
        </div>

        <a style={{ display: 'inline-block', marginTop: 22, fontSize: 14, color: 'var(--text-mid)', cursor: 'pointer' }}>
          Read all 12 questions →
        </a>
      </div>
    </section>

    {/* FINAL CTA */}
    <section style={{ padding: '0 32px 60px' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto' }}>
        <div className="gr-card" style={{
          padding: '40px 44px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 32, flexWrap: 'wrap',
        }}>
          <div className="gr-col gr-g-2" style={{ maxWidth: 720 }}>
            <h2 style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0, lineHeight: 1.15 }}>
              Your rules, enforced. Starting now.
            </h2>
            <p className="gr-body">Configure your limits. Run today's session. Let Guardrail lock the moment a rule breaks.</p>
          </div>
          <button className="gr-btn gr-btn--ink" style={{ padding: '12px 22px', borderRadius: 999, fontSize: 14 }}>
            Open today's session
          </button>
        </div>
      </div>
    </section>

    <MarketingFooter />
  </div>
);

// ── Pricing (kept simple for now — uses landing pricing block as canonical source) ──
const GrPricing = () => (
  <div className="gr" style={{ height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
    <MarketingHeader />
    <section style={{ padding: '40px 32px' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto' }}>
        <span className="gr-label">Pricing</span>
        <h1 style={{ fontSize: 44, fontWeight: 600, letterSpacing: '-0.025em', color: 'var(--ink)', margin: '8px 0 0', lineHeight: 1.15 }}>
          First week free. $25 a month after.
        </h1>
        <p className="gr-body" style={{ marginTop: 16, maxWidth: 640 }}>
          One plan, monthly billing, cancel any time. We don't run tiers — every trader gets the full rule engine.
        </p>

        <div className="gr-card" style={{ padding: 40, marginTop: 32, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, maxWidth: 980 }}>
          <div>
            <span className="gr-label">Guardrail</span>
            <div className="gr-row" style={{ alignItems: 'baseline', gap: 10, marginTop: 12 }}>
              <span className="gr-mono gr-num" style={{ fontSize: 64, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1, color: 'var(--ink)' }}>$25</span>
              <span className="gr-small" style={{ color: 'var(--text-mute)' }}>/ month after 7-day trial</span>
            </div>
            <span className="gr-tiny" style={{ display: 'block', marginTop: 8 }}>Billed monthly · cancel any time · no credit card to start</span>
            <button className="gr-btn gr-btn--ink" style={{ marginTop: 28, padding: '12px 22px', borderRadius: 999, fontSize: 14 }}>
              Open today's session
            </button>
          </div>
          <div>
            <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>Included</span>
            <div className="gr-col" style={{ gap: 8, marginTop: 16 }}>
              {[
                'Live rule evaluation — Allowed, Warning, or Locked',
                'Daily loss limit, max trades, loss-streak stop, session hours',
                'Tradovate read-only connection — trade events vs. your rules',
                'Telegram alerts when a limit triggers',
                'Account-level enforcement today · broker-side coming for Daily Loss',
                'Full session history and locked-session log',
              ].map(f => (
                <div key={f} className="gr-row gr-g-3" style={{ padding: '12px 14px', background: 'var(--bg-elev)', borderRadius: 10 }}>
                  <span style={{ color: 'var(--ok)', fontSize: 14, fontWeight: 700, lineHeight: 1 }}>✓</span>
                  <span className="gr-small" style={{ color: 'var(--ink)' }}>{f}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
    <MarketingFooter />
  </div>
);

// ── Sign up — same direction as sign in, simpler right panel ──
const GrSignUp = () => (
  <div className="gr" style={{ display: 'flex', alignItems: 'stretch', height: '100%' }}>
    <div style={{ width: '52%', display: 'flex', flexDirection: 'column', padding: '36px 56px', overflow: 'auto' }}>
      <div className="gr-row gr-g-3" style={{ alignItems: 'center' }}>
        <GrLogo size={28} />
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', letterSpacing: '0.2em' }}>GUARDRAIL</span>
      </div>

      <div className="gr-col" style={{ flex: 1, justifyContent: 'center', maxWidth: 440, width: '100%', alignSelf: 'center', padding: '32px 0' }}>
        <span className="gr-label">Start free</span>
        <h1 style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.022em', color: 'var(--ink)', margin: '8px 0 0', lineHeight: 1.15 }}>
          Create your Guardrail account.
        </h1>
        <p className="gr-body" style={{ marginTop: 12, marginBottom: 28 }}>7 days free. Then $25 / month. No credit card to start.</p>

        <div className="gr-col gr-g-3">
          <label className="gr-col gr-g-2">
            <span className="gr-label">Email</span>
            <input className="gr-input" type="email" placeholder="you@domain.com" />
          </label>
          <label className="gr-col gr-g-2">
            <span className="gr-label">Password</span>
            <input className="gr-input" type="password" placeholder="At least 10 characters" />
          </label>
          <button className="gr-btn gr-btn--ink" style={{ padding: '12px 14px', marginTop: 8, fontSize: 14, justifyContent: 'center', borderRadius: 999 }}>
            Create account
          </button>
        </div>

        <p className="gr-tiny" style={{ marginTop: 28, textAlign: 'center' }}>
          Already have an account? <span style={{ color: 'var(--copper)', fontWeight: 500 }}>Sign in</span>
        </p>
      </div>
    </div>

    <div style={{
      width: '48%', background: 'var(--ink)', color: 'var(--bg)',
      padding: '56px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse 60% 40% at 80% 20%, ${GR.copper}33, transparent 60%)` }} />
      <span className="gr-label" style={{ color: 'rgba(255,255,255,0.5)', position: 'relative' }}>What you get</span>
      <div style={{ position: 'relative' }}>
        <h2 style={{ fontSize: 26, lineHeight: 1.3, fontWeight: 500, color: 'var(--bg)', margin: 0, letterSpacing: '-0.01em' }}>
          7 days of Guardrail — every active rule, every Telegram alert, your Tradovate connection. Then $25 a month.
        </h2>
        <div className="gr-col gr-g-3" style={{ marginTop: 28 }}>
          {[
            'Daily loss limit, max trades, loss-streak stop',
            'Session hours · locked-session log',
            'Tradovate read-only connection',
            'Telegram alerts when a limit triggers',
          ].map(f => (
            <span key={f} className="gr-row gr-g-3" style={{ fontSize: 14, color: 'rgba(255,255,255,0.9)' }}>
              <span style={{ color: 'var(--copper)', fontWeight: 700 }}>✓</span> {f}
            </span>
          ))}
        </div>
      </div>
      <span className="gr-tiny" style={{ color: 'rgba(255,255,255,0.55)', position: 'relative' }}>
        Read-only connection · no broker credentials stored
      </span>
    </div>
  </div>
);

// Compact auth shell for forgot / verify / 404 (keep existing minimal styling)
const AuthShell = ({ children }) => (
  <div className="gr" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
    <header style={{ padding: '24px 32px', borderBottom: '1px solid var(--border)' }}>
      <div className="gr-row gr-g-3" style={{ alignItems: 'center', maxWidth: 1180, margin: '0 auto' }}>
        <GrLogo size={28} />
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', letterSpacing: '0.2em' }}>GUARDRAIL</span>
      </div>
    </header>
    <div className="gr-col" style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: '48px 32px' }}>
      {children}
    </div>
  </div>
);

const GrForgotPassword = () => (
  <AuthShell>
    <div style={{ maxWidth: 440, width: '100%' }}>
      <div style={{ width: 44, height: 44, borderRadius: 11, background: 'var(--copper-bg)', color: 'var(--copper)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
        <GIcon name="lock" size="lg" />
      </div>
      <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.018em', color: 'var(--ink)', margin: 0 }}>Reset your password</h1>
      <p className="gr-body" style={{ marginTop: 8, marginBottom: 24 }}>Enter the email associated with your Guardrail account and we'll send you a magic link.</p>
      <div className="gr-col gr-g-3">
        <label className="gr-col gr-g-2">
          <span className="gr-label">Email</span>
          <input className="gr-input" defaultValue="andrew@guardrail.io" />
        </label>
        <button className="gr-btn gr-btn--ink" style={{ padding: '11px 14px', justifyContent: 'center', borderRadius: 999 }}>Send reset link</button>
        <button className="gr-btn gr-btn--ghost" style={{ justifyContent: 'center', color: 'var(--text-mid)' }}>← Back to sign in</button>
      </div>
    </div>
  </AuthShell>
);

const GrVerifyEmail = () => (
  <AuthShell>
    <div style={{ maxWidth: 460, width: '100%', textAlign: 'center' }}>
      <div style={{ width: 56, height: 56, borderRadius: 14, background: 'var(--copper-bg)', color: 'var(--copper)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
        <GIcon name="bell" size="xl" />
      </div>
      <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.018em', color: 'var(--ink)', margin: 0 }}>Check your inbox</h1>
      <p className="gr-body" style={{ marginTop: 10, marginBottom: 28 }}>
        We sent a verification link to <span className="gr-mono" style={{ color: 'var(--ink)' }}>andrew@guardrail.io</span>. Click it to finish setting up your account.
      </p>
      <div className="gr-card-soft" style={{ padding: 18, marginBottom: 24, textAlign: 'left' }}>
        <div className="gr-row gr-g-3">
          <GIcon name="info" style={{ color: 'var(--text-mid)', marginTop: 2 }} />
          <div className="gr-col gr-g-1 gr-grow">
            <span className="gr-h3">Didn't get it?</span>
            <span className="gr-small">Check your spam folder or resend below. Magic links expire after 15 minutes.</span>
          </div>
        </div>
      </div>
      <div className="gr-row gr-g-2" style={{ justifyContent: 'center' }}>
        <button className="gr-btn gr-btn--ink" style={{ borderRadius: 999 }}><GIcon name="refresh" size="sm" /> Resend link</button>
        <button className="gr-btn">Change email</button>
      </div>
    </div>
  </AuthShell>
);

const Gr404 = () => (
  <AuthShell>
    <div style={{ maxWidth: 520, textAlign: 'center' }}>
      <span className="gr-mono gr-num" style={{ fontSize: 96, fontWeight: 600, lineHeight: 1, color: 'var(--copper)', letterSpacing: '-0.05em', display: 'block' }}>404</span>
      <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.018em', color: 'var(--ink)', margin: '12px 0 0' }}>This rule doesn't exist.</h1>
      <p className="gr-body" style={{ marginTop: 10, marginBottom: 28 }}>The page you're looking for moved, was renamed, or never made it past planning.</p>
      <div className="gr-row gr-g-2" style={{ justifyContent: 'center' }}>
        <button className="gr-btn"><GIcon name="home" size="sm" /> Back to dashboard</button>
        <button className="gr-btn gr-btn--ink" style={{ borderRadius: 999 }}>Talk to support</button>
      </div>
    </div>
  </AuthShell>
);

Object.assign(window, { GrLanding, GrPricing, GrSignUp, GrForgotPassword, GrVerifyEmail, Gr404 });
