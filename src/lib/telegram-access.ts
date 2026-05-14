import { SubscriptionStatus } from "@prisma/client";

import { hasBotAccess } from "@/lib/subscription";

type TelegramAccessInput = {
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: Date | null;
  onboardingComplete: boolean;
  telegramConnected: boolean;
  email: string;
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
  email,
}: TelegramAccessInput) {
  const accessActive = hasBotAccess(subscriptionStatus, trialEndsAt, email);

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
