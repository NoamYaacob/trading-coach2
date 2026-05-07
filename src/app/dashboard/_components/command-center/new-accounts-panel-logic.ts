// Pure logic for the pending account confirm flow.
// No React or browser dependencies — safe to import in node:test.

export const PREVIEW_CONFIRM_MESSAGE =
  "Preview only — this is sample data. No account will be created.";

export const PREVIEW_CONFIRM_HINT =
  "In a real import, Guardrail would add the account and then apply the selected rules setup.";

export type FirmChoice = "MyFundedFutures" | "Apex Trader Funding" | "Topstep" | "personal" | "other";
export type AccountTypeChoice = "evaluation" | "funded" | "personal" | "demo";

export const KNOWN_PILL_FIRMS: readonly FirmChoice[] = [
  "MyFundedFutures",
  "Apex Trader Funding",
  "Topstep",
];

export function getDefaultFirmChoice(
  inheritedPropFirm: string | null | undefined,
  suggestedPropFirm: string | null | undefined,
): FirmChoice {
  const bestFirm = inheritedPropFirm ?? suggestedPropFirm;
  if (bestFirm) {
    return (KNOWN_PILL_FIRMS as readonly string[]).includes(bestFirm)
      ? (bestFirm as FirmChoice)
      : "other";
  }
  return "personal";
}

export function getDefaultOtherText(
  inheritedPropFirm: string | null | undefined,
  suggestedPropFirm: string | null | undefined,
): string {
  const bestFirm = inheritedPropFirm ?? suggestedPropFirm;
  if (bestFirm && !(KNOWN_PILL_FIRMS as readonly string[]).includes(bestFirm)) {
    return bestFirm;
  }
  return "";
}

export function getDefaultTypeChoice(
  inheritedAccountType: string | null | undefined,
  suggestedAccountType: string | null | undefined,
): AccountTypeChoice {
  const t = inheritedAccountType ?? suggestedAccountType;
  if (t === "evaluation" || t === "funded" || t === "personal" || t === "demo") return t;
  return "evaluation";
}

export type ConfirmOutcome =
  | { kind: "preview_blocked" }
  | { kind: "activate"; propFirm: string | null; accountType: string };

export function resolveConfirmOutcome(
  isPreview: boolean | undefined,
  firmChoice: string,
  otherText: string,
  typeChoice: string,
): ConfirmOutcome {
  if (isPreview) return { kind: "preview_blocked" };
  if (firmChoice === "personal") return { kind: "activate", propFirm: null, accountType: "personal" };
  if (firmChoice === "other") {
    return { kind: "activate", propFirm: otherText.trim() || null, accountType: typeChoice };
  }
  return { kind: "activate", propFirm: firmChoice, accountType: typeChoice };
}
