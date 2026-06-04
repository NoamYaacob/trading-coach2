/**
 * Pure presentation logic for the Tradovate account-selection step.
 *
 * Extracted from select-accounts-form.tsx so the default label/type rules can
 * be unit-tested without rendering the client component. No React, no I/O.
 */

export type SelectableAccountType = "evaluation" | "funded" | "personal" | "demo";

/**
 * Guess the local account type from the broker-reported type plus the
 * pre-OAuth setup context. The user can still override this in the UI.
 */
export function guessAccountType(
  brokerType: string,
  env: string,
  accountSource: string,
): SelectableAccountType {
  if (env === "demo" && accountSource === "demo") return "demo";
  if (env === "demo") return "evaluation";
  const t = brokerType.toLowerCase();
  if (t.includes("fund")) return "funded";
  if (t.includes("eval") || t.includes("challenge")) return "evaluation";
  if (accountSource === "personal") return "personal";
  return "evaluation";
}

/**
 * Build the default label shown (and saved) for a discovered account.
 *
 * Tradovate names a simulation/demo account after its associated live account
 * number, so a user's demo account and live account can share the exact same
 * `name` (e.g. "1868411"). Without disambiguation both rows render identically
 * in the dashboard sidebar, making a freshly-connected demo account look
 * "missing." For env="demo" we append a " (Sim)" marker so the default label
 * is distinguishable. The user can still edit the label before finalizing.
 *
 * @param name        broker-reported account name/nickname
 * @param displayName optional pre-OAuth setup label (may be null/empty)
 * @param env         "demo" | "live" (BrokerConnection environment)
 */
export function buildDefaultAccountLabel(
  name: string,
  displayName: string | null | undefined,
  env: string,
): string {
  const trimmedDisplay = displayName?.trim();
  const base = trimmedDisplay ? `${trimmedDisplay} — ${name}` : name;
  if (env === "demo") return `${base} (Sim)`;
  return base;
}
