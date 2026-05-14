/**
 * Pure helper: detects prop firm context for a pending account and derives
 * the data needed to render the contextual setup notice.
 *
 * Returns null when the account has no prop firm context (e.g. a personal
 * brokerage account) — callers should render no notice in that case.
 */

export type PropFirmNoticeData = {
  /** Human-readable account phase, e.g. "Evaluation", "Funded", "Sim", "Live",
   *  or "Not confirmed" when the phase cannot be determined from available data. */
  phaseLabel: string;
  /** Prop firm name as stored, or null when not set. */
  propFirmName: string | null;
  /** Short noun used in "This looks like a new X account."
   *  Prefers the phase label when known, falls back to the firm name, then
   *  to the generic "prop firm". */
  contextLabel: string;
};

const ACCOUNT_TYPE_PHASE: Partial<Record<string, string>> = {
  evaluation: "Evaluation",
  funded: "Funded",
  demo: "Sim",
};

// Ordered: more specific patterns first.
const LABEL_PHASE_PATTERNS: [RegExp, string][] = [
  [/\bevaluation\b/i, "Evaluation"],
  [/\beval\b/i, "Evaluation"],
  [/\bfunded\b/i, "Funded"],
  [/\bsim\b/i, "Sim"],
  [/\blive\b/i, "Live"],
];

function detectPhase(accountType: string, label: string): string {
  const fromType = ACCOUNT_TYPE_PHASE[accountType];
  if (fromType) return fromType;
  for (const [pattern, phase] of LABEL_PHASE_PATTERNS) {
    if (pattern.test(label)) return phase;
  }
  return "Not confirmed";
}

/** True when the account carries any signal that it is a prop firm account. */
function hasPropFirmContext(
  propFirmName: string | null,
  accountType: string,
  label: string,
): boolean {
  if (propFirmName != null) return true;
  if (accountType === "evaluation" || accountType === "funded") return true;
  return LABEL_PHASE_PATTERNS.some(([pattern]) => pattern.test(label));
}

export function derivePropFirmNotice(input: {
  propFirm: string | null;
  accountType: string;
  label: string;
}): PropFirmNoticeData | null {
  const propFirmName = input.propFirm?.trim() || null;

  if (!hasPropFirmContext(propFirmName, input.accountType, input.label)) return null;

  const phaseLabel = detectPhase(input.accountType, input.label);
  const contextLabel =
    phaseLabel !== "Not confirmed" ? phaseLabel : propFirmName ?? "prop firm";

  return { phaseLabel, propFirmName, contextLabel };
}
