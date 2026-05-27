// Site canvas — adds the full marketing/auth/legal set.

const GrSite = () => (
  <DesignCanvas
    title="Guardrail · The whole site"
    subtitle="Marketing · auth · onboarding · app · settings · legal. One design system across everything."
  >
    {/* MARKETING */}
    <DCSection
      id="marketing"
      title="Marketing · public site"
      subtitle="Pre-login pages. Real Guardrail copy."
    >
      <DCArtboard id="landing"     label="Landing"       width={1440} height={3600}><GrLanding /></DCArtboard>
      <DCArtboard id="features"    label="Features"      width={1440} height={1800}><GrFeatures /></DCArtboard>
      <DCArtboard id="howitworks"  label="How it works"  width={1440} height={1800}><GrHowItWorks /></DCArtboard>
      <DCArtboard id="propfirms"   label="For prop firms" width={1440} height={1800}><GrPropFirms /></DCArtboard>
      <DCArtboard id="pricing"     label="Pricing"       width={1440} height={1600}><GrPricingFull /></DCArtboard>
      <DCArtboard id="faq"         label="FAQ"           width={1440} height={2000}><GrFAQ /></DCArtboard>
      <DCArtboard id="contact"     label="Contact support" width={1440} height={1200}><GrContactSupport /></DCArtboard>
    </DCSection>

    {/* LEGAL */}
    <DCSection
      id="legal"
      title="Legal"
      subtitle="Terms, Privacy, Risk Disclaimer. Shared article shell."
    >
      <DCArtboard id="terms"       label="Terms of Service"  width={1440} height={2400}><GrTerms /></DCArtboard>
      <DCArtboard id="privacy"     label="Privacy Policy"    width={1440} height={2400}><GrPrivacy /></DCArtboard>
      <DCArtboard id="risk"        label="Risk Disclaimer"   width={1440} height={2200}><GrRiskDisclaimer /></DCArtboard>
    </DCSection>

    {/* AUTH */}
    <DCSection
      id="auth"
      title="Auth"
      subtitle="Sign in, sign up, password reset, email verification, 404."
    >
      <DCArtboard id="signin"  label="Sign in"          width={1440} height={840}><GrSignIn /></DCArtboard>
      <DCArtboard id="signup"  label="Sign up"          width={1440} height={900}><GrSignUp /></DCArtboard>
      <DCArtboard id="forgot"  label="Forgot password"  width={1440} height={840}><GrForgotPassword /></DCArtboard>
      <DCArtboard id="verify"  label="Verify email"     width={1440} height={840}><GrVerifyEmail /></DCArtboard>
      <DCArtboard id="404"     label="404"              width={1440} height={840}><Gr404 /></DCArtboard>
    </DCSection>

    {/* ONBOARDING */}
    <DCSection
      id="onboarding"
      title="Onboarding · first-time setup"
      subtitle="Four-step flow."
    >
      <DCArtboard id="ob-connect"  label="1 · Connect a broker"  width={1440} height={1080}><GrOnboarding /></DCArtboard>
      <DCArtboard id="ob-template" label="2 · Pick a template"   width={1440} height={1080}><GrOnboardTemplate /></DCArtboard>
      <DCArtboard id="ob-invite"   label="3 · Invite team"       width={1440} height={1080}><GrOnboardInvite /></DCArtboard>
      <DCArtboard id="ob-welcome"  label="4 · You're protected"  width={1440} height={1080}><GrOnboardWelcome /></DCArtboard>
    </DCSection>

    {/* APP CORE */}
    <DCSection
      id="app"
      title="App · authenticated"
      subtitle="Day-to-day surfaces. Shared shell."
    >
      <DCArtboard id="dashboard"     label="Dashboard"                  width={1440} height={1240}><GrDashboard /></DCArtboard>
      <DCArtboard id="plan-overview" label="Trading Plan · Overview"    width={1440} height={1180}><GrOverview /></DCArtboard>
      <DCArtboard id="plan-editor"   label="Trading Plan · Editor"      width={1440} height={1180}><GrEditor /></DCArtboard>
      <DCArtboard id="trades"        label="Trades · Log + filters"      width={1440} height={1180}><GrTrades /></DCArtboard>
      <DCArtboard id="accounts"      label="Accounts · Manage"          width={1440} height={1280}><GrAccounts /></DCArtboard>
      <DCArtboard id="alerts"        label="Alerts · Feed"              width={1440} height={1080}><GrAlerts /></DCArtboard>
    </DCSection>

    {/* PLAN STATES */}
    <DCSection
      id="plan-states"
      title="Trading Plan · States"
      subtitle="default · unsaved · locked · account picker."
    >
      <DCArtboard id="plan-unsaved" label="Editor · Unsaved" width={1440} height={1180}><GrEditor mode="unsaved" /></DCArtboard>
      <DCArtboard id="plan-locked"  label="Editor · Locked"  width={1440} height={1180}><GrEditor mode="locked" /></DCArtboard>
      <DCArtboard id="plan-picker"  label="Account picker open" width={1440} height={1180}><GrOverview accountSelectorOpen /></DCArtboard>
    </DCSection>

    {/* SETTINGS */}
    <DCSection
      id="settings"
      title="Settings · all sub-pages"
    >
      <DCArtboard id="set-profile"  label="Profile"               width={1440} height={1080}><GrSettings /></DCArtboard>
      <DCArtboard id="set-notifs"   label="Notifications"         width={1440} height={1320}><GrSettingsNotifs /></DCArtboard>
      <DCArtboard id="set-tmpls"    label="Templates"             width={1440} height={1080}><GrSettingsTemplates /></DCArtboard>
      <DCArtboard id="set-billing"  label="Billing & plan"        width={1440} height={1240}><GrSettingsBilling /></DCArtboard>
      <DCArtboard id="set-team"     label="Team & access"         width={1440} height={1180}><GrSettingsTeam /></DCArtboard>
      <DCArtboard id="set-api"      label="API & integrations"    width={1440} height={1360}><GrSettingsApi /></DCArtboard>
      <DCArtboard id="set-security" label="Security"              width={1440} height={1180}><GrSettingsSecurity /></DCArtboard>
      <DCArtboard id="set-audit"    label="Audit log"             width={1440} height={1080}><GrSettingsAudit /></DCArtboard>
    </DCSection>

    {/* MOBILE */}
    <DCSection id="mobile" title="Mobile">
      <DCArtboard id="m-overview" label="Plan · Overview" width={390} height={844}><GrMobileOverview /></DCArtboard>
      <DCArtboard id="m-editor"   label="Plan · Editor"   width={390} height={844}><GrMobileEditor /></DCArtboard>
    </DCSection>

    {/* COMPONENTS */}
    <DCSection id="components" title="Components · state reference">
      <DCArtboard id="states" label="All component states" width={1440} height={1100}><StateShowcase /></DCArtboard>
    </DCSection>
  </DesignCanvas>
);

ReactDOM.createRoot(document.getElementById('root')).render(<GrSite />);
