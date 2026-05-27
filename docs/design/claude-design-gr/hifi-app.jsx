// Hi-fi app — assembles polished variations in a design canvas.

const HiFiApp = () => (
  <DesignCanvas
    title="Trading Rules · Hi-Fi"
    subtitle="Guardrail 2 · three polished directions on the same product shell · dark UI"
  >
    <DCSection
      id="hifi"
      title="Configure"
      subtitle="Same data, same shell, three organising principles. Pick one or combine: e.g. Cards for the overview tab, Split for editing, Matrix for the admin view."
    >
      <DCArtboard id="hi-split" label="A · Split view — sidebar of rules + focused editor on the right" width={1440} height={1000}>
        <HV1Split />
      </DCArtboard>
      <DCArtboard id="hi-cards" label="B · Cards dashboard — status-forward, every rule at a glance" width={1440} height={1100}>
        <HV2Cards />
      </DCArtboard>
      <DCArtboard id="hi-matrix" label="C · Matrix — power user, rules × accounts, bulk edit" width={1440} height={1000}>
        <HV3Matrix />
      </DCArtboard>
    </DCSection>
  </DesignCanvas>
);

ReactDOM.createRoot(document.getElementById('root')).render(<HiFiApp />);
