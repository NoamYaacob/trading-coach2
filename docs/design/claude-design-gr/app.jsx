// Main app — assembles the design canvas with all variations as artboards.

const App = () => (
  <DesignCanvas
    title="Trading Rules"
    subtitle="Guardrail 2 · 5 desktop layouts + 2 mobile · sketchy wireframes for the Configure flow"
  >
    <DCSection
      id="desktop"
      title="Desktop · Configure"
      subtitle="Same data, five organising principles. Pick what fits your mental model — they can be combined (e.g. cards on overview + split-view on edit)."
    >
      <DCArtboard id="v1" label="A · Accordion list — sparse, view-then-edit, scales to many rules" width={1280} height={920}>
        <V1Accordion />
      </DCArtboard>
      <DCArtboard id="v2" label="B · Cards dashboard — status-forward, scannable, account-tabbed" width={1280} height={920}>
        <V2Dashboard />
      </DCArtboard>
      <DCArtboard id="v3" label="C · Split view — focused inline editing, sidebar nav" width={1440} height={920}>
        <V3Split />
      </DCArtboard>
      <DCArtboard id="v4" label="D · Matrix — power-user, rules × accounts, copy-paste between" width={1440} height={920}>
        <V4Matrix />
      </DCArtboard>
      <DCArtboard id="v5" label="E · Guided wizard — first-run only, one rule per step" width={1280} height={920}>
        <V5Wizard />
      </DCArtboard>
    </DCSection>

    <DCSection
      id="mobile"
      title="Mobile · companion views"
      subtitle="Mostly read-only on the go, with one-tap drill-down to edit a single rule. Designed to pair with desktop variant A or B."
    >
      <DCArtboard id="m1" label="Overview · all rules + today's usage" width={380} height={780}>
        <M1Mobile />
      </DCArtboard>
      <DCArtboard id="m2" label="Edit a single rule (Daily Loss)" width={380} height={780}>
        <M2MobileEdit />
      </DCArtboard>
    </DCSection>
  </DesignCanvas>
);

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
