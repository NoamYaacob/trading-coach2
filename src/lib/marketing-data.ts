export type RuleBadge = "active" | "partial" | "coming-soon";

export const PAIN_SCENARIOS = [
  {
    title: "The revenge trade",
    body: "Down $180. Your daily limit is $200. You size up to make it back. Now the day is gone.",
  },
  {
    title: "The one more trade",
    body: "You said five trades max. The sixth one looks perfect. Then comes the seventh.",
  },
  {
    title: "The oversized entry",
    body: "You triple size because the setup feels obvious. One miss wipes out three good days.",
  },
];

export const STEPS = [
  {
    n: "01",
    tag: "Premarket",
    tagCls: "bg-stone-100 text-stone-600",
    title: "Set your trading plan",
    detail:
      "Daily loss limit, max trades, session hours, loss-streak stop. Set them once before the open. Guardrail holds them across every session.",
  },
  {
    n: "02",
    tag: "Live",
    tagCls: "bg-emerald-100 text-emerald-700",
    title: "Trade with live rule monitoring",
    detail:
      "Every trade event is evaluated against your rules. You see Allowed, Warning, or Locked — before the damage compounds.",
  },
  {
    n: "03",
    tag: "Locked",
    tagCls: "bg-red-100 text-red-700",
    title: "Session locks when a rule breaks",
    detail:
      "When a limit is hit, the session locks inside the app. You see which rule fired and when the reset window opens. Account-level monitoring today.",
  },
];

export const RULES: Array<{ name: string; description: string; badge: RuleBadge }> = [
  {
    name: "Daily Loss Limit",
    description: "When today's P&L crosses your limit, the session locks immediately.",
    badge: "active",
  },
  {
    name: "Max Trades Per Day",
    description: "Hit your trade count and the session stops — regardless of what the market looks like.",
    badge: "active",
  },
  {
    name: "Stop After Consecutive Losses",
    description: "Three red trades in a row? Guardrail stops you before the fourth.",
    badge: "active",
  },
  {
    name: "Session Hours",
    description: "Define your trading window. Rules are only evaluated during those hours.",
    badge: "active",
  },
  {
    name: "Daily Profit Target",
    description: "Lock in a good day. Session stops when you hit your target.",
    badge: "partial",
  },
  {
    name: "Risk Per Trade",
    description: "Flag entries that risk more than your per-trade limit.",
    badge: "partial",
  },
  {
    name: "Allowed Trading Days",
    description: "Set which days of the week you trade. Evaluation skips blocked days.",
    badge: "partial",
  },
  {
    name: "Max Contracts (position size)",
    description: "Guardrail monitors standard-equivalent position size and locks the session when the cap is exceeded. No pre-trade blocking.",
    badge: "partial",
  },
  {
    name: "News Blackout",
    description: "Block or warn before major economic events — FOMC, NFP, CPI.",
    badge: "coming-soon",
  },
  {
    name: "Weekly Loss Limit",
    description: "Stop trading for the week once cumulative losses cross your limit.",
    badge: "coming-soon",
  },
  {
    name: "Weekly Profit Limit",
    description: "Protect a strong week by locking trading once you hit a weekly target.",
    badge: "coming-soon",
  },
  {
    name: "Cooldown Period",
    description: "Mandatory pause after a loss before the next entry is allowed.",
    badge: "coming-soon",
  },
  {
    name: "Payout Protection Mode",
    description: "When a profit target is reached, Guardrail helps prevent the giveback trade.",
    badge: "coming-soon",
  },
  {
    name: "Entry Checklist",
    description: "Confirm your pre-trade conditions are met before each entry.",
    badge: "coming-soon",
  },
];

export const PROP_FIRM_CARDS = [
  {
    title: "Protect the challenge",
    body: "Daily drawdown and max trade rules are not suggestions during an evaluation. Guardrail holds them like they are.",
  },
  {
    title: "Protect the funded account",
    body: "When pressure rises, Guardrail keeps the account inside the limits you chose — before emotional decisions override them.",
  },
  {
    title: "Protect payout days",
    body: "When the goal is reached, Guardrail helps stop the giveback trade. Lock in the good day.",
  },
];

export const ENFORCEMENT_NOW = [
  "App-level session lock when a rule breaks",
  "Rule evaluation against live broker trade events",
  "Telegram lockout alerts — optional, immediate",
  "Broker-connected read-only mode — live trade events from Tradovate",
];

export const ENFORCEMENT_PLANNED = [
  "Cancel open orders on rule breach",
  "Flatten positions on rule breach",
  "Broker-side order blocking",
  "Additional broker integrations",
];

