/**
 * Pure heuristics for classifying a newly-discovered broker account.
 *
 * Used in the "New broker account detected" panel to pre-fill the
 * prop firm / account type selectors based on the account label
 * returned by the broker.
 *
 * No DB access, no network calls — safe to import in server and client code.
 */

export const PROP_FIRM_OPTIONS = [
  "MyFundedFutures",
  "Apex Trader Funding",
  "Topstep",
  "Lucid Trading",
  "Take Profit Trader",
  "Tradeify",
] as const;

export type PropFirmOption = (typeof PROP_FIRM_OPTIONS)[number];

export type AccountTypeOption = "evaluation" | "funded" | "personal" | "demo";

export type ClassificationSuggestion = {
  /** Suggested prop firm name, or null when account looks personal. */
  propFirm: string | null;
  accountType: AccountTypeOption;
  /**
   * "high" — pattern matched, pre-select with confidence.
   * "low"  — no match, user must choose; default to Personal.
   */
  confidence: "high" | "low";
};

type Pattern = {
  test: (label: string) => boolean;
  propFirm: string;
  accountType: AccountTypeOption;
};

const PATTERNS: Pattern[] = [
  // MyFundedFutures — labels start with MFFU, MFFUEV, MFFUEVBLDR, etc.
  {
    test: (l) => /^mffu/i.test(l),
    propFirm: "MyFundedFutures",
    accountType: "evaluation",
  },
  // Apex Trader Funding
  {
    test: (l) => /^apex/i.test(l),
    propFirm: "Apex Trader Funding",
    accountType: "evaluation",
  },
  // Topstep
  {
    test: (l) => /^(tst|topstep)/i.test(l),
    propFirm: "Topstep",
    accountType: "evaluation",
  },
  // Take Profit Trader
  {
    test: (l) => /^(tpt|takeprofittrader)/i.test(l),
    propFirm: "Take Profit Trader",
    accountType: "evaluation",
  },
  // Tradeify
  {
    test: (l) => /^tradeify/i.test(l),
    propFirm: "Tradeify",
    accountType: "evaluation",
  },
  // Lucid Trading
  {
    test: (l) => /^lucid/i.test(l),
    propFirm: "Lucid Trading",
    accountType: "evaluation",
  },
];

/**
 * Infer the most likely prop firm and account type from a broker-assigned
 * account label. Returns a high-confidence suggestion when the label matches
 * a known pattern, or a low-confidence "Personal" default otherwise.
 */
export function inferAccountClassification(label: string): ClassificationSuggestion {
  const trimmed = label.trim();
  for (const p of PATTERNS) {
    if (p.test(trimmed)) {
      return { propFirm: p.propFirm, accountType: p.accountType, confidence: "high" };
    }
  }
  return { propFirm: null, accountType: "personal", confidence: "low" };
}
