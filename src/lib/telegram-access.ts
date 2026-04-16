import { SubscriptionStatus } from "@prisma/client";

import { hasBotAccess } from "@/lib/subscription";

type TelegramAccessInput = {
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: Date | null;
  onboardingComplete: boolean;
  telegramConnected: boolean;
};

export type TelegramDashboardState =
  | "not_connected"
  | "connected"
  | "connected_onboarding_incomplete"
  | "connected_access_inactive";

export function evaluateTelegramAccess({
  subscriptionStatus,
  trialEndsAt,
  onboardingComplete,
  telegramConnected,
}: TelegramAccessInput) {
  const accessActive = hasBotAccess(subscriptionStatus, trialEndsAt);

  let dashboardState: TelegramDashboardState;

  if (!telegramConnected) {
    dashboardState = "not_connected";
  } else if (!onboardingComplete) {
    dashboardState = "connected_onboarding_incomplete";
  } else if (!accessActive) {
    dashboardState = "connected_access_inactive";
  } else {
    dashboardState = "connected";
  }

  return {
    accessActive,
    dashboardState,
  };
}
