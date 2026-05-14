// Pure logic for the pending account confirm flow.
// No React or browser dependencies — safe to import in node:test.

import type { PendingDiscoveredAccount } from "./types";

export const PREVIEW_CONFIRM_MESSAGE =
  "Demo preview only — no account was created.";

export const PREVIEW_CONFIRM_HINT =
  "In a real import, Guardrail would add the account and apply your selected setup.";

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

const TYPE_LABEL: Record<string, string> = {
  evaluation: "Evaluation",
  funded: "Funded",
  demo: "Demo",
};

export function buildMetaParts(account: PendingDiscoveredAccount): string[] {
  const parts: string[] = [];
  parts.push(account.platformLabel);
  if (account.envLabel) parts.push(account.envLabel);
  const firmDisplay = account.inheritedPropFirm ?? account.suggestedPropFirm ?? account.propFirm;
  parts.push(firmDisplay?.trim() ? firmDisplay.trim() : "Unassigned");
  const typeToShow = firmDisplay
    ? (account.inheritedAccountType ?? account.suggestedAccountType)
    : null;
  if (typeToShow && typeToShow !== "personal") {
    const label = TYPE_LABEL[typeToShow];
    if (label) parts.push(label);
  }
  // Skip broker IDs for preview accounts — they are fake and confuse users.
  if (account.externalAccountId && !account.isPreview) {
    parts.push(`ID ${account.externalAccountId}`);
  }
  return parts;
}

export function buildPanelHeading(firmLabel: string | null, count: number): string {
  if (count === 1) {
    return firmLabel ? `New ${firmLabel} account found` : "New broker account found";
  }
  return firmLabel ? `New ${firmLabel} accounts found` : "New broker accounts found";
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
