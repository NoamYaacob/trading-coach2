import { SubscriptionStatus } from "@prisma/client";

export function hasBotAccess(status: SubscriptionStatus, trialEndsAt?: Date | null) {
  if (status === SubscriptionStatus.ACTIVE) {
    return true;
  }

  return status === SubscriptionStatus.TRIALING && Boolean(trialEndsAt && trialEndsAt > new Date());
}
