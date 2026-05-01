import { SubscriptionStatus } from "@prisma/client";

function getAdminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isBillingEnabled(): boolean {
  return process.env.BILLING_ENABLED === "true";
}

export function isAdminEmail(email: string): boolean {
  return getAdminEmails().has(email.toLowerCase());
}

/**
 * Determines whether a user has bot access.
 *
 * When BILLING_ENABLED=false (default):
 *   - Admin emails → always granted.
 *   - All other users → granted (no billing gate).
 *
 * When BILLING_ENABLED=true:
 *   - Admin emails → always granted (bypass).
 *   - ACTIVE subscription → granted.
 *   - TRIALING with valid trialEndsAt in the future → granted.
 *   - Everything else → blocked.
 */
export function hasBotAccess(
  status: SubscriptionStatus,
  trialEndsAt: Date | null | undefined,
  email?: string,
): boolean {
  if (email && isAdminEmail(email)) return true;
  if (!isBillingEnabled()) return true;

  if (status === SubscriptionStatus.ACTIVE) return true;
  return (
    status === SubscriptionStatus.TRIALING &&
    Boolean(trialEndsAt && trialEndsAt > new Date())
  );
}