export const BROKERS: Array<{ name: string; status: "live" | "planned"; description?: string }> = [
  {
    name: "Tradovate",
    status: "live",
    description:
      "First integration. Read-only webhook — trade events evaluated against your rules in real time. Guardrail starts read-only and only expands enforcement after verified broker support.",
  },
  { name: "Rithmic", status: "planned", description: "Planned after Tradovate verification." },
  { name: "NinjaTrader", status: "planned", description: "Planned after Tradovate verification." },
  { name: "Interactive Brokers", status: "planned", description: "Planned after Tradovate verification." },
];

export const INCLUDED_FEATURES = [
  "Live rule evaluation — Allowed, Warning, or Locked",
  "Daily loss limit, max trades, loss-streak stop, session hours",
  "Tradovate read-only connection — trade events vs. your rules",
  "Telegram alerts when a limit triggers",
  "Prop firm evaluation and funded account support",
];

export const FAQS = [
  {
    q: "What does Guardrail actually do?",
    a: "Guardrail lets you define risk rules like daily loss, max trades, session hours, and loss streaks. It evaluates your session against those rules and moves the state through Allowed, Warning, or Locked depending on the mode your account supports.",
  },
  {
    q: "What is Guardian?",
    a: "Guardian is Guardrail's rule engine. It watches your connected account during the trading session and evaluates every trade event against the rules you set — moving the session through Allowed, Warning, or Locked.",
  },
  {
    q: "Is Guardrail a trading signal tool?",
    a: "No. Guardrail does not tell you what trades to take, when to enter, or what the market will do. It is a risk enforcement tool — it holds the rules you already chose before emotional pressure overrides them.",
  },
  {
    q: "Does Guardrail block my broker orders?",
    a: "Not yet. Today the session locks inside Guardrail — if Telegram is connected, you get an alert immediately. Nothing happens at the broker. Broker-side order cancellation and position flattening are planned and will only ship after live verification with each integration.",
  },
  {
    q: "App-level lock vs. broker-side enforcement — what's the difference?",
    a: "App-level lock means the session moves to Locked inside Guardrail and you are alerted. Your broker account is unaffected — you could still place trades there manually. Broker-side enforcement means Guardrail would cancel orders or flatten positions directly at the broker level. That requires verified write-level API permissions and is planned, not live today.",
  },
  {
    q: "Which rules can be enforced at the broker?",
    a: "Daily Loss is the only rule designed to be backed by Tradovate's broker-side risk settings, and only when you explicitly enable it on a supported connection. Profit target, max trades, loss streak, position size, and session cutoff are always Guardrail-monitored — never broker-enforced. Today Guardrail runs in monitoring mode: it locks the session in the app and alerts you, and no broker writes happen by default.",
  },
  {
    q: "Does it work for prop firm evaluation and funded accounts?",
    a: "Yes. Guardrail is built for futures traders on funded and evaluation accounts where a single bad day can end the account. It supports evaluation, funded, personal, and demo account types and is designed around typical prop firm daily loss and trade count constraints.",
  },
  {
    q: "Does Guardrail work across multiple prop firm accounts or broker connections?",
    a: "Yes. Guardrail supports multiple Tradovate connections and multiple trading accounts under each connection. Each connection is tracked independently — accounts across different prop firms or on different connections stay isolated. Enforcement is account-specific: a rule breach on one account does not affect others.",
  },
  {
    q: "Which brokers are supported?",
    a: "Tradovate is the first integration — read-only webhook connection. Guardrail receives trade events to evaluate your rules in real time. It cannot place, modify, or cancel orders. Rithmic, NinjaTrader, and Interactive Brokers are planned. Connect Tradovate from your account settings.",
  },
  {
    q: "Can I change my rules during a trading day?",
    a: "You can edit rules at any time — there's no automatic lock during active sessions today. We recommend setting your rules before the open and treating them as final until the day ends. Session-based rule locking is on the roadmap.",
  },
  {
    q: "How does Telegram fit in?",
    a: "Telegram is an optional alert channel. When connected, Guardrail sends lockout and warning alerts directly to your phone. Everything works without it — Telegram is an add-on for traders who want immediate mobile alerts.",
  },
  {
    q: "Is Guardrail financial advice?",
    a: "No. Guardrail is a trading-discipline and risk-control tool — not financial, investment, or trading advice. It does not recommend trades or predict the market. You set your own rules; Guardrail helps you hold them. Trading futures carries a substantial risk of loss.",
  },
];
