// Pure logic for the pending account confirm flow.
// No React or browser dependencies — safe to import in node:test.

export const PREVIEW_CONFIRM_MESSAGE =
  "Preview only — this is sample data. No account will be created.";

export const PREVIEW_CONFIRM_HINT =
  "In a real import, Guardrail would add the account and then apply the selected rules setup.";

export type ConfirmOutcome =
  | { kind: "preview_blocked" }
  | { kind: "activate"; propFirm: string | null; accountType: string };

/**
 * Determines what happens when the user clicks "Add this account to Guardrail".
 *
 * Returns "preview_blocked" for fake injected accounts — the caller must not
 * make any API call. Returns "activate" for real accounts with the
 * classification payload to send to the protection endpoint.
 */
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
