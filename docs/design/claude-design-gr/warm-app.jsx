// Warm app — same product, two views.
const WarmApp = () => (
  <DesignCanvas
    title="Trading Rules · Warm"
    subtitle="Cream paper + Instrument Serif + terracotta accent · split-view editing + overview"
  >
    <DCSection
      id="warm"
      title="Trading Rules"
      subtitle="The polished split-view from before, now with color and an editorial typeface. Same shell across the two screens — left rail is the source of truth, right pane swaps between editor (a rule is selected) and overview (none selected)."
    >
      <DCArtboard id="w-edit" label="Editor · a rule is selected" width={1440} height={1080}>
        <WV1 />
      </DCArtboard>
      <DCArtboard id="w-over" label="Overview · all rules at a glance" width={1440} height={1080}>
        <WV2Overview />
      </DCArtboard>
    </DCSection>
  </DesignCanvas>
);

ReactDOM.createRoot(document.getElementById('root')).render(<WarmApp />);
