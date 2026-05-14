// TODO: Remove this file once real Tradovate discovery is verified end-to-end.
// Controlled by ENABLE_DISCOVERY_PREVIEW_FOR_NOAM=true and restricted to
// noamyaacob12@gmail.com so it never affects any other user.

import type { PendingDiscoveredAccount } from "./types";

export function isPreviewEnabled(
  flagValue: string | undefined,
  userEmail: string | undefined | null,
): boolean {
  return flagValue === "true" && userEmail === "noamyaacob12@gmail.com";
}

export function buildPreviewPendingAccount(
  mffBrokerConnectionId: string | null,
): PendingDiscoveredAccount {
  return {
    id: "preview-pending-mffu-001",
    label: "MFFUEVBLDR-PREVIEW",
    externalAccountId: "preview-mffu-001",
    platform: "tradovate",
    platformLabel: "Tradovate",
    accountType: "evaluation",
    accountTypeLabel: "Evaluation",
    brokerConnectionId: mffBrokerConnectionId,
    lastSeenInBrokerAt: null,
    env: "demo",
    envLabel: "Demo / Sim",
    propFirm: null,
    inheritedPropFirm: "MyFundedFutures",
    inheritedAccountType: "evaluation",
    suggestedPropFirm: "MyFundedFutures",
    suggestedAccountType: "evaluation",
    isPreview: true,
  };
}
