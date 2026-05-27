// Guardrail · final design canvas assembly.

const GrApp = () => (
  <DesignCanvas
    title="Guardrail · Trading Plan"
    subtitle="Production-ready design pass — warm cream + copper, real Guardrail rules, honest enforcement labels, full state coverage."
  >
    <DCSection
      id="desktop"
      title="Desktop"
      subtitle="The two modes — Overview (no rule selected, all cards) and Editor (a rule is selected, focused config). Both share the same shell, account selector, and rule list."
    >
      <DCArtboard id="overview" label="Overview · all rules at a glance" width={1440} height={1180}>
        <GrOverview />
      </DCArtboard>
      <DCArtboard id="editor" label="Editor · Daily Loss Limit (broker-backed)" width={1440} height={1180}>
        <GrEditor />
      </DCArtboard>
      <DCArtboard id="editor-unsaved" label="Editor · Unsaved changes" width={1440} height={1180}>
        <GrEditor mode="unsaved" />
      </DCArtboard>
      <DCArtboard id="editor-locked" label="Editor · Locked session (read-only)" width={1440} height={1180}>
        <GrEditor mode="locked" />
      </DCArtboard>
      <DCArtboard id="account-picker" label="Overview · Account picker open" width={1440} height={1180}>
        <GrOverview accountSelectorOpen />
      </DCArtboard>
    </DCSection>

    <DCSection
      id="mobile"
      title="Mobile"
      subtitle="Same product, single column. Bottom tab bar replaces the side rail. Editor uses a persistent bottom save bar."
    >
      <DCArtboard id="m-overview" label="Mobile · Overview" width={390} height={844}>
        <GrMobileOverview />
      </DCArtboard>
      <DCArtboard id="m-editor" label="Mobile · Editor" width={390} height={844}>
        <GrMobileEditor />
      </DCArtboard>
    </DCSection>

    <DCSection
      id="states"
      title="States · component reference"
      subtitle="Every rule card state, save button state, and enforcement chip in one place. Hand this to Claude Code as the visual contract."
    >
      <DCArtboard id="showcase" label="Card · Save · Enforcement states" width={1440} height={1100}>
        <StateShowcase />
      </DCArtboard>
    </DCSection>
  </DesignCanvas>
);

ReactDOM.createRoot(document.getElementById('root')).render(<GrApp />);
